// Package agent implements a tool-calling chat loop on top of any
// OpenAI-compatible upstream. The frontend posts a normal chat request to
// /api/agent/chat; the handler advertises server-side tools, runs tool calls in
// a loop, and streams the final assistant message back as SSE (so the existing
// frontend stream reader works unchanged). Intermediate tool calls/results are
// emitted as custom SSE events so the UI can show "Searching the web…" steps.
package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/johnbetancur/vision/backend/internal/agents"
	"github.com/johnbetancur/vision/backend/internal/config"
	"github.com/johnbetancur/vision/backend/internal/connections"
	"github.com/johnbetancur/vision/backend/internal/governor"
	"github.com/johnbetancur/vision/backend/internal/mcp"
	"github.com/johnbetancur/vision/backend/internal/mcpservers"
	"github.com/johnbetancur/vision/backend/internal/modelmeta"
	"github.com/johnbetancur/vision/backend/internal/tools"
	"github.com/johnbetancur/vision/backend/internal/usage"
)

// defaultMaxRounds bounds the tool loop when no agent overrides it.
const defaultMaxRounds = 5

type Handler struct {
	cfg         *config.Config
	connStore   *connections.Store
	mcpStore    *mcpservers.Store
	agentsStore *agents.Store
	usageStore  *usage.Store
	registry    *tools.Registry
	client      *http.Client
}

func NewHandler(cfg *config.Config, connStore *connections.Store, mcpStore *mcpservers.Store, agentsStore *agents.Store, usageStore *usage.Store, registry *tools.Registry) *Handler {
	return &Handler{
		cfg:         cfg,
		connStore:   connStore,
		mcpStore:    mcpStore,
		agentsStore: agentsStore,
		usageStore:  usageStore,
		registry:    registry,
		client:      &http.Client{Timeout: 120 * time.Second},
	}
}

// upstreamMessage mirrors the OpenAI chat message shape, including tool calls.
type upstreamMessage struct {
	Role       string     `json:"role"`
	Content    any        `json:"content"`
	ToolCalls  []toolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	Name       string     `json:"name,omitempty"`
}

type toolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

type agentRequest struct {
	Model        string            `json:"model"`
	Messages     []upstreamMessage `json:"messages"`
	MCPServerIDs []string          `json:"mcpServerIds,omitempty"`
	// AgentID (or slug) selects a saved agent. When set, the agent is the source
	// of truth for model, instructions, tool set, and maxRounds; the request's
	// Model/MCPServerIDs are ignored. When empty, the loop behaves as before.
	AgentID string `json:"agentId,omitempty"`
}

// runConfig is the resolved per-request configuration after applying any agent.
type runConfig struct {
	agentID      string // "" when no saved agent; attributes usage + ceilings
	model        string
	instructions string   // prepended as a stable system message (cache anchor)
	mcpServerIDs []string // MCP servers to offer
	builtinTools []string // built-in tool names to offer; nil = offer all (no agent)
	maxRounds    int
	maxTokensRun int64   // per-run token cap; 0 = off
	maxCostRun   float64 // per-run USD cap; 0 = off
	connectionID string  // optional agent-pinned connection
}

