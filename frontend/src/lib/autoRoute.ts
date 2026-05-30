// #3 Model auto-routing. A classifier sorts each prompt into a category
// (coding / creative / reasoning / fast); each category maps to a configured
// model + connection, so routing can span providers — "the right model for the
// question" rather than just cheap-vs-strong.
//
// Two stages keep it cheap: a free local keyword pre-pass catches the obvious
// cases instantly; anything ambiguous is sent to the Fast slot's model for a
// one-word classification. On failure we fall back per the user's setting.

import { api } from '@/lib/api'
import type { AppSettings, RouteCategory, RouteSlot } from '@/types'

const CATEGORIES: RouteCategory[] = ['coding', 'creative', 'reasoning', 'fast']

// Strong, unambiguous coding signals — when present we skip the LLM entirely.
const CODING_SIGNALS = [
  /```/, // a fenced code block in the prompt
  /\bdebug\b/i, /\brefactor\b/i, /\bstack ?trace\b/i, /\bcompile\b/i,
  /\bregex\b/i, /\bAPI\b/, /\bSQL\b/i, /\bfunction\b/i, /\bclass\b/i,
  /\b(typescript|javascript|python|golang|rust|java|c\+\+)\b/i,
]

export type RouteResult = {
  model: string
  connectionId: string | null
  category: RouteCategory
}

/**
 * Free local pre-pass. Returns a category only for high-confidence matches;
 * otherwise null to defer to the LLM classifier.
 */
export function classifyLocally(prompt: string): RouteCategory | null {
  if (CODING_SIGNALS.some((re) => re.test(prompt))) return 'coding'
  // Very short prompts are cheap to answer — send straight to Fast.
  if (prompt.trim().length < 12) return 'fast'
  return null
}

const CLASSIFIER_TIMEOUT_MS = 8000

/**
 * Ask the Fast slot's model to classify the prompt into one of `allowed`.
 * Throws if the model is unavailable or returns an unrecognized category, so
 * the caller applies the fallback.
 */
export async function classifyWithLLM(
  prompt: string,
  opts: { model: string; connectionId: string | null; allowed: RouteCategory[] }
): Promise<RouteCategory> {
  const list = opts.allowed.join(', ')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS)
  try {
    const res = await api.chat.complete(
      {
        model: opts.model,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              `Classify the user's request into exactly one of: ${list}. ` +
              `Reply with ONLY the single category word, lowercase, nothing else.`,
          },
          { role: 'user', content: prompt.slice(0, 2000) },
        ],
      },
      opts.connectionId,
      controller.signal
    )
    const raw = res.choices[0]?.message?.content?.trim().toLowerCase() ?? ''
    // Models sometimes wrap or punctuate — pull the first known category word.
    const match = opts.allowed.find((c) => raw.includes(c))
    if (!match) throw new Error(`classifier returned "${raw}"`)
    return match
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve the full route for a prompt: local pre-pass → LLM → fallback.
 * Returns null when routing can't apply (disabled, no slots configured, or no
 * Fast slot to classify with) — caller should use the conversation's own model.
 */
export async function resolveRoute(
  prompt: string,
  settings: AppSettings
): Promise<RouteResult | null> {
  if (!settings.autoRouteEnabled) return null

  const slots = settings.routeSlots
  const configured = CATEGORIES.filter((c) => slots[c]?.model)
  if (configured.length === 0) return null

  const fast = slots.fast
  const toResult = (category: RouteCategory): RouteResult => {
    const slot = slots[category] as RouteSlot
    return { model: slot.model, connectionId: slot.connectionId, category }
  }
  const fallback = (): RouteResult | null => {
    if (settings.routeFallback === 'fast' && fast?.model) return toResult('fast')
    return null // → conversation's own model
  }

  // 1. Free local pre-pass (only honored if that category is configured).
  const local = classifyLocally(prompt)
  if (local && slots[local]?.model) return toResult(local)

  // 2. LLM classifier needs the Fast slot as the judge.
  if (!fast?.model) return fallback()

  try {
    const category = await classifyWithLLM(prompt, {
      model: fast.model,
      connectionId: fast.connectionId,
      allowed: configured,
    })
    return toResult(category)
  } catch {
    return fallback()
  }
}
