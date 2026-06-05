package governor

import (
	"errors"
	"testing"
	"time"

	"github.com/johnbetancur/vision/backend/internal/modelmeta"
)

func priceKnown(model string) *modelmeta.Price {
	return &modelmeta.Price{Input: 3, Output: 15} // $3/$15 per 1M
}
func priceUnknown(string) *modelmeta.Price { return nil }

func usage(models ...ModelTokens) func(int64) ([]ModelTokens, error) {
	return func(int64) ([]ModelTokens, error) { return models, nil }
}

func TestCheckCeiling(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name      string
		budgets   []PeriodBudget
		usageFn   func(int64) ([]ModelTokens, error)
		price     PriceFunc
		wantAllow bool
		wantSub   string
	}{
		{
			name:      "no budgets allows",
			budgets:   nil,
			usageFn:   usage(ModelTokens{"m", 9_999_999, 9_999_999}),
			price:     priceKnown,
			wantAllow: true,
		},
		{
			name:      "disabled budget (both zero) allows",
			budgets:   []PeriodBudget{{Period: "day"}},
			usageFn:   usage(ModelTokens{"m", 9_999_999, 0}),
			price:     priceKnown,
			wantAllow: true,
		},
		{
			name:      "token ceiling hit blocks",
			budgets:   []PeriodBudget{{Period: "day", LimitTokens: 1000}},
			usageFn:   usage(ModelTokens{"m", 700, 400}),
			price:     priceUnknown,
			wantAllow: false,
			wantSub:   "token ceiling",
		},
		{
			name:      "token under ceiling allows",
			budgets:   []PeriodBudget{{Period: "day", LimitTokens: 1000}},
			usageFn:   usage(ModelTokens{"m", 500, 400}),
			price:     priceUnknown,
			wantAllow: true,
		},
		{
			name:      "cost ceiling hit when price known blocks",
			budgets:   []PeriodBudget{{Period: "month", LimitUSD: 2.0}},
			usageFn:   usage(ModelTokens{"m", 1_000_000, 0}), // $3 input
			price:     priceKnown,
			wantAllow: false,
			wantSub:   "cost ceiling",
		},
		{
			name:      "cost ceiling inert when price unknown — usage values to $0",
			budgets:   []PeriodBudget{{Period: "month", LimitUSD: 0.01}},
			usageFn:   usage(ModelTokens{"m", 100_000_000, 100_000_000}),
			price:     priceUnknown,
			wantAllow: true, // $0 computed ⇒ never exceeds a dollar ceiling
		},
		{
			name:      "fail open on usage read error",
			budgets:   []PeriodBudget{{Period: "day", LimitTokens: 1}},
			usageFn:   func(int64) ([]ModelTokens, error) { return nil, errors.New("db down") },
			price:     priceKnown,
			wantAllow: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			allow, reason := CheckCeiling(tc.budgets, now, tc.usageFn, tc.price)
			if allow != tc.wantAllow {
				t.Fatalf("CheckCeiling allow=%v, want %v (reason %q)", allow, tc.wantAllow, reason)
			}
			if tc.wantSub != "" && !contains(reason, tc.wantSub) {
				t.Fatalf("reason %q, want substring %q", reason, tc.wantSub)
			}
		})
	}
}

func TestPeriodStart(t *testing.T) {
	ref := time.Date(2026, 5, 31, 14, 30, 0, 0, time.UTC)
	if got := periodStart(ref, "day"); got != time.Date(2026, 5, 31, 0, 0, 0, 0, time.UTC) {
		t.Fatalf("day start = %v", got)
	}
	if got := periodStart(ref, "month"); got != time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC) {
		t.Fatalf("month start = %v", got)
	}
}