// Chat handles POST /api/agent/chat.
func (h *Handler) Chat(w http.ResponseWriter, r *http.Request) {
	var req agentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	ctx := r.Context()

	// Resolve the run config from the optional saved agent. A bad agentId is a
	// hard error (the caller asked for a specific agent); everything else falls
	// back to request-level values.
	cfg, err := h.resolveRunConfig(req)
	if err != nil {
		writeSSE(w, flusher, "error", map[string]string{"message": err.Error()})
		writeDone(w, flusher)
		return
	}

	// Upstream: an agent may pin a connection; otherwise use the request header.
	connID := cfg.connectionID
	if connID == "" {
		connID = r.Header.Get("X-Relay-Connection-ID")
	}
	baseURL, apiKey := h.resolveUpstream(connID)
	if baseURL == "" {
		writeSSE(w, flusher, "error", map[string]string{"message": "no upstream configured"})
		writeDone(w, flusher)
		return
	}

	// Cache-aware assembly: a stable system message (the agent's instructions)
	// is prepended exactly once and stays at index 0, byte-identical across the
	// conversation's turns, so provider prompt-caching anchors on it instead of
	// re-billing a shifting prefix. We skip prepending if the request already
	// leads with a system message (avoid double system blocks).
	messages := assembleMessages(cfg.instructions, req.Messages)

	// Build the per-request registry. With an agent, offer only its configured
	// built-in tools + its MCP servers. Without an agent, preserve prior
	// behavior: all built-in tools + the request's MCP servers.
	var base []tools.Tool
	if cfg.builtinTools == nil {
		base = h.registry.All()
	} else {
		base = h.registry.Subset(cfg.builtinTools)
	}
	registry := tools.NewRegistry(base...)
	if len(cfg.mcpServerIDs) > 0 {
		extra, closers := h.collectMCPTools(ctx, cfg.mcpServerIDs, w, flusher)
		defer func() {
			for _, c := range closers {
				c()
			}
		}()
		if len(extra) > 0 {
			registry = tools.NewRegistry(append(base, extra...)...)
		}
	}
	specs := registry.Specs()

	// Cost governor: a per-run meter enforcing the agent's token/cost caps.
	// Price is resolved once for the run's model; nil price ⇒ dollar cap inert,
	// token cap still protects (see governor.RunMeter). meterConnID is the
	// connection we attribute recorded usage to.
	price := h.resolvePrice(ctx, connID, cfg.model)
	meter := governor.NewRunMeter(price, cfg.maxTokensRun, cfg.maxCostRun)

	// Pre-run ceiling gate: refuse to start a run that has already hit a period
	// budget. Only applies to saved agents (per-agent ceilings); ad-hoc runs
	// have no agent to attribute period usage to.
	if cfg.agentID != "" {
		if ok, reason := h.checkCeiling(ctx, cfg.agentID, connID); !ok {
			writeSSE(w, flusher, "budget_exceeded", map[string]string{"scope": "ceiling", "reason": reason})
			writeDone(w, flusher)
			return
		}
	}

	for round := 0; round < cfg.maxRounds; round++ {
		resp, contentStreamed, err := h.callUpstreamStream(ctx, baseURL, apiKey, cfg.model, messages, specs, w, flusher)
		if err != nil {
			writeSSE(w, flusher, "error", map[string]string{"message": err.Error()})
			writeDone(w, flusher)
			return
		}

		// Meter every round (tool-call rounds and the final answer alike): record
		// usage so agent runs are no longer invisible to cost tracking, feed the
		// run meter, and stream the live cost to the UI.
		h.meterRound(connID, cfg.agentID, cfg.model, resp, meter, w, flusher)

		choice := resp.Choices[0].Message

		// No tool calls → this is the final answer. Content was already streamed
		// live by callUpstreamStream; just close out.
		if len(choice.ToolCalls) == 0 {
			if !contentStreamed {
				// Fallback: upstream didn't stream content (e.g. tool-call-only round
				// with no content), emit whatever the buffered response holds.
				streamText(w, flusher, contentString(choice.Content))
			}
			writeDone(w, flusher)
			return
		}

		// A per-run cap may have tripped on this round's usage. Stop after we've
		// delivered any final answer above, but before spending another round on
		// more tool calls.
		if stop, reason := meter.Exceeded(); stop {
			writeSSE(w, flusher, "budget_exceeded", map[string]string{"scope": "run", "reason": reason})
			writeDone(w, flusher)
			return
		}

		// Append the assistant's tool-call message, then execute each call.
		messages = append(messages, choice)
		for _, tc := range choice.ToolCalls {
			writeSSE(w, flusher, "tool_call", map[string]string{
				"name": tc.Function.Name,
				"args": string(tc.Function.Arguments),
			})
			result := registry.Execute(ctx, tc.Function.Name, tc.Function.Arguments)
			writeSSE(w, flusher, "tool_result", map[string]string{
				"name":   tc.Function.Name,
				"result": truncate(result, 2000),
			})
			messages = append(messages, upstreamMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Name:       tc.Function.Name,
				Content:    result,
			})
		}
	}

	// Ran out of rounds without a final answer.
	writeSSE(w, flusher, "error", map[string]string{"message": "tool loop exceeded max rounds"})
	writeDone(w, flusher)
}

