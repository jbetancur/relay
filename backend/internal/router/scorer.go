package router

import (
	"fmt"
	"strings"
)

// Signals are the cheap, structural features extracted from a route request.
// They carry no provider state — ScoreHeuristic is pure and unit-testable.
type Signals struct {
	Task         string // raw task text (used for keyword matching)
	CharCount    int    // total chars across task + messages + selection
	FileCount    int    // open/attached files
	SelectionLen int    // chars in the active selection
	Language     string
	HasDiff      bool
}

// Score is the heuristic verdict. Value is a 0..1 complexity estimate; Tier is
// the band it maps to; Confidence is the distance from the nearest tier
// threshold (higher = more decisive). Ambiguous is true when the value sits in
// a margin band with no decisive keyword — the caller should break the tie with
// the local classifier.
type Score struct {
	Value      float64
	Tier       Tier
	Confidence float64
	Ambiguous  bool
	Reason     string
}

// Keyword signals (lowercased substring match). High keywords denote tasks that
// reward stronger reasoning; low keywords denote mechanical/explanatory work.
var (
	highKeywords = []string{
		"design", "architect", "concurrency", "race condition", "deadlock",
		"distributed", "security", "vulnerab", "migrate", "optimize performance",
		"refactor across", "prove", "algorithm", "data structure", "debug",
	}
	lowKeywords = []string{
		"explain", "what is", "what does", "rename", "typo", "comment",
		"format", "lint", "import", "docstring", "summarize",
	}
)

// Tier thresholds on the 0..1 complexity scale.
const (
	localTierCeil = 0.35 // below ⇒ local
	midTierCeil   = 0.70 // below ⇒ mid; at or above ⇒ frontier
)

// Ambiguity margins: a value near a threshold with no decisive keyword is a
// coin-flip worth escalating to the classifier.
const ambiguityMargin = 0.08

// ScoreHeuristic turns structural signals into a complexity score and tier.
func ScoreHeuristic(s Signals) Score {
	value := 0.30 // neutral baseline

	// Size buckets — larger context generally means a harder task.
	switch {
	case s.CharCount > 6000:
		value += 0.20
	case s.CharCount > 2000:
		value += 0.12
	case s.CharCount > 500:
		value += 0.05
	}
	switch {
	case s.FileCount >= 5:
		value += 0.15
	case s.FileCount >= 2:
		value += 0.08
	}
	if s.SelectionLen > 1500 {
		value += 0.08
	}
	if s.HasDiff {
		value += 0.10
	}

	// Keyword signals — decisive when present.
	lower := strings.ToLower(s.Task)
	var hiHits, loHits []string
	for _, k := range highKeywords {
		if strings.Contains(lower, k) {
			hiHits = append(hiHits, k)
		}
	}
	for _, k := range lowKeywords {
		if strings.Contains(lower, k) {
			loHits = append(loHits, k)
		}
	}
	// A single strong keyword is decisive (clears a tier threshold from the
	// 0.30 baseline); additional hits add less, so weight diminishes.
	value += keywordWeight(len(hiHits))
	value -= keywordWeight(len(loHits))

	value = clamp01(value)
	tier := tierForValue(value)
	decisiveKeyword := len(hiHits) > 0 || len(loHits) > 0

	conf := thresholdDistance(value)
	ambiguous := !decisiveKeyword && conf <= ambiguityMargin+1e-9

	return Score{
		Value:      value,
		Tier:       tier,
		Confidence: conf,
		Ambiguous:  ambiguous,
		Reason:     buildReason(value, tier, hiHits, loHits, s),
	}
}

// keywordWeight maps a hit count to a complexity contribution. The first hit is
// decisive (0.42 — clears the frontier threshold from the 0.30 baseline with a
// small margin so it doesn't sit exactly on the boundary); each extra hit adds a
// diminishing 0.12, capped so a keyword-stuffed prompt can't run away.
func keywordWeight(hits int) float64 {
	if hits <= 0 {
		return 0
	}
	w := 0.42 + 0.12*float64(hits-1)
	if w > 0.66 {
		w = 0.66
	}
	return w
}

func tierForValue(v float64) Tier {
	switch {
	case v < localTierCeil:
		return TierLocal
	case v < midTierCeil:
		return TierMid
	default:
		return TierFrontier
	}
}

// thresholdDistance is how far the value is from the nearest tier boundary,
// normalized to 0..1. Used as a confidence proxy.
func thresholdDistance(v float64) float64 {
	d := v - localTierCeil
	if x := midTierCeil - v; abs(x) < abs(d) {
		d = x
	}
	// Also consider the scale ends so a value far from any boundary reads high.
	return abs(d)
}

func buildReason(v float64, tier Tier, hi, lo []string, s Signals) string {
	switch {
	case len(hi) > 0:
		return fmt.Sprintf("complex signals (%s) ⇒ %s", strings.Join(hi, ", "), tier)
	case len(lo) > 0:
		return fmt.Sprintf("simple signals (%s) ⇒ %s", strings.Join(lo, ", "), tier)
	case s.FileCount >= 5 || s.CharCount > 6000:
		return fmt.Sprintf("large context (%d files, %d chars) ⇒ %s", s.FileCount, s.CharCount, tier)
	default:
		return fmt.Sprintf("heuristic complexity %.2f ⇒ %s", v, tier)
	}
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
