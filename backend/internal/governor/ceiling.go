package governor

import (
	"fmt"
	"time"

	"github.com/johnbetancur/vision/backend/internal/modelmeta"
)

// PeriodBudget is one period ceiling for a subject (e.g. an agent's daily or
// monthly limit). Zero limits mean "no ceiling" for that dimension.
type PeriodBudget struct {
	Period      string // "day" | "month"
	LimitUSD    float64
	LimitTokens int64
}

// ModelTokens is summed token usage for a single model over the lookback window.
type ModelTokens struct {
	Model            string
	PromptTokens     int64
	CompletionTokens int64
}

// PriceFunc resolves per-1M-token pricing for a model, or nil when unknown.
type PriceFunc func(model string) *modelmeta.Price

// CheckCeiling reports whether a new run is allowed under the subject's period
// budgets. usageSince returns summed usage for the period's lookback window;
// price converts per-model tokens to USD. Dual-cap: token limits are the
// reliable floor (always enforceable); USD limits engage only for models whose
// price is known — unpriced usage simply contributes 0 to the dollar total, so
// a USD ceiling never blocks on usage it cannot value.
//
// Returns (true, "") when allowed, (false, reason) when a ceiling is hit.
func CheckCeiling(
	budgets []PeriodBudget,
	now time.Time,
	usageSince func(sinceMillis int64) ([]ModelTokens, error),
	price PriceFunc,
) (allowed bool, reason string) {
	for _, b := range budgets {
		if b.LimitUSD <= 0 && b.LimitTokens <= 0 {
			continue // ceiling disabled
		}
		since := periodStart(now, b.Period)
		usage, err := usageSince(since.UnixMilli())
		if err != nil {
			// Fail open on a usage-read error: a transient DB issue must not
			// silently block all runs. The per-run meter still protects.
			continue
		}

		var totalTokens int64
		var totalUSD float64
		for _, u := range usage {
			totalTokens += u.PromptTokens + u.CompletionTokens
			if p := price(u.Model); p != nil {
				totalUSD += Cost(p, u.PromptTokens, u.CompletionTokens)
			}
		}

		if b.LimitTokens > 0 && totalTokens >= b.LimitTokens {
			return false, fmt.Sprintf("%s token ceiling reached: %d ≥ %d tokens", b.Period, totalTokens, b.LimitTokens)
		}
		if b.LimitUSD > 0 && totalUSD >= b.LimitUSD {
			return false, fmt.Sprintf("%s cost ceiling reached: $%.2f ≥ $%.2f", b.Period, totalUSD, b.LimitUSD)
		}
	}
	return true, ""
}

// periodStart returns the inclusive start of the current day or month in the
// given time's location. An unknown period falls back to the day start.
func periodStart(now time.Time, period string) time.Time {
	y, m, d := now.Date()
	loc := now.Location()
	switch period {
	case "month":
		return time.Date(y, m, 1, 0, 0, 0, 0, loc)
	default: // "day"
		return time.Date(y, m, d, 0, 0, 0, 0, loc)
	}
}