// resolveRunConfig applies the optional saved agent to produce the effective run
// configuration. With no agentId, it returns the request's own values and
// builtinTools=nil (a sentinel meaning "offer all built-in tools", preserving
// pre-agent behavior). With an agentId, the agent is authoritative.
func (h *Handler) resolveRunConfig(req agentRequest) (runConfig, error) {
	if req.AgentID == "" {
		return runConfig{
			model:        req.Model,
			mcpServerIDs: req.MCPServerIDs,
			builtinTools: nil, // offer all
			maxRounds:    defaultMaxRounds,
		}, nil
	}

	a, err := h.agentsStore.GetByID(req.AgentID)
	if err != nil {
		return runConfig{}, fmt.Errorf("load agent: %w", err)
	}
	if a == nil {
		// Accept a slug as well as an id.
		if a, err = h.agentsStore.GetBySlug(req.AgentID); err != nil {
			return runConfig{}, fmt.Errorf("load agent: %w", err)
		}
	}
	if a == nil {
		return runConfig{}, fmt.Errorf("agent %q not found", req.AgentID)
	}
	if !a.Enabled {
		return runConfig{}, fmt.Errorf("agent %q is disabled", a.Slug)
	}

	rounds := a.MaxRounds
	if rounds <= 0 {
		rounds = defaultMaxRounds
	}
	// builtinTools is non-nil here (possibly empty), so only the agent's chosen
	// built-in tools are offered.
	builtin := a.BuiltinTools
	if builtin == nil {
		builtin = []string{}
	}
	return runConfig{
		model:        a.Model,
		instructions: a.Instructions,
		mcpServerIDs: a.MCPServerIDs,
		builtinTools: builtin,
		maxRounds:    rounds,
		maxTokensRun: a.MaxTokensRun,
		maxCostRun:   a.MaxCostRun,
		connectionID: a.ConnectionID,
	}, nil
}

// assembleMessages prepends the agent's instructions as a single leading system
// message — the cache anchor. It is skipped when there are no instructions or
// when the caller already supplied a leading system message, so the prefix
// stays stable and is never duplicated.
func assembleMessages(instructions string, msgs []upstreamMessage) []upstreamMessage {
	if instructions == "" {
		return msgs
	}
	if len(msgs) > 0 && msgs[0].Role == "system" {
		return msgs
	}
	out := make([]upstreamMessage, 0, len(msgs)+1)
	out = append(out, upstreamMessage{Role: "system", Content: instructions})
	out = append(out, msgs...)
	return out
}

// meterRound records the round's token usage (closing the gap where agent runs
// were invisible to cost tracking), feeds the run meter, and streams a live cost
// event to the UI. Missing usage (some providers omit it on tool-call rounds) is
// tolerated: nothing is recorded and the meter is unchanged for that round.
func (h *Handler) meterRound(connID, agentID, reqModel string, resp *upstreamResponse, meter *governor.RunMeter, w http.ResponseWriter, f http.Flusher) {
	pt, ct := resp.Usage.PromptTokens, resp.Usage.CompletionTokens
	if pt > 0 || ct > 0 {
		model := reqModel
		if resp.Model != "" {
			model = resp.Model
		}
		if err := h.usageStore.Record(connID, agentID, model, pt, ct); err != nil {
			slog.Error("agent usage record error", "err", err)
		}
		meter.Add(pt, ct)
	}
	usd, known := meter.CostUSD()
	writeSSE(w, f, "cost", map[string]any{
		"tokens":    meter.Tokens(),
		"costUsd":   usd,
		"costKnown": known,
	})
}

