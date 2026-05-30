package modelmeta

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

const probeTimeout = 3 * time.Second

// Conn is the minimal connection info Resolve needs. Defined here (rather than
// importing the connections package) to avoid an import cycle, since the
// connections handler calls into modelmeta.
type Conn struct {
	ID       string
	BaseURL  string
	APIKey   string
	TypeHint string
}

var (
	cacheMu sync.RWMutex
	cache   = map[string]Meta{} // key: connID + "\x00" + model
)

// Resolve returns the best-known metadata for a model on a connection: probe the
// provider where supported, fall back to the static table, cache the result.
func Resolve(ctx context.Context, conn Conn, model string) Meta {
	key := conn.ID + "\x00" + model
	cacheMu.RLock()
	if m, ok := cache[key]; ok {
		cacheMu.RUnlock()
		return m
	}
	cacheMu.RUnlock()

	merged := lookupTable(model)
	if probed, ok := probe(ctx, conn, model); ok {
		// Probe wins per-field; table fills any gaps the probe left.
		if probed.ContextWindow > 0 {
			merged.ContextWindow = probed.ContextWindow
		}
		if probed.Price != nil {
			merged.Price = probed.Price
		}
		// Capabilities always come from the table (providers don't expose them).
		merged.Source = "probe"
	}

	cacheMu.Lock()
	cache[key] = merged
	cacheMu.Unlock()
	return merged
}

// probe dispatches to a provider-specific prober based on the connection.
// Returns (meta, true) only when the provider actually yielded something.
func probe(ctx context.Context, conn Conn, model string) (Meta, bool) {
	base := strings.TrimRight(conn.BaseURL, "/")
	switch {
	case conn.TypeHint == "ollama":
		return probeOllama(ctx, base, conn.APIKey, model)
	case strings.Contains(strings.ToLower(base), "openrouter"):
		return probeOpenRouter(ctx, base, conn.APIKey, model)
	default:
		return Meta{}, false
	}
}

func httpClient() *http.Client { return &http.Client{Timeout: probeTimeout} }

// probeOllama reads context length from POST /api/show. The window lives under
// model_info as "<arch>.context_length", which varies by model, so we scan for
// any key ending in ".context_length".
func probeOllama(ctx context.Context, base, apiKey, model string) (Meta, bool) {
	body, _ := json.Marshal(map[string]string{"name": model})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/show", bytes.NewReader(body))
	if err != nil {
		return Meta{}, false
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := httpClient().Do(req)
	if err != nil {
		return Meta{}, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Meta{}, false
	}
	var payload struct {
		ModelInfo map[string]json.RawMessage `json:"model_info"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return Meta{}, false
	}
	for k, raw := range payload.ModelInfo {
		if strings.HasSuffix(k, ".context_length") {
			var n int
			if json.Unmarshal(raw, &n) == nil && n > 0 {
				return Meta{ContextWindow: n, Source: "probe"}, true
			}
		}
	}
	return Meta{}, false
}

// probeOpenRouter reads context_length and pricing from GET /models.
func probeOpenRouter(ctx context.Context, base, apiKey, model string) (Meta, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/models", nil)
	if err != nil {
		return Meta{}, false
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := httpClient().Do(req)
	if err != nil {
		return Meta{}, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Meta{}, false
	}
	var payload struct {
		Data []struct {
			ID            string `json:"id"`
			ContextLength int    `json:"context_length"`
			Pricing       struct {
				Prompt     string `json:"prompt"`
				Completion string `json:"completion"`
			} `json:"pricing"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return Meta{}, false
	}
	for _, m := range payload.Data {
		if m.ID != model {
			continue
		}
		out := Meta{ContextWindow: m.ContextLength, Source: "probe"}
		// OpenRouter prices are USD per token as strings; convert to per-1M.
		in := parsePerMillion(m.Pricing.Prompt)
		comp := parsePerMillion(m.Pricing.Completion)
		if in > 0 || comp > 0 {
			out.Price = &Price{Input: in, Output: comp}
		}
		return out, true
	}
	return Meta{}, false
}

func parsePerMillion(s string) float64 {
	if s == "" {
		return 0
	}
	var perToken float64
	if _, err := jsonNumber(s, &perToken); err != nil {
		return 0
	}
	return perToken * 1_000_000
}

// jsonNumber parses a numeric string leniently via the json package.
func jsonNumber(s string, out *float64) (bool, error) {
	if err := json.Unmarshal([]byte(s), out); err != nil {
		return false, err
	}
	return true, nil
}
