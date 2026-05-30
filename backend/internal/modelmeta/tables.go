// Package modelmeta is the single source of truth for per-model metadata:
// context window, pricing, and capabilities. Values come from a server-side
// table, optionally refined by probing providers that expose the data
// (Ollama, OpenRouter). The frontend reads this instead of hardcoding tables.
package modelmeta

import (
	"sort"
	"strings"
)

// Price is USD per 1M tokens.
type Price struct {
	Input  float64 `json:"input"`
	Output float64 `json:"output"`
}

// Meta is everything we know about a model. Zero/nil fields mean "unknown".
type Meta struct {
	ContextWindow int      `json:"contextWindow"`
	Price         *Price   `json:"price,omitempty"`
	Capabilities  []string `json:"capabilities,omitempty"`
	Kind          string   `json:"kind"`   // chat | image | embedding | audio | moderation | other
	Source        string   `json:"source"` // probe | table | unknown
}

// classifyKind decides what a model is used for, by id pattern. Runs independent
// of table membership so unknown models (e.g. text-embedding-3-large) still sort
// correctly. Defaults to "chat" so anything unrecognized stays usable for chat.
func classifyKind(model string) string {
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
	case contains("dall-e", "gpt-image", "stable-diffusion", "flux", "imagen"):
		return "image"
	case contains("embedding"):
		return "embedding"
	case contains("whisper", "tts", "audio", "transcribe", "realtime", "speech"):
		return "audio"
	case contains("moderation"):
		return "moderation"
	case contains("babbage", "davinci", "ada", "curie"):
		return "other"
	default:
		return "chat"
	}
}

// tableEntry holds the static knowledge for a model pattern. Patterns match by
// longest-substring, mirroring the old frontend pricing/window lookup.
type tableEntry struct {
	Window int
	Price  *Price
	Caps   []string
}

// builtins is ordered conceptually longest-first via sorted lookup at query time.
var builtins = map[string]tableEntry{
	// OpenAI
	"gpt-4o-mini":   {Window: 128_000, Price: &Price{0.15, 0.6}, Caps: []string{"vision"}},
	"gpt-4o":        {Window: 128_000, Price: &Price{2.5, 10}, Caps: []string{"vision"}},
	"gpt-4-turbo":   {Window: 128_000, Price: &Price{10, 30}, Caps: []string{"vision"}},
	"gpt-4-32k":     {Window: 32_768, Price: &Price{60, 120}},
	"gpt-4":         {Window: 8_192, Price: &Price{30, 60}},
	"gpt-3.5-turbo": {Window: 16_385, Price: &Price{0.5, 1.5}},
	"o1-mini":       {Window: 128_000, Price: &Price{1.1, 4.4}},
	"o1":            {Window: 200_000, Price: &Price{15, 60}},
	// Anthropic
	"claude-3-5-haiku":  {Window: 200_000, Price: &Price{0.8, 4}, Caps: []string{"vision"}},
	"claude-3-haiku":    {Window: 200_000, Price: &Price{0.25, 1.25}, Caps: []string{"vision"}},
	"claude-3-5-sonnet": {Window: 200_000, Price: &Price{3, 15}, Caps: []string{"vision"}},
	"claude-3-7-sonnet": {Window: 200_000, Price: &Price{3, 15}, Caps: []string{"vision"}},
	"claude-sonnet-4":   {Window: 200_000, Price: &Price{3, 15}, Caps: []string{"vision"}},
	"claude-opus-4":     {Window: 200_000, Price: &Price{15, 75}, Caps: []string{"vision"}},
	"claude-3-opus":     {Window: 200_000, Price: &Price{15, 75}, Caps: []string{"vision"}},
	// Common open models
	"llama-3": {Window: 8_192},
	"mistral": {Window: 32_768},
	"mixtral": {Window: 32_768},
	"gemini":  {Window: 1_000_000, Caps: []string{"vision"}},
	// Image generation models
	"dall-e-3":         {Caps: []string{"image"}},
	"dall-e-2":         {Caps: []string{"image"}},
	"gpt-image-1":      {Caps: []string{"image"}},
	"stable-diffusion": {Caps: []string{"image"}},
	"flux":             {Caps: []string{"image"}},
	"imagen":           {Caps: []string{"image"}},
}

// sortedPatterns returns table keys longest-first so specific entries win.
func sortedPatterns() []string {
	keys := make([]string, 0, len(builtins))
	for k := range builtins {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return len(keys[i]) > len(keys[j]) })
	return keys
}

// lookupTable resolves a model id to its static Meta (source "table"), or an
// unknown Meta when nothing matches.
func lookupTable(model string) Meta {
	lower := strings.ToLower(model)
	for _, k := range sortedPatterns() {
		if strings.Contains(lower, k) {
			e := builtins[k]
			return Meta{ContextWindow: e.Window, Price: e.Price, Capabilities: e.Caps, Kind: classifyKind(model), Source: "table"}
		}
	}
	return Meta{Kind: classifyKind(model), Source: "unknown"}
}

// Table returns the full static table keyed by pattern, for bulk frontend use
// (e.g. cost computation and kind classification across many models without
// per-model probing). Kind is derived from the pattern so callers can sort
// real model ids by substring-matching against these patterns.
func Table() map[string]Meta {
	out := make(map[string]Meta, len(builtins)+len(kindPatterns))
	for k, e := range builtins {
		out[k] = Meta{ContextWindow: e.Window, Price: e.Price, Capabilities: e.Caps, Kind: classifyKind(k), Source: "table"}
	}
	// Add non-chat patterns (no price/window) so the bulk table can classify
	// embeddings/audio/etc. that aren't otherwise in the table.
	for _, p := range kindPatterns {
		if _, exists := out[p]; !exists {
			out[p] = Meta{Kind: classifyKind(p), Source: "table"}
		}
	}
	return out
}

// kindPatterns are id fragments used purely for kind classification in the bulk
// table (they carry no price/window). classifyKind maps each to its kind.
var kindPatterns = []string{
	"text-embedding", "embedding",
	"whisper", "tts", "transcribe", "realtime", "audio",
	"moderation",
	"babbage", "davinci", "ada", "curie",
}
