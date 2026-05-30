// Per-model pricing in USD per 1M tokens. Ships with common OpenAI/Anthropic
// models out of the box; users can override or add entries in Settings → Costs.
// Matching is by substring (lowercased) so dated model variants resolve to the
// right base entry (e.g. "gpt-4o-2024-08-06" → "gpt-4o").

export interface ModelPrice {
  /** USD per 1M input/prompt tokens */
  input: number
  /** USD per 1M output/completion tokens */
  output: number
}

// Ordered longest-pattern-first so more specific entries win during matching.
export const BUILTIN_PRICING: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'o1': { input: 15, output: 60 },
  // Anthropic
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-3-opus': { input: 15, output: 75 },
}

/**
 * Resolve a model id to a price, preferring a user override (exact key match or
 * substring) over the built-in table. Returns null when nothing matches — the
 * caller should treat that as "unknown / free" rather than zero-cost.
 */
export function priceForModel(
  modelId: string,
  overrides: Record<string, ModelPrice> = {}
): ModelPrice | null {
  if (!modelId) return null
  const lower = modelId.toLowerCase()

  // Exact override first, then substring overrides (longest key wins).
  if (overrides[modelId]) return overrides[modelId]
  const overrideKeys = Object.keys(overrides).sort((a, b) => b.length - a.length)
  for (const k of overrideKeys) {
    if (lower.includes(k.toLowerCase())) return overrides[k]
  }

  const builtinKeys = Object.keys(BUILTIN_PRICING).sort((a, b) => b.length - a.length)
  for (const k of builtinKeys) {
    if (lower.includes(k)) return BUILTIN_PRICING[k]
  }
  return null
}

/** Cost in USD for a given token split. Returns 0 when the model is unpriced. */
export function costFor(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  overrides: Record<string, ModelPrice> = {}
): number {
  const p = priceForModel(modelId, overrides)
  if (!p) return 0
  return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output
}

export function formatUSD(amount: number): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) return '<$0.01'
  return `$${amount.toFixed(2)}`
}
