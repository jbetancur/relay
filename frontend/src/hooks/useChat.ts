import { useState, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { useConversationStore, useSettingsStore, useConnectionsStore } from '@/store'
import { resolveRoute } from '@/lib/autoRoute'
import { buildContext, resolveBudget, type ChatMsg } from '@/lib/contextWindow'
import { resolveContextWindow } from '@/lib/contextWindows'
import { getModelMeta } from '@/hooks/useModelMeta'
import { messageText } from '@/hooks/useTokenCount'
import type { Conversation, MessageContent, RouteCategory } from '@/types'
import type { FileAttachment } from '@/components/chat/MessageInput'

// Condense dropped older messages into a single summary string via a cheap model.
async function summarizeDropped(
  dropped: ChatMsg[],
  model: string,
  connectionId: string | null,
  signal?: AbortSignal
): Promise<string> {
  const transcript = dropped
    .map((m) => `${m.role}: ${messageText(m.content)}`)
    .join('\n')
  const res = await api.chat.complete(
    {
      model,
      stream: false,
      messages: [
        {
          role: 'system',
          content:
            'Summarize the following conversation excerpt concisely, preserving facts, ' +
            'decisions, names, and any open threads. This summary replaces the original ' +
            'messages as context for an ongoing chat.',
        },
        { role: 'user', content: transcript.slice(0, 12000) },
      ],
    },
    connectionId,
    signal
  )
  return res.choices[0]?.message?.content?.trim() ?? ''
}

async function generateTitle(
  userText: string,
  assistantText: string,
  model: string,
  connectionId: string | null
): Promise<string> {
  const res = await api.chat.complete(
    {
      model,
      stream: false,
      messages: [
        {
          role: 'user',
          content: `Generate a short (≤6 words) title for this conversation. Reply with ONLY the title, no quotes, no punctuation at the end.\n\nUser: ${userText.slice(0, 400)}\nAssistant: ${assistantText.slice(0, 400)}`,
        },
      ],
    },
    connectionId
  )
  return res.choices[0]?.message?.content?.trim().slice(0, 80) ?? ''
}

export function useChat(conversation: Conversation | undefined) {
  const [streaming, setStreaming] = useState(false)
  const [routing, setRouting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const { addMessage, updateLastAssistantMessage, deleteLastMessages, truncateAfterMessage, renameConversation, setModel } = useConversationStore()
  const { settings } = useSettingsStore()
  const { getDefault } = useConnectionsStore()

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const send = useCallback(
    async (
      text: string,
      imageDataUrls: string[] = [],
      attachments: FileAttachment[] = [],
      modelOverride?: string
    ) => {
      if (!conversation) return
      setError(null)

      // Prepend file contents as a system-style block in the user message text
      let fullText = text
      if (attachments.length > 0) {
        const blocks = attachments.map(
          (a) => `<file name="${a.name}">\n${a.content}\n</file>`
        )
        fullText = blocks.join('\n\n') + (text ? '\n\n' + text : '')
      }

      const content: string | MessageContent[] =
        imageDataUrls.length > 0
          ? [
              { type: 'text', text: fullText },
              ...imageDataUrls.map((url) => ({
                type: 'image_url' as const,
                image_url: { url },
              })),
            ]
          : fullText

      addMessage(conversation.id, { role: 'user', content })

      // #5 explicit override wins; otherwise #3 auto-routing may pick a model +
      // connection (across providers); otherwise the conversation's own model.
      let routed: { model: string; connectionId: string | null; category: RouteCategory } | null = null
      if (!modelOverride && settings.autoRouteEnabled) {
        setRouting(true)
        try {
          routed = await resolveRoute(fullText, settings)
        } catch {
          routed = null // any routing failure → fall through to conversation model
        } finally {
          setRouting(false)
        }
      }
      // A routed connection (when set) overrides the conversation's connection.
      const connectionId =
        routed?.connectionId ?? conversation.connectionId ?? getDefault()?.id ?? null
      const model =
        modelOverride || routed?.model || conversation.model || settings.defaultChatModel
      const route = routed ? { category: routed.category, model: routed.model } : undefined
      const isFirstExchange = conversation.messages.length === 0

      // #context: trim history per the active strategy (per-chat override wins).
      const strategy = conversation.contextStrategy ?? settings.contextStrategy
      let contextWindow: number | null = null
      if (strategy !== 'none') {
        const meta = connectionId ? await getModelMeta(connectionId, model) : null
        contextWindow = resolveContextWindow(model, meta?.contextWindow, settings.contextWindowOverrides)
      }
      const budget = resolveBudget(
        contextWindow,
        settings.contextBudgetFraction,
        settings.contextReplyHeadroom
      )
      const history: ChatMsg[] = [
        ...conversation.messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content },
      ]
      const ctx = buildContext(history, {
        strategy,
        systemPrompt: conversation.systemPrompt,
        budget,
      })

      // For 'summarize', condense the dropped older messages into a system note.
      let summaryNote = ''
      if (ctx.summaryNeeded) {
        const summaryModel = settings.contextSummaryModel || model
        try {
          summaryNote = await summarizeDropped(ctx.dropped, summaryModel, connectionId)
        } catch {
          summaryNote = '' // summarization is best-effort; fall back to plain windowing
        }
      }

      const messages = [
        ...(conversation.systemPrompt
          ? [{ role: 'system' as const, content: conversation.systemPrompt }]
          : []),
        ...(summaryNote
          ? [{ role: 'system' as const, content: `Summary of earlier conversation:\n${summaryNote}` }]
          : []),
        ...ctx.sent.map((m) => ({ role: m.role, content: m.content })),
      ]

      // The agent (tool-calling) path runs when tools are enabled globally OR
      // this conversation has MCP servers selected. MCP servers' tools are
      // offered via mcpServerIds.
      const mcpServerIds = conversation.mcpServerIds ?? []
      const useAgent = settings.toolsEnabled || mcpServerIds.length > 0

      if (useAgent) {
        // #2 Tool-calling loop via the agent endpoint. Tool steps are shown as
        // a transient italic preamble; the final answer streams in after.
        addMessage(conversation.id, { role: 'assistant', content: '', route })
        setStreaming(true)
        let steps = ''
        let answer = ''
        const abort = new AbortController()
        abortRef.current = abort
        try {
          for await (const ev of api.agent.stream({ model, messages, mcpServerIds }, connectionId, abort.signal)) {
            if (ev.kind === 'content') {
              answer += ev.text
            } else if (ev.kind === 'tool_call') {
              steps += `> 🔧 *Calling \`${ev.payload.name}\`…*\n\n`
            } else if (ev.kind === 'tool_result') {
              steps += `> ↳ *${ev.payload.name} returned.*\n\n`
            } else if (ev.kind === 'error') {
              setError(ev.payload.message)
            }
            // While tools run, show steps; once the answer starts, show only it.
            updateLastAssistantMessage(conversation.id, answer || steps)
          }
        } catch (e) {
          if ((e as Error).name !== 'AbortError') {
            setError(e instanceof Error ? e.message : 'Agent error')
            if (!answer) updateLastAssistantMessage(conversation.id, '_(error)_')
          }
        } finally {
          abortRef.current = null
          setStreaming(false)
          if (isFirstExchange && answer) {
            generateTitle(fullText, answer, model, connectionId)
              .then((title) => { if (title) renameConversation(conversation.id, title) })
              .catch(() => {/* best-effort */})
          }
        }
      } else if (settings.streamingEnabled) {
        addMessage(conversation.id, { role: 'assistant', content: '', route })
        setStreaming(true)
        let accumulated = ''
        const abort = new AbortController()
        abortRef.current = abort
        try {
          for await (const chunk of api.chat.stream(
            { model, messages, stream: true },
            connectionId,
            abort.signal
          )) {
            accumulated += chunk
            updateLastAssistantMessage(conversation.id, accumulated)
          }
        } catch (e) {
          if ((e as Error).name === 'AbortError') {
            // User stopped — keep whatever was streamed
          } else {
            setError(e instanceof Error ? e.message : 'Streaming error')
            if (!accumulated) updateLastAssistantMessage(conversation.id, '_(error)_')
          }
        } finally {
          abortRef.current = null
          setStreaming(false)
          if (isFirstExchange && accumulated) {
            generateTitle(fullText, accumulated, model, connectionId)
              .then((title) => { if (title) renameConversation(conversation.id, title) })
              .catch(() => {/* title generation is best-effort */})
          }
        }
      } else {
        try {
          const abort = new AbortController()
          abortRef.current = abort
          const res = await api.chat.complete(
            { model, messages, stream: false },
            connectionId,
            abort.signal
          )
          const reply = res.choices[0]?.message?.content ?? ''
          addMessage(conversation.id, { role: 'assistant', content: reply, route })
          if (isFirstExchange && reply) {
            generateTitle(fullText, reply, model, connectionId)
              .then((title) => { if (title) renameConversation(conversation.id, title) })
              .catch(() => {/* title generation is best-effort */})
          }
        } catch (e) {
          if ((e as Error).name !== 'AbortError') {
            setError(e instanceof Error ? e.message : 'Request failed')
          }
        } finally {
          abortRef.current = null
        }
      }
    },
    [conversation, settings, addMessage, updateLastAssistantMessage, deleteLastMessages, getDefault, renameConversation]
  )

  // Remove the last user+assistant exchange and resend.
  // #5 optional modelOverride re-runs the same prompt on a different model.
  const regenerate = useCallback(async (modelOverride?: string) => {
    if (!conversation) return
    const msgs = conversation.messages
    if (msgs.length < 2) return
    const last = msgs[msgs.length - 1]
    const secondLast = msgs[msgs.length - 2]
    if (last.role !== 'assistant' || secondLast.role !== 'user') return

    deleteLastMessages(conversation.id, 2)

    const userContent = secondLast.content
    const text = typeof userContent === 'string' ? userContent
      : (userContent.find(c => c.type === 'text')?.text ?? '')
    const images = typeof userContent === 'string' ? []
      : userContent.filter(c => c.type === 'image_url').map(c => c.image_url!.url)

    // If regenerating on a specific model, persist it as the conversation's
    // model so subsequent turns continue there.
    if (modelOverride) setModel(conversation.id, modelOverride)
    await send(text, images, [], modelOverride)
  }, [conversation, deleteLastMessages, send, setModel])

  // Edit a specific user message: truncate everything from that message onward, then resend.
  const editAndResend = useCallback(async (messageId: string, newText: string) => {
    if (!conversation) return
    const msgs = conversation.messages
    const idx = msgs.findIndex((m) => m.id === messageId)
    if (idx === -1) return
    const original = msgs[idx]
    const images = typeof original.content === 'string' ? []
      : original.content.filter(c => c.type === 'image_url').map(c => c.image_url!.url)

    truncateAfterMessage(conversation.id, messageId)
    await send(newText, images, [])
  }, [conversation, truncateAfterMessage, send])

  return { send, stop, regenerate, editAndResend, streaming, routing, error }
}
