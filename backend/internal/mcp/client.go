// Package mcp wraps the official MCP Go SDK to expose a remote MCP server's
// tools through Relay's existing tools.Tool interface, so they plug into the
// agent loop unchanged. v1 supports Streamable HTTP servers and tools only
// (no resources/prompts, no stdio).
package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/johnbetancur/vision/backend/internal/tools"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	connectTimeout = 10 * time.Second
	callTimeout    = 60 * time.Second
)

// headerRoundTripper injects static headers (e.g. auth) on every request.
type headerRoundTripper struct {
	base    http.RoundTripper
	headers map[string]string
}

func (h headerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	for k, v := range h.headers {
		req.Header.Set(k, v)
	}
	return h.base.RoundTrip(req)
}

// Connect opens an initialized session to an MCP server over Streamable HTTP.
// The caller must Close the returned session.
func Connect(ctx context.Context, url string, headers map[string]string) (*mcpsdk.ClientSession, error) {
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "relay", Version: "1.0.0"}, nil)
	transport := &mcpsdk.StreamableClientTransport{
		Endpoint: url,
		HTTPClient: &http.Client{
			Timeout:   callTimeout,
			Transport: headerRoundTripper{base: http.DefaultTransport, headers: headers},
		},
	}
	connectCtx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	session, err := client.Connect(connectCtx, transport, nil)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	return session, nil
}

// ToolDef is a lightweight description of an MCP tool for the UI.
type ToolDef struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ListTools returns the tools advertised by a server (connects, lists, closes).
func ListTools(ctx context.Context, url string, headers map[string]string) ([]ToolDef, error) {
	session, err := Connect(ctx, url, headers)
	if err != nil {
		return nil, err
	}
	defer session.Close()

	res, err := session.ListTools(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("list tools: %w", err)
	}
	out := make([]ToolDef, 0, len(res.Tools))
	for _, t := range res.Tools {
		out = append(out, ToolDef{Name: t.Name, Description: t.Description})
	}
	return out, nil
}

// Tools connects to a server and adapts each MCP tool into a tools.Tool. Tool
// names are namespaced "<serverName>__<toolName>" to avoid cross-server
// collisions. The returned closer must be called when the tools are done with.
func Tools(ctx context.Context, serverName, url string, headers map[string]string) ([]tools.Tool, func(), error) {
	session, err := Connect(ctx, url, headers)
	if err != nil {
		return nil, func() {}, err
	}
	res, err := session.ListTools(ctx, nil)
	if err != nil {
		session.Close()
		return nil, func() {}, fmt.Errorf("list tools: %w", err)
	}

	prefix := sanitize(serverName)
	out := make([]tools.Tool, 0, len(res.Tools))
	for _, t := range res.Tools {
		var params map[string]any
		if t.InputSchema != nil {
			if raw, err := json.Marshal(t.InputSchema); err == nil {
				_ = json.Unmarshal(raw, &params)
			}
		}
		out = append(out, &mcpTool{
			session: session,
			remote:  t.Name,
			spec: tools.ToolSpec{
				Type: "function",
				Function: tools.FunctionSpec{
					Name:        prefix + "__" + t.Name,
					Description: t.Description,
					Parameters:  params,
				},
			},
		})
	}
	return out, func() { session.Close() }, nil
}

// mcpTool adapts one MCP tool to tools.Tool.
type mcpTool struct {
	session *mcpsdk.ClientSession
	remote  string // the tool's name on the MCP server (un-namespaced)
	spec    tools.ToolSpec
}

func (m *mcpTool) Spec() tools.ToolSpec { return m.spec }

func (m *mcpTool) Execute(ctx context.Context, args json.RawMessage) (string, error) {
	callCtx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()

	var argMap any
	if len(args) > 0 {
		_ = json.Unmarshal(args, &argMap)
	}
	res, err := m.session.CallTool(callCtx, &mcpsdk.CallToolParams{
		Name:      m.remote,
		Arguments: argMap,
	})
	if err != nil {
		return "", fmt.Errorf("call %s: %w", m.remote, err)
	}
	return contentString(res), nil
}

// contentString flattens an MCP tool result's content blocks into text.
func contentString(res *mcpsdk.CallToolResult) string {
	if res == nil {
		return ""
	}
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*mcpsdk.TextContent); ok {
			b.WriteString(tc.Text)
			b.WriteByte('\n')
		}
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		// Non-text content (images, etc.) — surface a JSON fallback.
		if raw, err := json.Marshal(res.Content); err == nil {
			return string(raw)
		}
	}
	if res.IsError {
		return "tool error: " + out
	}
	return out
}

// sanitize makes a server name safe for use in a function-name prefix.
func sanitize(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	s := b.String()
	if s == "" {
		return "mcp"
	}
	return s
}
