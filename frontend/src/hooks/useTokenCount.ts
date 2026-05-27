import { useMemo } from 'react'
import type { Conversation } from '@/types'

// ~4 chars per token — rough but good enough for an estimate
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function messageText(content: Conversation['messages'][0]['content']): string {
  if (typeof content === 'string') return content
  return content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(' ')
}

export function useTokenCount(conversation: Conversation | undefined) {
  return useMemo(() => {
    if (!conversation) return 0
    const parts: string[] = []
    if (conversation.systemPrompt) parts.push(conversation.systemPrompt)
    for (const m of conversation.messages) parts.push(messageText(m.content))
    return parts.reduce((sum, t) => sum + estimateTokens(t), 0)
  }, [conversation?.messages.length, conversation?.systemPrompt])
}
