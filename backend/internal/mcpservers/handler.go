package mcpservers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/johnbetancur/vision/backend/internal/mcp"
)

type Handler struct {
	store *Store
}

func NewHandler(store *Store) *Handler {
	return &Handler{store: store}
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
	servers, err := h.store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if servers == nil {
		servers = []MCPServer{}
	}
	writeJSON(w, http.StatusOK, servers)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	m, err := h.store.GetByID(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if m == nil {
		writeError(w, http.StatusNotFound, "mcp server not found")
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var input MCPServerInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	m, err := h.store.Create(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	var input MCPServerInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	m, err := h.store.Update(chi.URLParam(r, "id"), input)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "mcp server not found" {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if err := h.store.Delete(chi.URLParam(r, "id")); err != nil {
		status := http.StatusInternalServerError
		if err.Error() == "mcp server not found" {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Test connects to a server (from the request body, so it works before saving)
// and lists its tools, reporting the count or the real connection error.
func (h *Handler) Test(w http.ResponseWriter, r *http.Request) {
	var input MCPServerInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	input = normalize(input)
	if err := validate(input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	defs, err := mcp.ListTools(r.Context(), input.URL, input.Headers)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "toolCount": len(defs), "tools": defs})
}

// Tools lists a saved server's tools (for showing what a server offers in the UI).
func (h *Handler) Tools(w http.ResponseWriter, r *http.Request) {
	m, err := h.store.GetByID(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if m == nil {
		writeError(w, http.StatusNotFound, "mcp server not found")
		return
	}
	defs, err := mcp.ListTools(r.Context(), m.URL, m.Headers)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "tools": defs})
}
