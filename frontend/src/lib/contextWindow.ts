// Context assembly: given a conversation's messages and the active strategy,
// decide which messages are actually sent upstream. Pure and side-effect free so
// it can drive both the real send (useChat) and the UI preview (which messages
// would be dropped, shown greyed out).

import type { ContextStrategy, MessageContent, Role } from '@/types'
import { estimateTokens, messageText } from '@/hooks/useTokenCount'

export interface ChatMsg {
  role: Role
  content: string | MessageContent[]
}

export interface ContextOptions {
  strategy: ContextStrategy
  systemPrompt: string
  // Resolved token budget for history (already accounts for the model window,
  // budgetFraction, and reply headroom). When null (unknown window), 'window'
  // and 'summarize' fall back to 'none' so we never silently drop on a guess.
  budget: number | null
}

export interface ContextResult {
  // Messages to send (excludes the system prompt, which the caller prepends).
  sent: ChatMsg[]
  // Older messages excluded by the strategy (oldest first).
  dropped: ChatMsg[]
  // True when strategy is 'summarize' and there is something to summarize.
  summaryNeeded: boolean
}

function tokensOf(m: ChatMsg): number {
  return estimateTokens(messageText(m.content))
}

/**
 * Apply the context strategy. 'none' sends everything. 'window' and 'summarize'
 * keep the most recent messages that fit the budget (always keeping the final
 * message); 'summarize' additionally flags that the dropped slice should be
 * condensed by the caller.
 */
export function buildContext(messages: ChatMsg[], opts: ContextOptions): ContextResult {
  const { strategy, systemPrompt, budget } = opts

  if (strategy === 'none' || budget == null || messages.length === 0) {
    return { sent: messages, dropped: [], summaryNeeded: false }
  }

  const systemTokens = systemPrompt ? estimateTokens(systemPrompt) : 0
  let remaining = budget - systemTokens

  // Walk newest → oldest, keeping messages until the budget is spent. Always
  // keep at least the most recent message even if it alone exceeds the budget.
  const keptReversed: ChatMsg[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = tokensOf(messages[i])
    if (keptReversed.length > 0 && t > remaining) break
    keptReversed.push(messages[i])
    remaining -= t
  }

  const keepCount = keptReversed.length
  const sent = messages.slice(messages.length - keepCount)
  const dropped = messages.slice(0, messages.length - keepCount)

  return {
    sent,
    dropped,
    summaryNeeded: strategy === 'summarize' && dropped.length > 0,
  }
}

/**
 * Compute the history token budget from the model's context window and settings.
 * Returns null when the window is unknown so callers can degrade to 'none'.
 */
export function resolveBudget(
  contextWindow: number | null,
  budgetFraction: number,
  replyHeadroom: number
): number | null {
  if (contextWindow == null) return null
  const byFraction = Math.floor(contextWindow * budgetFraction)
  const byHeadroom = contextWindow - replyHeadroom
  return Math.max(0, Math.min(byFraction, byHeadroom))
}
