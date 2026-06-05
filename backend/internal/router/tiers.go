// Package router selects the best model for a task by complexity. It maps the
// models available across configured connections into cost/capability tiers,
// scores the task with cheap heuristics, and escalates ambiguous cases to a
// local model acting as a complexity classifier. Pricing and metadata come
// from modelmeta; budget ceilings from governor — this package adds no pricing
// of its own.
package router

import (
	"strings"

	"github.com/johnbetancur/vision/backend/internal/modelmeta"
)

// Tier is a cost/capability band a model falls into.
type Tier string

const (
	TierLocal    Tier = "local"    // ollama / cheap models — simple tasks
	TierMid      Tier = "mid"      // sonnet, gpt-4o — everyday coding
	TierFrontier Tier = "frontier" // opus, o1 — hard reasoning
)

// rank orders tiers low→high so the router can step down to the next-cheapest
// tier when a budget ceiling blocks the preferred one.
func (t Tier) rank() int {
	switch t {
	case TierLocal:
		return 0
	case TierMid:
		return 1
	case TierFrontier:
		return 2
	default:
		return 1
	}
}

// Blended-price tier thresholds, in USD per 1M tokens (input+output averaged).
// Tunable: these bands roughly separate open/cheap models from mid-range chat
// models from frontier reasoning models as of mid-2026 pricing.
const (
	localPriceCeil = 1.0  // below this ⇒ local
	midPriceCeil   = 15.0 // below this ⇒ mid; at or above ⇒ frontier
)

// Candidate is one routable (connection, model) pair with its resolved metadata.
type Candidate struct {
	ConnectionID  string          `json:"connectionId"`
	Model         string          `json:"model"`
	Tier          Tier            `json:"tier"`
	Price         *modelmeta.Price `json:"price,omitempty"`
	ContextWindow int             `json:"contextWindow"`
	Capabilities  []string        `json:"capabilities,omitempty"`
}

// blendedPrice returns the averaged input/output price per 1M tokens, or -1 when
// pricing is unknown (so callers can fall back to id-pattern classification).
func (c Candidate) blendedPrice() float64 {
	if c.Price == nil {
		return -1
	}
	return (c.Price.Input + c.Price.Output) / 2
}

// tierFor classifies a model into a tier. Priority: an ollama connection is
// always local; otherwise known pricing drives the band; otherwise the model id
// pattern decides. Defaults to mid so an unrecognized model stays usable.
func tierFor(typeHint string, m modelmeta.Meta, model string) Tier {
	if typeHint == "ollama" {
		return TierLocal
	}
	if m.Price != nil {
		blended := (m.Price.Input + m.Price.Output) / 2
		switch {
		case blended < localPriceCeil:
			return TierLocal
		case blended < midPriceCeil:
			return TierMid
		default:
			return TierFrontier
		}
	}
	return tierFromID(model)
}

// tierFromID is the pricing-unknown fallback: classify by model-id substrings.
func tierFromID(model string) Tier {
	lower := strings.ToLower(model)
	contains := func(subs ...string) bool {
		for _, s := range subs {
			if strings.Contains(lower, s) {
				return true
			}
		}
		return false
	}
	switch {
	// "mini" before frontier so gpt-4o-mini / o1-mini land local, not frontier.
	case contains("mini", "haiku", "llama", "mistral", "mixtral", "flash", "gemma", "phi", "qwen"):
		return TierLocal
	case contains("opus", "o1", "o3"):
		return TierFrontier
	case contains("sonnet", "gpt-4o", "gpt-4-turbo", "gpt-4.1", "large"):
		return TierMid
	default:
		return TierMid
	}
}
