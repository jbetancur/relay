package agents

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/johnbetancur/vision/backend/internal/httputil"
)

type Handler struct {
	store *Store
}

func NewHandler(store *Store) *Handler {
	return &Handler{store: store}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	agents, err := h.store.List()
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if agents == nil {
		agents = []Agent{}
	}
	httputil.WriteJSON(w, http.StatusOK, agents)
}

// Get resolves by id first, then slug — so both /api/agents/{id} and
// /api/agents/{my-agent-slug} work from the same route.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	ref := chi.URLParam(r, "id")
	a, err := h.store.GetByID(ref)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if a == nil {
		a, err = h.store.GetBySlug(ref)
		if err != nil {
			httputil.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if a == nil {
		httputil.WriteError(w, http.StatusNotFound, "agent not found")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, a)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var input AgentInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	a, err := h.store.Create(input)
	if err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, a)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	var input AgentInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	a, err := h.store.Update(chi.URLParam(r, "id"), input)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "agent not found" {
			status = http.StatusNotFound
		}
		httputil.WriteError(w, status, err.Error())
		return
	}
	httputil.WriteJSON(w, http.StatusOK, a)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if err := h.store.Delete(chi.URLParam(r, "id")); err != nil {
		status := http.StatusInternalServerError
		if err.Error() == "agent not found" {
			status = http.StatusNotFound
		}
		httputil.WriteError(w, status, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetBudgets returns all period budgets for an agent.
func (h *Handler) GetBudgets(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	budgets, err := h.store.GetBudgets("agent", agentID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if budgets == nil {
		budgets = []Budget{}
	}
	httputil.WriteJSON(w, http.StatusOK, budgets)
}

// UpsertBudget creates or updates a period budget for an agent.
func (h *Handler) UpsertBudget(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	a, err := h.store.GetByID(agentID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if a == nil {
		httputil.WriteError(w, http.StatusNotFound, "agent not found")
		return
	}
	var input BudgetInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	b, err := h.store.UpsertBudget("agent", agentID, input)
	if err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httputil.WriteJSON(w, http.StatusOK, b)
}
