// Package budget bridges the pure governor.CheckCeiling function to the
// application's store layer. Both the agent run handler and the router handler
// need this logic; centralising it here keeps them DRY.
package budget

import (
	"context"
	"time"

	"github.com/johnbetancur/vision/backend/internal/agents"
	"github.com/johnbetancur/vision/backend/internal/governor"
	"github.com/johnbetancur/vision/backend/internal/usage"
)

// Checker holds the stores needed to evaluate a period ceiling.
type Checker struct {
	agentsStore *agents.Store
	usageStore  *usage.Store
}

// NewChecker creates a Checker backed by the given stores.
func NewChecker(agentsStore *agents.Store, usageStore *usage.Store) *Checker {
	return &Checker{agentsStore: agentsStore, usageStore: usageStore}
}

// WithinCeiling reports whether agentID is under all of its period budgets.
// price resolves per-model pricing for USD cost accumulation — callers supply
// this closure so the budget package avoids importing connections (cycle).
// Returns (true, "") when allowed or when no budgets are configured.
func (c *Checker) WithinCeiling(ctx context.Context, agentID string, price governor.PriceFunc) (bool, string) {
	rows, err := c.agentsStore.GetBudgets("agent", agentID)
	if err != nil || len(rows) == 0 {
		return true, ""
	}

	budgets := make([]governor.PeriodBudget, 0, len(rows))
	for _, b := range rows {
		budgets = append(budgets, governor.PeriodBudget{
			Period:      b.Period,
			LimitUSD:    b.LimitUSD,
			LimitTokens: b.LimitTokens,
		})
	}

	usageSince := func(sinceMillis int64) ([]governor.ModelTokens, error) {
		mu, err := c.usageStore.AgentUsageSince(agentID, sinceMillis)
		if err != nil {
			return nil, err
		}
		out := make([]governor.ModelTokens, 0, len(mu))
		for _, m := range mu {
			out = append(out, governor.ModelTokens{
				Model:            m.Model,
				PromptTokens:     m.PromptTokens,
				CompletionTokens: m.CompletionTokens,
			})
		}
		return out, nil
	}

	return governor.CheckCeiling(budgets, time.Now(), usageSince, price)
}
