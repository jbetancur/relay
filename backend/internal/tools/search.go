package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
)

// WebSearch is the web search tool. It is provider-pluggable: a SearchProvider
// performs the actual query. When no provider is configured it advertises the
// tool but returns a clear message instructing the operator to configure one.
//
// To enable: implement SearchProvider (e.g. Brave/Tavily/SearXNG), then set
// ws.provider in NewWebSearch based on env/config. The agent loop, tool spec,
// and frontend rendering all work unchanged once a provider is present.
type WebSearch struct {
	provider SearchProvider
}

// SearchProvider performs a web search and returns ranked results.
type SearchProvider interface {
	Search(ctx context.Context, query string, limit int) ([]SearchResult, error)
}

type SearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

func NewWebSearch() *WebSearch {
	// Provider selection happens here once one is implemented, e.g.:
	//   if key := os.Getenv("TAVILY_API_KEY"); key != "" { return &WebSearch{provider: tavily(key)} }
	// Reference the env so the intended wiring is discoverable and vet-clean.
	_ = os.Getenv("RELAY_SEARCH_PROVIDER")
	return &WebSearch{provider: nil}
}

func (w *WebSearch) Spec() ToolSpec {
	return ToolSpec{
		Type: "function",
		Function: FunctionSpec{
			Name:        "web_search",
			Description: "Search the web for current information. Use when the user asks about recent events, facts you're unsure of, or anything that may have changed since training.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{
						"type":        "string",
						"description": "The search query.",
					},
				},
				"required": []string{"query"},
			},
		},
	}
}

func (w *WebSearch) Execute(ctx context.Context, args json.RawMessage) (string, error) {
	var a struct {
		Query string `json:"query"`
	}
	if err := json.Unmarshal(args, &a); err != nil {
		return "", fmt.Errorf("invalid arguments: %w", err)
	}
	if a.Query == "" {
		return "", fmt.Errorf("query is required")
	}

	if w.provider == nil {
		// Framework is live; provider is not yet configured.
		return "Web search is not configured on this Relay instance. " +
			"Answer from your own knowledge and note that you could not search the web.", nil
	}

	results, err := w.provider.Search(ctx, a.Query, 5)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(results)
	return string(out), nil
}
