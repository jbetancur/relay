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

	"github.com/johnbetancur/vision/backend/internal/config"
	"github.com/johnbetancur/vision/backend/internal/connections"
	"github.com/johnbetancur/vision/backend/internal/mcp"
	"github.com/johnbetancur/vision/backend/internal/mcpservers"
	"github.com/johnbetancur/vision/backend/internal/tools"
)

const maxRounds = 5

type Handler struct {
	cfg       *config.Config
	connStore *connections.Store
	mcpStore  *mcpservers.Store
	registry  *tools.Registry
	client    *http.Client
}

func NewHandler(cfg *config.Config, connStore *connections.Store, mcpStore *mcpservers.Store, registry *tools.Registry) *Handler {
	return &Handler{
		cfg:       cfg,
		connStore: connStore,
		mcpStore:  mcpStore,
		registry:  registry,
		client:    &http.Client{Timeout: 120 * time.Second},
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
}

// Chat handles POST /api/agent/chat.
func (h *Handler) Chat(w http.ResponseWriter, r *http.Request) {
	var req agentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	baseURL, apiKey := h.resolveUpstream(r.Header.Get("X-Relay-Connection-ID"))
	if baseURL == "" {
		http.Error(w, "no upstream configured", http.StatusBadGateway)
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
	messages := req.Messages

	// Build the per-request registry: default tools + tools from each selected
	// MCP server. A server that fails to connect is reported but doesn't abort
	// the chat — its tools are simply not offered this turn.
	registry := h.registry
	if len(req.MCPServerIDs) > 0 {
		extra, closers := h.collectMCPTools(ctx, req.MCPServerIDs, w, flusher)
		defer func() {
			for _, c := range closers {
				c()
			}
		}()
		if len(extra) > 0 {
			registry = tools.NewRegistry(append(h.registry.All(), extra...)...)
		}
	}
	specs := registry.Specs()

	for round := 0; round < maxRounds; round++ {
		resp, err := h.callUpstream(ctx, baseURL, apiKey, req.Model, messages, specs)
		if err != nil {
			writeSSE(w, flusher, "error", map[string]string{"message": err.Error()})
			writeDone(w, flusher)
			return
		}

		choice := resp.Choices[0].Message

		// No tool calls → this is the final answer. Stream it to the client.
		if len(choice.ToolCalls) == 0 {
			streamText(w, flusher, contentString(choice.Content))
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
	Choices []struct {
		Message upstreamMessage `json:"message"`
	} `json:"choices"`
}

func (h *Handler) callUpstream(
	ctx context.Context,
	baseURL, apiKey, model string,
	messages []upstreamMessage,
	specs []tools.ToolSpec,
) (*upstreamResponse, error) {
	body := map[string]any{
		"model":    model,
		"messages": messages,
		"stream":   false,
	}
	if len(specs) > 0 {
		body["tools"] = specs
		body["tool_choice"] = "auto"
	}
	buf, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/v1/chat/completions", bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		slog.Error("agent upstream error", "status", resp.StatusCode, "body", string(data))
		return nil, fmt.Errorf("upstream error %d", resp.StatusCode)
	}

	var out upstreamResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("decode upstream: %w", err)
	}
	if len(out.Choices) == 0 {
		return nil, fmt.Errorf("upstream returned no choices")
	}
	return &out, nil
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
