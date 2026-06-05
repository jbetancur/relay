package connections

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/johnbetancur/vision/backend/internal/httputil"
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

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	conns, err := h.store.List()
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conns == nil {
		conns = []Connection{}
	}
	httputil.WriteJSON(w, http.StatusOK, conns)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	conn, err := h.store.GetByID(id)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conn == nil {
		httputil.WriteError(w, http.StatusNotFound, "connection not found")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, conn)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var input ConnectionInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if input.TypeHint == "" {
		input.TypeHint = TypeOpenAI
	}
	conn, err := h.store.Create(input)
	if err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, conn)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var input ConnectionInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	conn, err := h.store.Update(id, input)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "connection not found" {
			status = http.StatusNotFound
		}
		httputil.WriteError(w, status, err.Error())
		return
	}
	httputil.WriteJSON(w, http.StatusOK, conn)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.store.Delete(id); err != nil {
		status := http.StatusInternalServerError
		if err.Error() == "connection not found" {
			status = http.StatusNotFound
		}
		httputil.WriteError(w, status, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Models proxies GET /v1/models from the connection's upstream.
func (h *Handler) Models(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	conn, err := h.store.GetByID(id)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conn == nil {
		httputil.WriteError(w, http.StatusNotFound, "connection not found")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet,
		httputil.NormalizeBaseURL(conn.BaseURL)+"/v1/models", nil)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("build request: %v", err))
		return
	}
	httputil.SetProviderAuth(req, string(conn.TypeHint), conn.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		httputil.WriteError(w, http.StatusBadGateway, fmt.Sprintf("upstream error: %v", err))
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// ModelMeta returns per-model metadata (context window, pricing, capabilities).
func (h *Handler) ModelMeta(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	conn, err := h.store.GetByID(id)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conn == nil {
		httputil.WriteError(w, http.StatusNotFound, "connection not found")
		return
	}

	model := r.URL.Query().Get("model")
	if model == "" {
		httputil.WriteJSON(w, http.StatusOK, modelmeta.Table())
		return
	}

	meta := modelmeta.Resolve(r.Context(), modelmeta.Conn{
		ID:       conn.ID,
		BaseURL:  conn.BaseURL,
		APIKey:   conn.APIKey,
		TypeHint: string(conn.TypeHint),
	}, model)
	httputil.WriteJSON(w, http.StatusOK, meta)
}

// Test makes a live GET /v1/models call against the supplied base URL + key and
// reports whether auth/connectivity works.
func (h *Handler) Test(w http.ResponseWriter, r *http.Request) {
	var input ConnectionInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	baseURL := strings.TrimSpace(input.BaseURL)
	apiKey := strings.TrimSpace(input.APIKey)
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		httputil.WriteError(w, http.StatusBadRequest, "baseUrl must start with http:// or https://")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet,
		httputil.NormalizeBaseURL(baseURL)+"/v1/models", nil)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("build request: %v", err))
		return
	}
	httputil.SetProviderAuth(req, string(input.TypeHint), apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": fmt.Sprintf("could not reach %s: %v", baseURL, err)})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":     false,
		"status": resp.StatusCode,
		"error":  upstreamMessage(body, resp.StatusCode),
	})
}

// Balance fetches the remaining credit balance from providers that expose one.
func (h *Handler) Balance(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	conn, err := h.store.GetByID(id)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conn == nil {
		httputil.WriteError(w, http.StatusNotFound, "connection not found")
		return
	}

	if !strings.Contains(conn.BaseURL, "openrouter.ai") {
		httputil.WriteError(w, http.StatusNotFound, "balance not supported for this provider")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://openrouter.ai/api/v1/credits", nil)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("build request: %v", err))
		return
	}
	httputil.SetProviderAuth(req, string(conn.TypeHint), conn.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		httputil.WriteError(w, http.StatusBadGateway, fmt.Sprintf("upstream error: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		httputil.WriteError(w, http.StatusBadGateway, upstreamMessage(body, resp.StatusCode))
		return
	}

	var result struct {
		Data struct {
			TotalCredits float64 `json:"total_credits"`
			TotalUsage   float64 `json:"total_usage"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		httputil.WriteError(w, http.StatusBadGateway, "failed to parse balance response")
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"total_credits":     result.Data.TotalCredits,
		"total_usage":       result.Data.TotalUsage,
		"credits_remaining": result.Data.TotalCredits - result.Data.TotalUsage,
	})
}

// upstreamMessage pulls a human-readable error from an OpenAI-style error body.
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
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httputil.WriteJSON(w, http.StatusOK, stats)
}

func (h *Handler) UsageByModel(w http.ResponseWriter, r *http.Request) {
	var since int64
	if v := r.URL.Query().Get("since"); v != "" {
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
			since = parsed
		}
	}
	rows, err := h.usageStore.UsageByModel(since)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rows == nil {
		rows = []usage.ModelUsage{}
	}
	httputil.WriteJSON(w, http.StatusOK, rows)
}

func (h *Handler) ResetStats(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.usageStore.Reset(id); err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
