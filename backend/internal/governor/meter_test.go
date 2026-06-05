package governor

import (
	"testing"

	"github.com/johnbetancur/vision/backend/internal/modelmeta"
)

func TestRunMeter_Exceeded(t *testing.T) {
	// $3/$15 per 1M (claude-sonnet-style). 1M prompt + 1M completion = $18.
	price := &modelmeta.Price{Input: 3, Output: 15}

	tests := []struct {
		name       string
		price      *modelmeta.Price
		maxTokens  int64
		maxCostUSD float64
		prompt     int64
		complete   int64
		wantStop   bool
		wantReason string // substring; "" means don't check
	}{
		{
			name:      "both off never stops",
			price:     price,
			prompt:    10_000_000,
			complete:  10_000_000,
			wantStop:  false,
		},
		{
			name:       "token cap trips at threshold",
			maxTokens:  1000,
			prompt:     600,
			complete:   400,
			wantStop:   true,
			wantReason: "token limit",
		},
		{
			name:      "token cap not yet reached",
			maxTokens: 1000,
			prompt:    500,
			complete:  400,
			wantStop:  false,
		},
		{
			name:       "cost cap trips when price known",
			price:      price,
			maxCostUSD: 1.00,
			prompt:     1_000_000, // $3 input alone
			complete:   0,
			wantStop:   true,
			wantReason: "cost limit",
		},
		{
			name:       "cost cap inert when price unknown — token floor protects",
			price:      nil, // unknown pricing
			maxCostUSD: 0.01,
			maxTokens:  1000,
			prompt:     2000,
			complete:   0,
			wantStop:   true,
			wantReason: "token limit", // NOT cost — cost is inert without price
		},
		{
			name:       "cost cap fully inert when price unknown and no token cap",
			price:      nil,
			maxCostUSD: 0.01,
			prompt:     100_000_000,
			complete:   100_000_000,
			wantStop:   false, // nothing can stop it; dollars unknowable
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := NewRunMeter(tc.price, tc.maxTokens, tc.maxCostUSD)
			m.Add(tc.prompt, tc.complete)
			stop, reason := m.Exceeded()
			if stop != tc.wantStop {
				t.Fatalf("Exceeded() stop = %v, want %v (reason %q)", stop, tc.wantStop, reason)
			}
			if tc.wantReason != "" && !contains(reason, tc.wantReason) {
				t.Fatalf("Exceeded() reason = %q, want substring %q", reason, tc.wantReason)
			}
		})
	}
}

func TestRunMeter_CostKnownFlag(t *testing.T) {
	known := NewRunMeter(&modelmeta.Price{Input: 3, Output: 15}, 0, 0)
	known.Add(1_000_000, 0)
	if usd, ok := known.CostUSD(); !ok || usd != 3 {
		t.Fatalf("known cost = $%v ok=%v, want $3 ok=true", usd, ok)
	}

	unknown := NewRunMeter(nil, 0, 0)
	unknown.Add(1_000_000, 0)
	if usd, ok := unknown.CostUSD(); ok || usd != 0 {
		t.Fatalf("unknown cost = $%v ok=%v, want $0 ok=false", usd, ok)
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
