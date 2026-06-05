package router

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/johnbetancur/vision/backend/internal/agents"
	"github.com/johnbetancur/vision/backend/internal/budget"
	"github.com/johnbetancur/vision/backend/internal/connections"
	"github.com/johnbetancur/vision/backend/internal/governor"
	"github.com/johnbetancur/vision/backend/internal/httputil"
	"github.com/johnbetancur/vision/backend/internal/modelmeta"
	"github.com/johnbetancur/vision/backend/internal/usage"
)

// Handler serves POST /api/route: it picks the best (model, connection) for a
// task by complexity, honoring per-agent budget ceilings when an agentId is
// given. It returns the decision only — the caller streams the completion
// through the existing /api/v1 proxy.
type Handler struct {
	connStore   *connections.Store
	agentsStore *agents.Store
	usageStore  *usage.Store
	budgetCheck *budget.Checker
	client      *http.Client
}

func NewHandler(connStore *connections.Store, agentsStore *agents.Store, usageStore *usage.Store) *Handler {
	return &Handler{
		connStore:   connStore,
		agentsStore: agentsStore,
		usageStore:  usageStore,
		budgetCheck: budget.NewChecker(agentsStore, usageStore),
		client:      &http.Client{Timeout: 5 * time.Second},
	}
}

type routeMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type routeRequest struct {
	Task     string         `json:"task"`
	Messages []routeMessage `json:"messages,omitempty"`
	Hints    struct {
		FileCount    int    `json:"fileCount"`
		SelectionLen int    `json:"selectionLen"`
		Language     string `json:"language"`
		HasDiff      bool   `json:"hasDiff"`
	} `json:"hints"`
	AgentID string `json:"agentId,omitempty"`
}

type routeResponse struct {
	Model          string      `json:"model"`
	ConnectionID   string      `json:"connectionId"`
	Tier           Tier        `json:"tier"`
	Reason         string      `json:"reason"`
	Confidence     float64     `json:"confidence"`
	Candidates     []Candidate `json:"candidates"`
	ClassifierUsed bool        `json:"classifierUsed"`
}

// Route handles POST /api/route.
func (h *Handler) Route(w http.ResponseWriter, r *http.Request) {
	var req routeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if strings.TrimSpace(req.Task) == "" && len(req.Messages) == 0 {
		httputil.WriteError(w, http.StatusBadRequest, "task or messages required")
		return
	}

	ctx := r.Context()
	candidates := h.buildCandidates(ctx)
	if len(candidates) == 0 {
		httputil.WriteError(w, http.StatusServiceUnavailable, "no models available on any enabled connection")
		return
	}

	score := ScoreHeuristic(h.signals(req))
	targetTier := score.Tier
	reason := score.Reason
	classifierUsed := false

	if score.Ambiguous {
		if local, ok := pickInTier(candidates, TierLocal); ok {
			if value, used := h.classify(ctx, req.Task, local); used {
				classifierUsed = true
				targetTier = tierForValue(value)
				reason = fmt.Sprintf("classifier rated complexity %.2f ⇒ %s", value, targetTier)
			}
		}
	}

	chosen, tier, finalReason := h.selectWithBudget(ctx, candidates, targetTier, reason, req.AgentID)

	httputil.WriteJSON(w, http.StatusOK, routeResponse{
		Model:          chosen.Model,
		ConnectionID:   chosen.ConnectionID,
		Tier:           tier,
		Reason:         finalReason,
		Confidence:     score.Confidence,
		Candidates:     candidates,
		ClassifierUsed: classifierUsed,
	})
}

func (h *Handler) signals(req routeRequest) Signals {
	chars := len(req.Task)
	for _, m := range req.Messages {
		chars += len(m.Content)
	}
	return Signals{
		Task:         req.Task,
		CharCount:    chars,
		FileCount:    req.Hints.FileCount,
		SelectionLen: req.Hints.SelectionLen,
		Language:     req.Hints.Language,
		HasDiff:      req.Hints.HasDiff,
	}
}

