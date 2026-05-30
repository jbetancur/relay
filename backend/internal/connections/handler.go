package connections

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/johnbetancur/vision/backend/internal/modelmeta"
	"github.com/johnbetancur/vision/backend/internal/usage"
)

type Handler struct {
	store      *Store
	usageStore *usage.Store
}

func NewHandler(store *Store, usageStore *usage.Store) *Handler {
	return &Handler{store: store, usageStore: usageStore}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	conns, err := h.store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conns == nil {
		conns = []Connection{}
	}
	writeJSON(w, http.StatusOK, conns)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	conn, err := h.store.GetByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conn == nil {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}
	writeJSON(w, http.StatusOK, conn)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var input ConnectionInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if input.TypeHint == "" {
		input.TypeHint = TypeOpenAI
	}
	conn, err := h.store.Create(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, conn)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var input ConnectionInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	conn, err := h.store.Update(id, input)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "connection not found" {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, conn)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.store.Delete(id); err != nil {
		status := http.StatusInternalServerError
		if err.Error() == "connection not found" {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Models proxies GET /v1/models from the connection's upstream.
func (h *Handler) Models(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	conn, err := h.store.GetByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conn == nil {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}

	baseURL := strings.TrimRight(conn.BaseURL, "/")
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, baseURL+"/v1/models", nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("build request: %v", err))
		return
	}
	if conn.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+conn.APIKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("upstream error: %v", err))
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// ModelMeta returns per-model metadata (context window, pricing, capabilities).
// With ?model=<id> it resolves a single model, probing the provider where
// supported; without it, it returns the full static table for bulk frontend use.
func (h *Handler) ModelMeta(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	conn, err := h.store.GetByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conn == nil {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}

	model := r.URL.Query().Get("model")
	if model == "" {
		writeJSON(w, http.StatusOK, modelmeta.Table())
		return
	}

	meta := modelmeta.Resolve(r.Context(), modelmeta.Conn{
		ID:       conn.ID,
		BaseURL:  conn.BaseURL,
		APIKey:   conn.APIKey,
		TypeHint: string(conn.TypeHint),
	}, model)
	writeJSON(w, http.StatusOK, meta)
}

// Test makes a live GET /v1/models call against the supplied base URL + key and
// reports whether auth/connectivity works. Accepts a ConnectionInput body so a
// connection can be validated before it is saved. Surfaces the upstream status
// and error body so the user sees the real reason (e.g. invalid_api_key).
func (h *Handler) Test(w http.ResponseWriter, r *http.Request) {
	var input ConnectionInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	baseURL := strings.TrimSpace(input.BaseURL)
	apiKey := strings.TrimSpace(input.APIKey)
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		writeError(w, http.StatusBadRequest, "baseUrl must start with http:// or https://")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, strings.TrimRight(baseURL, "/")+"/v1/models", nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("build request: %v", err))
		return
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": fmt.Sprintf("could not reach %s: %v", baseURL, err)})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     false,
		"status": resp.StatusCode,
		"error":  upstreamMessage(body, resp.StatusCode),
	})
}

// upstreamMessage pulls a human-readable error from an OpenAI-style error body,
// falling back to the raw text / status.
func upstreamMessage(body []byte, status int) string {
	var parsed struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &parsed) == nil && parsed.Error.Message != "" {
		return parsed.Error.Message
	}
	if len(body) > 0 {
		return string(body)
	}
	return fmt.Sprintf("upstream returned %d", status)
}

func (h *Handler) GetStats(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	stats, err := h.usageStore.Get(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// UsageByModel returns per-model token totals across all connections, optionally
// filtered to events at or after the `since` query param (unix millis). The
// frontend multiplies these by its pricing table to compute cost/budgets.
func (h *Handler) UsageByModel(w http.ResponseWriter, r *http.Request) {
	var since int64
	if v := r.URL.Query().Get("since"); v != "" {
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
			since = parsed
		}
	}
	rows, err := h.usageStore.UsageByModel(since)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rows == nil {
		rows = []usage.ModelUsage{}
	}
	writeJSON(w, http.StatusOK, rows)
}

func (h *Handler) ResetStats(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.usageStore.Reset(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
