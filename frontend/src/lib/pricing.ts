// Pricing now comes from the backend (internal/modelmeta), which maintains the
// table and probes providers that expose pricing (e.g. OpenRouter). The frontend
// resolves a model's price from a base table it fetched, with the user's manual
// overrides layered on top. Matching is by substring so dated variants resolve
// (e.g. "gpt-4o-2024-08-06" → "gpt-4o").

export interface ModelPrice {
  /** USD per 1M input/prompt tokens */
  input: number
  /** USD per 1M output/completion tokens */
  output: number
}

/**
 * Resolve a model id to a price, preferring a user override (exact key or
 * substring) over the base table fetched from the backend. Returns null when
 * nothing matches — the caller should treat that as "unknown / unpriced".
 */
export function priceForModel(
  modelId: string,
  base: Record<string, ModelPrice> = {},
  overrides: Record<string, ModelPrice> = {}
): ModelPrice | null {
  if (!modelId) return null
  const lower = modelId.toLowerCase()

  const match = (table: Record<string, ModelPrice>): ModelPrice | null => {
    if (table[modelId]) return table[modelId]
    const keys = Object.keys(table).sort((a, b) => b.length - a.length)
    for (const k of keys) {
      if (lower.includes(k.toLowerCase())) return table[k]
    }
    return null
  }

  return match(overrides) ?? match(base)
}

/** Cost in USD for a given token split. Returns 0 when the model is unpriced. */
export function costFor(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  base: Record<string, ModelPrice> = {},
  overrides: Record<string, ModelPrice> = {}
): number {
  const p = priceForModel(modelId, base, overrides)
  if (!p) return 0
  return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output
}

export function formatUSD(amount: number): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) return '<$0.01'
  return `$${amount.toFixed(2)}`
}
