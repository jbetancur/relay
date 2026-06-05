// Package agent implements a tool-calling chat loop on top of any
// OpenAI-compatible upstream. The frontend posts a normal chat request to
// /api/agent/chat; the handler advertises server-side tools, runs tool calls in
// a loop, and streams the final assistant message back as SSE.
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
	"github.com/johnbetancur/vision/backend/internal/budget"
	"github.com/johnbetancur/vision/backend/internal/config"
	"github.com/johnbetancur/vision/backend/internal/connections"
	"github.com/johnbetancur/vision/backend/internal/governor"
	"github.com/johnbetancur/vision/backend/internal/httputil"
	"github.com/johnbetancur/vision/backend/internal/mcp"
	"github.com/johnbetancur/vision/backend/internal/mcpservers"
	"github.com/johnbetancur/vision/backend/internal/modelmeta"
	"github.com/johnbetancur/vision/backend/internal/stringutil"
	"github.com/johnbetancur/vision/backend/internal/tools"
	"github.com/johnbetancur/vision/backend/internal/usage"
)

const defaultMaxRounds = 5

type Handler struct {
	cfg         *config.Config
	connStore   *connections.Store
	mcpStore    *mcpservers.Store
	agentsStore *agents.Store
	usageStore  *usage.Store
	registry    *tools.Registry
	budgetCheck *budget.Checker
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
		budgetCheck: budget.NewChecker(agentsStore, usageStore),
		client:      &http.Client{Timeout: 120 * time.Second},
	}
}

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
	AgentID      string            `json:"agentId,omitempty"`
}

// runConfig is the resolved per-request configuration after applying any saved agent.
type runConfig struct {
	agentID      string
	model        string
	instructions string
	mcpServerIDs []string
	builtinTools []string // nil = offer all (no agent)
	maxRounds    int
	maxTokensRun int64
	maxCostRun   float64
	connectionID string
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

	cfg, err := h.resolveRunConfig(req)
	if err != nil {
		writeSSE(w, flusher, "error", map[string]string{"message": err.Error()})
		writeDone(w, flusher)
		return
	}

	connID := cfg.connectionID
	if connID == "" {
		connID = r.Header.Get("X-Relay-Connection-ID")
	}
	baseURL, apiKey, typeHint := h.resolveUpstream(connID)
	if baseURL == "" {
		writeSSE(w, flusher, "error", map[string]string{"message": "no upstream configured"})
		writeDone(w, flusher)
		return
	}

	messages := assembleMessages(cfg.instructions, req.Messages)

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

	price := h.resolvePrice(ctx, connID, cfg.model)
	meter := governor.NewRunMeter(price, cfg.maxTokensRun, cfg.maxCostRun)

	if cfg.agentID != "" {
		priceFn := governor.PriceFunc(func(model string) *modelmeta.Price {
			return h.resolvePrice(ctx, connID, model)
		})
		if ok, reason := h.budgetCheck.WithinCeiling(ctx, cfg.agentID, priceFn); !ok {
			writeSSE(w, flusher, "budget_exceeded", map[string]string{"scope": "ceiling", "reason": reason})
			writeDone(w, flusher)
			return
		}
	}

	for round := 0; round < cfg.maxRounds; round++ {
		resp, contentStreamed, err := h.callUpstreamStream(ctx, baseURL, apiKey, typeHint, cfg.model, messages, specs, w, flusher)
		if err != nil {
			writeSSE(w, flusher, "error", map[string]string{"message": err.Error()})
			writeDone(w, flusher)
			return
		}

		h.meterRound(connID, cfg.agentID, cfg.model, resp, meter, w, flusher)

		choice := resp.Choices[0].Message

		if len(choice.ToolCalls) == 0 {
			if !contentStreamed {
				streamText(w, flusher, contentString(choice.Content))
			}
			writeDone(w, flusher)
			return
		}

		if stop, reason := meter.Exceeded(); stop {
			writeSSE(w, flusher, "budget_exceeded", map[string]string{"scope": "run", "reason": reason})
			writeDone(w, flusher)
			return
		}

		messages = append(messages, choice)
		for _, tc := range choice.ToolCalls {
			writeSSE(w, flusher, "tool_call", map[string]string{
				"name": tc.Function.Name,
				"args": string(tc.Function.Arguments),
			})
			result := registry.Execute(ctx, tc.Function.Name, tc.Function.Arguments)
			writeSSE(w, flusher, "tool_result", map[string]string{
				"name":   tc.Function.Name,
				"result": stringutil.Truncate(result, 2000),
			})
			messages = append(messages, upstreamMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Name:       tc.Function.Name,
				Content:    result,
			})
		}
	}

	writeSSE(w, flusher, "error", map[string]string{"message": "tool loop exceeded max rounds"})
	writeDone(w, flusher)
}

// resolveRunConfig applies the optional saved agent to produce the effective run
// configuration. With no agentId, builtinTools=nil means "offer all built-in tools".
func (h *Handler) resolveRunConfig(req agentRequest) (runConfig, error) {
	if req.AgentID == "" {
		return runConfig{
			model:        req.Model,
			mcpServerIDs: req.MCPServerIDs,
			builtinTools: nil,
			maxRounds:    defaultMaxRounds,
		}, nil
	}

	a, err := h.agentsStore.GetByID(req.AgentID)
	if err != nil {
		return runConfig{}, fmt.Errorf("load agent: %w", err)
	}
	if a == nil {
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
	builtin := a.BuiltinTools
	if builtin == nil {
		builtin = []string{}
	}
	return runConfig{
		agentID:      a.ID,
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

// assembleMessages prepends the agent's instructions as a stable system message
// (cache anchor). Skipped when instructions are empty or a system message already leads.
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

func (h *Handler) resolvePrice(ctx context.Context, connID, model string) *modelmeta.Price {
	mc := modelmeta.Conn{}
	if connID != "" {
		if conn, err := h.connStore.GetByID(connID); err == nil && conn != nil {
			mc = modelmeta.Conn{ID: conn.ID, BaseURL: conn.BaseURL, APIKey: conn.APIKey, TypeHint: string(conn.TypeHint)}
		}
	}
	return modelmeta.Resolve(ctx, mc, model).Price
}

// collectMCPTools connects to each selected MCP server and returns its tools.
// Failures emit SSE error events but don't abort the chat.
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

func (h *Handler) resolveUpstream(connID string) (baseURL, apiKey, typeHint string) {
	if connID != "" {
		if conn, err := h.connStore.GetByID(connID); err == nil && conn != nil && conn.Enabled {
			return httputil.NormalizeBaseURL(conn.BaseURL), conn.APIKey, string(conn.TypeHint)
		}
	}
	return httputil.NormalizeBaseURL(h.cfg.APIBaseURL), h.cfg.APIKey, ""
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

func (h *Handler) callUpstreamStream(
	ctx context.Context,
	baseURL, apiKey, typeHint, model string,
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
	httputil.SetProviderAuth(req, typeHint, apiKey)

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
	var tcMap []tcAccum

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

// ── SSE helpers ──────────────────────────────────────────────────────────────

func streamText(w http.ResponseWriter, f http.Flusher, text string) {
	chunk := map[string]any{
		"object":  "chat.completion.chunk",
		"choices": []map[string]any{{"delta": map[string]string{"content": text}, "index": 0, "finish_reason": nil}},
	}
	b, _ := json.Marshal(chunk)
	fmt.Fprintf(w, "data: %s\n\n", b)
	f.Flush()
}

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
