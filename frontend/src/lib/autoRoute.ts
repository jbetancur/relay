// #3 Model auto-routing. A cheap heuristic that picks between a "cheap" and a
// "strong" model based on the user's prompt. No network calls — runs locally
// before the request so it adds zero latency and works with any provider.
//
// Strong is chosen when the prompt looks like it needs reasoning/code/length;
// otherwise the cheap model handles it. Deliberately conservative: when in
// doubt it stays cheap, since that's the whole point of routing.

const STRONG_SIGNALS = [
  /\bcode\b/i, /\bfunction\b/i, /\bdebug\b/i, /\brefactor\b/i, /\balgorithm\b/i,
  /\bprove\b/i, /\bderive\b/i, /\banalyze\b/i, /\banalyse\b/i, /\bdesign\b/i,
  /\bstep[- ]by[- ]step\b/i, /\breason\b/i, /\bexplain why\b/i, /\bcompare\b/i,
  /```/, // a fenced code block in the prompt
]

export type RouteDecision = {
  model: string
  reason: 'cheap' | 'strong'
}

/**
 * Decide which model to use. Returns null when auto-routing can't apply (either
 * disabled or one of the two models is unset) — caller should fall back to the
 * conversation's own model.
 */
export function decideModel(
  prompt: string,
  opts: { enabled: boolean; cheap: string; strong: string }
): RouteDecision | null {
  if (!opts.enabled || !opts.cheap || !opts.strong) return null

  const len = prompt.trim().length
  const hasStrongSignal = STRONG_SIGNALS.some((re) => re.test(prompt))
  // Long prompts (likely lots of context / a hard task) also go strong.
  const isLong = len > 600

  if (hasStrongSignal || isLong) {
    return { model: opts.strong, reason: 'strong' }
  }
  return { model: opts.cheap, reason: 'cheap' }
}
