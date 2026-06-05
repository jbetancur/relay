// Package httputil provides shared HTTP response helpers and provider-auth
// utilities used across all handler packages.
package httputil

import (
	"encoding/json"
	"net/http"
	"strings"
)

// WriteJSON encodes v as JSON and writes it with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes a JSON {"error": msg} response.
func WriteError(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]string{"error": msg})
}

// SetProviderAuth sets the correct auth header(s) for the given provider type.
// Anthropic uses x-api-key + anthropic-version; all others use Bearer.
func SetProviderAuth(req *http.Request, typeHint, apiKey string) {
	if apiKey == "" {
		return
	}
	if typeHint == "anthropic" {
		req.Header.Set("x-api-key", apiKey)
		if req.Header.Get("anthropic-version") == "" {
			req.Header.Set("anthropic-version", "2023-06-01")
		}
	} else {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
}

// NormalizeBaseURL trims a trailing slash from a base URL.
func NormalizeBaseURL(base string) string {
	return strings.TrimRight(base, "/")
}