// selectWithBudget picks the cheapest candidate in targetTier, stepping down
// while the agent's budget ceiling would be exceeded.
func (h *Handler) selectWithBudget(
	ctx context.Context, candidates []Candidate, targetTier Tier, reason, agentID string,
) (Candidate, Tier, string) {
	for tier := targetTier; ; tier = downgrade(tier) {
		c, ok := pickInTier(candidates, tier)
		if !ok {
			if tier == TierLocal {
				return cheapest(candidates), tierOfCheapest(candidates), reason + " (no model in target tier)"
			}
			continue
		}
		if agentID == "" || h.withinBudget(ctx, agentID, c) {
			if tier != targetTier {
				reason += fmt.Sprintf(" — downgraded to %s (budget ceiling)", tier)
			}
			return c, tier, reason
		}
		if tier == TierLocal {
			return c, tier, reason + " — budget exceeded; using cheapest available"
		}
	}
}

func (h *Handler) withinBudget(ctx context.Context, agentID string, c Candidate) bool {
	price := func(model string) *modelmeta.Price {
		return h.resolvePrice(ctx, c.ConnectionID, model)
	}
	allowed, _ := h.budgetCheck.WithinCeiling(ctx, agentID, governor.PriceFunc(price))
	return allowed
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

// buildCandidates lists models on every enabled connection, mapped to a tier.
func (h *Handler) buildCandidates(ctx context.Context) []Candidate {
	conns, err := h.connStore.List()
	if err != nil {
		return nil
	}
	var out []Candidate
	for _, lite := range conns {
		if !lite.Enabled {
			continue
		}
		conn, err := h.connStore.GetByID(lite.ID)
		if err != nil || conn == nil {
			continue
		}
		for _, model := range h.fetchModels(ctx, conn) {
			meta := modelmeta.Resolve(ctx, modelmeta.Conn{
				ID: conn.ID, BaseURL: conn.BaseURL, APIKey: conn.APIKey, TypeHint: string(conn.TypeHint),
			}, model)
			if meta.Kind != "" && meta.Kind != "chat" {
				continue
			}
			out = append(out, Candidate{
				ConnectionID:  conn.ID,
				Model:         model,
				Tier:          tierFor(string(conn.TypeHint), meta, model),
				Price:         meta.Price,
				ContextWindow: meta.ContextWindow,
				Capabilities:  meta.Capabilities,
			})
		}
	}
	return out
}

// fetchModels reads the upstream /v1/models list. Returns nil on any error so
// a single down provider never blocks routing.
func (h *Handler) fetchModels(ctx context.Context, conn *connections.Connection) []string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		httputil.NormalizeBaseURL(conn.BaseURL)+"/v1/models", nil)
	if err != nil {
		return nil
	}
	httputil.SetProviderAuth(req, string(conn.TypeHint), conn.APIKey)

	resp, err := h.client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil
	}
	out := make([]string, 0, len(parsed.Data))
	for _, m := range parsed.Data {
		if m.ID != "" {
			out = append(out, m.ID)
		}
	}
	return out
}

// ── candidate selection helpers ──────────────────────────────────────────────

func pickInTier(candidates []Candidate, tier Tier) (Candidate, bool) {
	var inTier []Candidate
	for _, c := range candidates {
		if c.Tier == tier {
			inTier = append(inTier, c)
		}
	}
	if len(inTier) == 0 {
		return Candidate{}, false
	}
	sort.SliceStable(inTier, func(i, j int) bool {
		return priceKey(inTier[i]) < priceKey(inTier[j])
	})
	return inTier[0], true
}

func priceKey(c Candidate) float64 {
	if p := c.blendedPrice(); p >= 0 {
		return p
	}
	return 1e9
}

func cheapest(candidates []Candidate) Candidate {
	best := candidates[0]
	for _, c := range candidates[1:] {
		if priceKey(c) < priceKey(best) {
			best = c
		}
	}
	return best
}

func tierOfCheapest(candidates []Candidate) Tier { return cheapest(candidates).Tier }

func downgrade(t Tier) Tier {
	switch t {
	case TierFrontier:
		return TierMid
	default:
		return TierLocal
	}
}
