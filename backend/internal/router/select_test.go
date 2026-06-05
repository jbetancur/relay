package router

import "testing"

func candidates() []Candidate {
	return []Candidate{
		{ConnectionID: "c1", Model: "llama-3", Tier: TierLocal, Price: price(0.1, 0.1)},
		{ConnectionID: "c2", Model: "claude-3-5-sonnet", Tier: TierMid, Price: price(3, 15)},
		{ConnectionID: "c2", Model: "claude-opus-4", Tier: TierFrontier, Price: price(15, 75)},
	}
}

func TestPickInTierChoosesCheapest(t *testing.T) {
	cs := []Candidate{
		{ConnectionID: "a", Model: "sonnet-pricey", Tier: TierMid, Price: price(5, 20)},
		{ConnectionID: "b", Model: "gpt-4o", Tier: TierMid, Price: price(2.5, 10)},
	}
	got, ok := pickInTier(cs, TierMid)
	if !ok || got.Model != "gpt-4o" {
		t.Fatalf("expected cheapest mid model gpt-4o, got %q (ok=%v)", got.Model, ok)
	}
}

func TestSelectWithBudgetNoAgentKeepsTarget(t *testing.T) {
	h := &Handler{}
	got, tier, _ := h.selectWithBudget(nil, candidates(), TierFrontier, "r", "")
	if tier != TierFrontier || got.Model != "claude-opus-4" {
		t.Fatalf("no-agent route should keep frontier opus, got %q @ %s", got.Model, tier)
	}
}

func TestSelectWithBudgetFallsBackWhenTierEmpty(t *testing.T) {
	h := &Handler{}
	// Only a local candidate exists; asking for frontier should fall to local.
	only := []Candidate{{ConnectionID: "c1", Model: "llama-3", Tier: TierLocal, Price: price(0.1, 0.1)}}
	got, tier, _ := h.selectWithBudget(nil, only, TierFrontier, "r", "")
	if tier != TierLocal || got.Model != "llama-3" {
		t.Fatalf("expected fallback to local llama-3, got %q @ %s", got.Model, tier)
	}
}
