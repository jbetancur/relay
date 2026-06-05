// Package governor enforces cost controls on an agent run. It is deliberately
// pure (no DB, no HTTP) so the enforcement logic is unit-testable and reusable
// by both the in-loop RunMeter and the pre-run ceiling check.
//
// Dual-cap principle: token caps are the reliable floor — token counts are
// always known from the upstream usage block. Dollar caps sit on top and are
// best-effort: they only engage when per-model pricing is known. When price is
// unknown, the dollar cap is inert and the token cap still protects the run.
package governor

import (
	"fmt"

	"github.com/johnbetancur/vision/backend/internal/modelmeta"
)

// RunMeter accumulates one run's token usage and answers "should I stop now?".
// Zero caps mean "no limit" for that dimension.
type RunMeter struct {
	price      *modelmeta.Price // nil ⇒ dollar cost unknown; cost cap inert
	promptTok  int64
	completTok int64
	maxTokens  int64   // 0 = off
	maxCostUSD float64 // 0 = off
}

// NewRunMeter builds a meter for a run. price may be nil (unknown pricing).
func NewRunMeter(price *modelmeta.Price, maxTokens int64, maxCostUSD float64) *RunMeter {
	return &RunMeter{price: price, maxTokens: maxTokens, maxCostUSD: maxCostUSD}
}

// Add records one round's token usage.
func (m *RunMeter) Add(promptTokens, completionTokens int64) {
	m.promptTok += promptTokens
	m.completTok += completionTokens
}

// Tokens returns cumulative total tokens this run.
func (m *RunMeter) Tokens() int64 { return m.promptTok + m.completTok }

// CostUSD returns the cumulative dollar cost and whether it is known. When price
// is nil, known is false and the returned cost is 0.
func (m *RunMeter) CostUSD() (usd float64, known bool) {
	if m.price == nil {
		return 0, false
	}
	return Cost(m.price, m.promptTok, m.completTok), true
}

// Exceeded reports whether a cap has been hit and a human-readable reason.
// The token cap is checked whenever set; the cost cap only when price is known.
func (m *RunMeter) Exceeded() (stop bool, reason string) {
	if m.maxTokens > 0 && m.Tokens() >= m.maxTokens {
		return true, fmt.Sprintf("token limit reached: %d ≥ %d tokens this run", m.Tokens(), m.maxTokens)
	}
	if m.maxCostUSD > 0 && m.price != nil {
		if usd, _ := m.CostUSD(); usd >= m.maxCostUSD {
			return true, fmt.Sprintf("cost limit reached: $%.4f ≥ $%.2f this run", usd, m.maxCostUSD)
		}
	}
	return false, ""
}

// Cost computes USD for the given token counts using per-1M-token pricing.
func Cost(price *modelmeta.Price, promptTokens, completionTokens int64) float64 {
	if price == nil {
		return 0
	}
	return float64(promptTokens)/1_000_000*price.Input +
		float64(completionTokens)/1_000_000*price.Output
}