// resolvePrice looks up per-model pricing for the run's connection. Returns nil
// when pricing is unknown, which makes the dollar cap inert (token cap still
// protects). An empty connID means "no specific connection"; we still attempt a
// table lookup via an empty Conn so static pricing applies.
func (h *Handler) resolvePrice(ctx context.Context, connID, model string) *modelmeta.Price {
	mc := modelmeta.Conn{}
	if connID != "" {
		if conn, err := h.connStore.GetByID(connID); err == nil && conn != nil {
			mc = modelmeta.Conn{ID: conn.ID, BaseURL: conn.BaseURL, APIKey: conn.APIKey, TypeHint: string(conn.TypeHint)}
		}
	}
	return modelmeta.Resolve(ctx, mc, model).Price
}

// checkCeiling evaluates the agent's period budgets against its recorded usage.
// It bridges the handler's stores to the pure governor.CheckCeiling: budgets
// come from the agents store, period usage from the indexed usage query, and
// pricing from modelmeta (per-model, so a mixed-model period costs correctly).
func (h *Handler) checkCeiling(ctx context.Context, agentID, connID string) (bool, string) {
	rows, err := h.agentsStore.GetBudgets("agent", agentID)
	if err != nil || len(rows) == 0 {
		return true, "" // no budgets (or read error) ⇒ no ceiling
	}
	budgets := make([]governor.PeriodBudget, 0, len(rows))
	for _, b := range rows {
		budgets = append(budgets, governor.PeriodBudget{
			Period:      b.Period,
			LimitUSD:    b.LimitUSD,
			LimitTokens: b.LimitTokens,
		})
	}

	usageSince := func(sinceMillis int64) ([]governor.ModelTokens, error) {
		mu, err := h.usageStore.AgentUsageSince(agentID, sinceMillis)
		if err != nil {
			return nil, err
		}
		out := make([]governor.ModelTokens, 0, len(mu))
		for _, m := range mu {
			out = append(out, governor.ModelTokens{
				Model:            m.Model,
				PromptTokens:     m.PromptTokens,
				CompletionTokens: m.CompletionTokens,
			})
		}
		return out, nil
	}

	price := func(model string) *modelmeta.Price {
		return h.resolvePrice(ctx, connID, model)
	}

	return governor.CheckCeiling(budgets, time.Now(), usageSince, price)
}

// collectMCPTools connects to each selected, enabled MCP server and gathers its
// tools. Failures are surfaced as SSE error events but don't abort the chat.
// Returns the tools plus closers to run when the request finishes.
func (h *Handler) collectMCPTools(ctx context.Context, ids []string, w http.ResponseWriter, f http.Flusher) ([]tools.Tool, []func()) {
	var collected []tools.Tool
	var closers []func()
	for _, id := range ids {
		server, err := h.mcpStore.GetByID(id)
		if err != nil || server == nil || !server.Enabled {
			continue
		}
		ts, closer, err := mcp.Tools(ctx, server.Name, server.URL, server.Headers)
		if err != nil {
			writeSSE(w, f, "error", map[string]string{
				"message": fmt.Sprintf("MCP server %q unavailable: %v", server.Name, err),
			})
			continue
		}
		collected = append(collected, ts...)
		closers = append(closers, closer)
	}
	return collected, closers
}

func (h *Handler) resolveUpstream(connID string) (baseURL, apiKey string) {
	if connID != "" {
		if conn, err := h.connStore.GetByID(connID); err == nil && conn != nil && conn.Enabled {
			return strings.TrimRight(conn.BaseURL, "/"), conn.APIKey
		}
	}
	return strings.TrimRight(h.cfg.APIBaseURL, "/"), h.cfg.APIKey
}

type upstreamResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message upstreamMessage `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
	} `json:"usage"`
}

// callUpstreamStream calls the upstream with stream:true, forwards content
// deltas to the client live, and accumulates tool-call deltas so the caller
// can run the tool loop. Returns the reassembled response, whether any content
// was streamed, and any error.
func (h *Handler) callUpstreamStream(
	ctx context.Context,
	baseURL, apiKey, model string,
	messages []upstreamMessage,
	specs []tools.ToolSpec,
	w http.ResponseWriter,
	f http.Flusher,
) (*upstreamResponse, bool, error) {
	body := map[string]any{
		"model":    model,
		"messages": messages,
		"stream":   true,
	}
	if len(specs) > 0 {
		body["tools"] = specs
		body["tool_choice"] = "auto"
	}
	buf, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/v1/chat/completions", bytes.NewReader(buf))
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		data, _ := io.ReadAll(resp.Body)
		slog.Error("agent upstream error", "status", resp.StatusCode, "body", string(data))
		return nil, false, fmt.Errorf("upstream error %d", resp.StatusCode)
	}

	type tcAccum struct {
		id       string
		toolType string
		name     string
		argsBuf  strings.Builder
	}
	var tcMap []tcAccum // indexed by delta tool_calls[].index

	var contentBuf strings.Builder
	var contentStreamed bool
	var promptTokens, completionTokens int64
	var respModel string

	rawData, _ := io.ReadAll(resp.Body)
	for _, line := range strings.Split(string(rawData), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := line[6:]
		if payload == "[DONE]" {
			break
		}
		var chunk struct {
			Model   string `json:"model"`
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Type     string `json:"type"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *struct {
				PromptTokens     int64 `json:"prompt_tokens"`
				CompletionTokens int64 `json:"completion_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			continue
		}
		if chunk.Model != "" {
			respModel = chunk.Model
		}
		if chunk.Usage != nil {
			promptTokens = chunk.Usage.PromptTokens
			completionTokens = chunk.Usage.CompletionTokens
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		delta := chunk.Choices[0].Delta

		if delta.Content != "" {
			contentBuf.WriteString(delta.Content)
			contentStreamed = true
			streamText(w, f, delta.Content)
		}

		for _, tc := range delta.ToolCalls {
			for len(tcMap) <= tc.Index {
				tcMap = append(tcMap, tcAccum{})
			}
			if tc.ID != "" {
				tcMap[tc.Index].id = tc.ID
			}
			if tc.Type != "" {
				tcMap[tc.Index].toolType = tc.Type
			}
			if tc.Function.Name != "" {
				tcMap[tc.Index].name = tc.Function.Name
			}
			tcMap[tc.Index].argsBuf.WriteString(tc.Function.Arguments)
		}
	}

	var toolCalls []toolCall
	for _, tc := range tcMap {
		toolCalls = append(toolCalls, toolCall{
			ID:   tc.id,
			Type: tc.toolType,
			Function: struct {
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
			}{
				Name:      tc.name,
				Arguments: json.RawMessage(tc.argsBuf.String()),
			},
		})
	}

	assembled := &upstreamResponse{
		Model: respModel,
		Usage: struct {
			PromptTokens     int64 `json:"prompt_tokens"`
			CompletionTokens int64 `json:"completion_tokens"`
		}{promptTokens, completionTokens},
		Choices: []struct {
			Message upstreamMessage `json:"message"`
		}{
			{Message: upstreamMessage{
				Role:      "assistant",
				Content:   contentBuf.String(),
				ToolCalls: toolCalls,
			}},
		},
	}

	return assembled, contentStreamed, nil
}

// ── SSE helpers ─────────────────────────────────────────────────────────────

// streamText emits the final answer as OpenAI-style content deltas so the
// existing frontend stream parser (which reads choices[0].delta.content) works.
func streamText(w http.ResponseWriter, f http.Flusher, text string) {
	chunk := map[string]any{
		"object":  "chat.completion.chunk",
		"choices": []map[string]any{{"delta": map[string]string{"content": text}, "index": 0, "finish_reason": nil}},
	}
	b, _ := json.Marshal(chunk)
	fmt.Fprintf(w, "data: %s\n\n", b)
	f.Flush()
}

// writeSSE emits a named event with a JSON payload for the UI's step display.
func writeSSE(w http.ResponseWriter, f http.Flusher, event string, payload any) {
	b, _ := json.Marshal(payload)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
	f.Flush()
}

func writeDone(w http.ResponseWriter, f http.Flusher) {
	fmt.Fprint(w, "data: [DONE]\n\n")
	f.Flush()
}

func contentString(content any) string {
	switch v := content.(type) {
	case string:
		return v
	case nil:
		return ""
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
