package router

import (
	"testing"

	"github.com/johnbetancur/vision/backend/internal/modelmeta"
)

func price(in, out float64) *modelmeta.Price { return &modelmeta.Price{Input: in, Output: out} }

func TestTierFor(t *testing.T) {
	cases := []struct {
		name     string
		typeHint string
		meta     modelmeta.Meta
		model    string
		want     Tier
	}{
		{"ollama is always local", "ollama", modelmeta.Meta{Price: price(20, 60)}, "llama-3", TierLocal},
		{"opus price ⇒ frontier", "anthropic", modelmeta.Meta{Price: price(15, 75)}, "claude-opus-4", TierFrontier},
		{"sonnet price ⇒ mid", "anthropic", modelmeta.Meta{Price: price(3, 15)}, "claude-3-5-sonnet", TierMid},
		{"cheap price ⇒ local", "openai", modelmeta.Meta{Price: price(0.15, 0.6)}, "gpt-4o-mini", TierLocal},
		{"unknown price + sonnet id ⇒ mid", "custom", modelmeta.Meta{}, "some-sonnet-clone", TierMid},
		{"unknown price + opus id ⇒ frontier", "custom", modelmeta.Meta{}, "vendor-opus-x", TierFrontier},
		{"unknown price + mini id ⇒ local", "openai", modelmeta.Meta{}, "o1-mini", TierLocal},
		{"unknown price + unknown id ⇒ mid default", "custom", modelmeta.Meta{}, "mystery-model", TierMid},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := tierFor(c.typeHint, c.meta, c.model); got != c.want {
				t.Errorf("tierFor(%q, %+v, %q) = %q, want %q", c.typeHint, c.meta, c.model, got, c.want)
			}
		})
	}
}

func TestTierRankOrders(t *testing.T) {
	if !(TierLocal.rank() < TierMid.rank() && TierMid.rank() < TierFrontier.rank()) {
		t.Fatalf("tier ranks not ordered: local=%d mid=%d frontier=%d",
			TierLocal.rank(), TierMid.rank(), TierFrontier.rank())
	}
}
