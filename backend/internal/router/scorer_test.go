package router

import "testing"

func TestScoreHeuristic(t *testing.T) {
	cases := []struct {
		name      string
		signals   Signals
		wantTier  Tier
		ambiguous bool
	}{
		{
			name:     "low keyword ⇒ local",
			signals:  Signals{Task: "explain what this function does", CharCount: 120, FileCount: 1},
			wantTier: TierLocal,
		},
		{
			name:     "high keyword ⇒ frontier",
			signals:  Signals{Task: "design a scheduler and fix the race condition", CharCount: 400, FileCount: 1},
			wantTier: TierFrontier,
		},
		{
			name:     "large diff across many files escalates",
			signals:  Signals{Task: "update these modules", CharCount: 7000, FileCount: 6, HasDiff: true, SelectionLen: 2000},
			wantTier: TierFrontier,
		},
		{
			name:      "mid-band with no decisive keyword is ambiguous",
			signals:   Signals{Task: "clean up this module", CharCount: 900, FileCount: 3, SelectionLen: 900},
			wantTier:  TierMid,
			ambiguous: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ScoreHeuristic(c.signals)
			if got.Tier != c.wantTier {
				t.Errorf("tier = %q (value %.2f), want %q", got.Tier, got.Value, c.wantTier)
			}
			if got.Ambiguous != c.ambiguous {
				t.Errorf("ambiguous = %v (value %.2f, conf %.2f), want %v",
					got.Ambiguous, got.Value, got.Confidence, c.ambiguous)
			}
		})
	}
}

func TestScoreHeuristicDecisiveKeywordNotAmbiguous(t *testing.T) {
	// A high keyword in the mid value band must not be flagged ambiguous.
	got := ScoreHeuristic(Signals{Task: "debug this", CharCount: 300})
	if got.Ambiguous {
		t.Errorf("decisive keyword should suppress ambiguity, got ambiguous (value %.2f)", got.Value)
	}
}

func TestScoreHeuristicEdgeCases(t *testing.T) {
	cases := []struct {
		name     string
		signals  Signals
		wantTier Tier
	}{
		{
			// Empty input falls to the neutral baseline (0.30) ⇒ local.
			name:     "empty input ⇒ local baseline",
			signals:  Signals{},
			wantTier: TierLocal,
		},
		{
			// One high keyword alone clears the frontier threshold from baseline.
			name:     "single high keyword ⇒ frontier",
			signals:  Signals{Task: "fix the race condition", CharCount: 25},
			wantTier: TierFrontier,
		},
		{
			// One low keyword alone pins firmly to local.
			name:     "single low keyword ⇒ local",
			signals:  Signals{Task: "explain this", CharCount: 12},
			wantTier: TierLocal,
		},
		{
			// High + low keyword cancel toward the baseline neighborhood.
			name:     "conflicting keywords cancel out",
			signals:  Signals{Task: "explain the concurrency model", CharCount: 30},
			wantTier: TierLocal,
		},
		{
			// Pure size with no keywords can still escalate to frontier.
			name:     "huge context, no keywords ⇒ frontier",
			signals:  Signals{Task: "update these", CharCount: 7000, FileCount: 6, HasDiff: true, SelectionLen: 2000},
			wantTier: TierFrontier,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ScoreHeuristic(c.signals); got.Tier != c.wantTier {
				t.Errorf("tier = %q (value %.2f), want %q", got.Tier, got.Value, c.wantTier)
			}
		})
	}
}

func TestKeywordWeightDiminishesAndCaps(t *testing.T) {
	if keywordWeight(0) != 0 {
		t.Errorf("zero hits should weigh 0, got %.2f", keywordWeight(0))
	}
	if !(keywordWeight(1) < keywordWeight(2)) {
		t.Errorf("weight should grow with hits: w(1)=%.2f w(2)=%.2f", keywordWeight(1), keywordWeight(2))
	}
	// Many hits must saturate, not run away.
	if w := keywordWeight(10); w > 0.66+1e-9 {
		t.Errorf("weight should cap at 0.66, got %.2f", w)
	}
	// First hit must be decisive enough to clear a tier from the 0.30 baseline.
	if 0.30+keywordWeight(1) < midTierCeil {
		t.Errorf("single keyword (%.2f) must lift baseline past mid threshold %.2f",
			keywordWeight(1), midTierCeil)
	}
}
