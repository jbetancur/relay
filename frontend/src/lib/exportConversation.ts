import type { Conversation, MessageContent } from '@/types'

function msgText(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content
  return content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
}

export function conversationToMarkdown(conv: Conversation): string {
  const lines: string[] = [`# ${conv.title}`, '']
  if (conv.systemPrompt) {
    lines.push('**System prompt:**', '```', conv.systemPrompt, '```', '')
  }
  for (const m of conv.messages) {
    const role = m.role === 'user' ? '**You**' : '**Assistant**'
    lines.push(`${role}:`, '', msgText(m.content), '')
  }
  return lines.join('\n')
}

export function downloadJSON(conv: Conversation) {
  const json = JSON.stringify(conv, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${conv.title.slice(0, 60).replace(/[^a-z0-9]/gi, '_')}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function downloadMarkdown(conv: Conversation) {
  const md = conversationToMarkdown(conv)
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${conv.title.slice(0, 60).replace(/[^a-z0-9]/gi, '_')}.md`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
