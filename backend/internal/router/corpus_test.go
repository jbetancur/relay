package router

import (
	"bufio"
	"encoding/json"
	"os"
	"testing"
)

// corpusCase is one labeled task from testdata/tasks.jsonl. `Want` is the tier
// a human judged appropriate; the test measures how often ScoreHeuristic agrees.
type corpusCase struct {
	Task         string `json:"task"`
	CharCount    int    `json:"charCount"`
	FileCount    int    `json:"fileCount"`
	SelectionLen int    `json:"selectionLen"`
	HasDiff      bool   `json:"hasDiff"`
	Want         Tier   `json:"want"`
}

func (c corpusCase) signals() Signals {
	return Signals{
		Task:         c.Task,
		CharCount:    c.CharCount,
		FileCount:    c.FileCount,
		SelectionLen: c.SelectionLen,
		HasDiff:      c.HasDiff,
	}
}

func loadCorpus(t *testing.T) []corpusCase {
	t.Helper()
	f, err := os.Open("testdata/tasks.jsonl")
	if err != nil {
		t.Fatalf("open corpus: %v", err)
	}
	defer f.Close()

	var cases []corpusCase
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var c corpusCase
		if err := json.Unmarshal(line, &c); err != nil {
			t.Fatalf("parse corpus line %q: %v", line, err)
		}
		cases = append(cases, c)
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("scan corpus: %v", err)
	}
	return cases
}

// minAccuracy is the floor below which the heuristic is considered regressed.
// It's intentionally lenient — the corpus exists to measure calibration, not to
// gate every commit on perfection. Raise it as the heuristics improve.
const minAccuracy = 0.70

// TestHeuristicAccuracy scores the whole corpus, reports accuracy, and lists
// every miss with the predicted tier and complexity value — so tuning a
// threshold is empirical: change a constant, re-run with -v, watch the number.
func TestHeuristicAccuracy(t *testing.T) {
	cases := loadCorpus(t)
	if len(cases) == 0 {
		t.Fatal("empty corpus")
	}

	var correct, confidentMiss, ambiguousMiss int
	for _, c := range cases {
		got := ScoreHeuristic(c.signals())
		if got.Tier == c.Want {
			correct++
			continue
		}
		// An ambiguous miss isn't a real failure: the live router escalates these
		// to the classifier, which breaks the tie. A confident miss is the router
		// picking the wrong tier with no intention of asking — that's the bug class
		// worth chasing.
		kind := "CONFIDENT-MISS"
		if got.Ambiguous {
			ambiguousMiss++
			kind = "ambiguous-miss"
		} else {
			confidentMiss++
		}
		t.Logf("%s: want=%-8s got=%-8s value=%.2f  %q",
			kind, c.Want, got.Tier, got.Value, c.Task)
	}

	n := len(cases)
	acc := float64(correct) / float64(n)
	// Effective accuracy credits ambiguous misses, since the classifier resolves
	// them at runtime — this is the number that reflects real-world routing.
	effective := float64(correct+ambiguousMiss) / float64(n)
	t.Logf("heuristic accuracy: %d/%d = %.1f%% (effective w/ classifier: %.1f%%)",
		correct, n, acc*100, effective*100)
	t.Logf("misses: %d confident, %d ambiguous (classifier-resolved)", confidentMiss, ambiguousMiss)

	// Gate on confident accuracy: ambiguous cases are allowed because the system
	// has a runtime fallback for them.
	confidentAcc := float64(correct+ambiguousMiss) / float64(n)
	if confidentAcc < minAccuracy {
		t.Errorf("effective accuracy %.1f%% below floor %.1f%% — heuristics regressed",
			confidentAcc*100, minAccuracy*100)
	}
}
