import { useMemo } from 'react'
import type { Conversation, Message, MessageContent } from '@/types'

// ~4 chars per token — rough but good enough for an estimate
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function messageText(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content
  return content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(' ')
}

/** Estimated tokens for a single message's text content. */
export function tokensForMessage(message: Message): number {
  return estimateTokens(messageText(message.content))
}

export function useTokenCount(conversation: Conversation | undefined) {
  return useMemo(() => {
    if (!conversation) return 0
    let total = conversation.systemPrompt ? estimateTokens(conversation.systemPrompt) : 0
    for (const m of conversation.messages) total += tokensForMessage(m)
    return total
  }, [conversation?.messages.length, conversation?.systemPrompt])
}
