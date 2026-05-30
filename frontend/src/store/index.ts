import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Conversation, Message, AppSettings, GeneratedImage, ContextStrategy } from '@/types'

export { useConnectionsStore } from './connections'

function randomId() {
  return Math.random().toString(36).slice(2, 11)
}

// ── Conversation store ────────────────────────────────────────────────────────

interface ConversationState {
  conversations: Conversation[]
  createConversation: (model?: string) => Conversation
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'createdAt'>) => Message
  updateLastAssistantMessage: (conversationId: string, content: string) => void
  setModel: (conversationId: string, model: string) => void
  setSystemPrompt: (conversationId: string, prompt: string) => void
  setContextStrategy: (conversationId: string, strategy: ContextStrategy | undefined) => void
  setMcpServers: (conversationId: string, ids: string[]) => void
  setConnection: (conversationId: string, connectionId: string | null) => void
  deleteLastMessages: (conversationId: string, count: number) => void
  truncateAfterMessage: (conversationId: string, messageId: string) => void
  getConversation: (id: string) => Conversation | undefined
}

export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      conversations: [],

      createConversation(model = '') {
        const conv: Conversation = {
          id: randomId(),
          title: 'New conversation',
          messages: [],
          model,
          systemPrompt: '',
          connectionId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set((s) => ({ conversations: [conv, ...s.conversations] }))
        return conv
      },

      deleteConversation(id) {
        set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) }))
      },

      renameConversation(id, title) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c
          ),
        }))
      },

      addMessage(conversationId, message) {
        const msg: Message = { ...message, id: randomId(), createdAt: Date.now() }
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== conversationId) return c
            const isFirst = c.messages.length === 0
            return {
              ...c,
              messages: [...c.messages, msg],
              title:
                isFirst && message.role === 'user'
                  ? String(message.content).slice(0, 60)
                  : c.title,
              updatedAt: Date.now(),
            }
          }),
        }))
        return msg
      },

      updateLastAssistantMessage(conversationId, content) {
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== conversationId) return c
            const messages = [...c.messages]
            const last = messages[messages.length - 1]
            if (last?.role === 'assistant') {
              messages[messages.length - 1] = { ...last, content }
            }
            return { ...c, messages, updatedAt: Date.now() }
          }),
        }))
      },

      setModel(conversationId, model) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, model } : c
          ),
        }))
      },

      setSystemPrompt(conversationId, prompt) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, systemPrompt: prompt } : c
          ),
        }))
      },

      setContextStrategy(conversationId, strategy) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, contextStrategy: strategy } : c
          ),
        }))
      },

      setMcpServers(conversationId, ids) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, mcpServerIds: ids } : c
          ),
        }))
      },

      setConnection(conversationId, connectionId) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, connectionId, updatedAt: Date.now() } : c
          ),
        }))
      },

      deleteLastMessages(conversationId, count) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, messages: c.messages.slice(0, -count), updatedAt: Date.now() }
              : c
          ),
        }))
      },

      truncateAfterMessage(conversationId, messageId) {
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== conversationId) return c
            const idx = c.messages.findIndex((m) => m.id === messageId)
            if (idx === -1) return c
            return { ...c, messages: c.messages.slice(0, idx), updatedAt: Date.now() }
          }),
        }))
      },

      getConversation(id) {
        return get().conversations.find((c) => c.id === id)
      },
    }),
    { name: 'relay-conversations' }
  )
)

// ── Settings store ────────────────────────────────────────────────────────────

interface SettingsState {
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: {
        defaultChatModel: '',
        defaultImageModel: '',
        theme: 'dark',
        streamingEnabled: true,
        autoRouteEnabled: false,
        routeSlots: {},
        routeFallback: 'conversation',
        priceOverrides: {},
        monthlyBudgetUSD: 0,
        toolsEnabled: false,
        contextStrategy: 'window',
        contextBudgetFraction: 0.75,
        contextReplyHeadroom: 1024,
        contextSummaryModel: '',
        contextWindowOverrides: {},
      },
      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
      },
    }),
    {
      name: 'relay-settings',
      version: 5,
      migrate(state: unknown, version: number) {
        const root = (state ?? {}) as Record<string, unknown>
        const s = (root.settings ?? root) as Record<string, unknown>
        if (version < 2) {
          delete s.apiBaseUrl
          delete s.apiKey
        }
        if (version < 3) {
          // Backfill fields added in v3 so existing persisted state stays valid.
          s.autoRouteEnabled ??= false
          s.priceOverrides ??= {}
          s.monthlyBudgetUSD ??= 0
          s.toolsEnabled ??= false
        }
        if (version < 4) {
          // v4 replaces the cheap/strong pair with category slots + a fallback.
          delete s.autoRouteCheapModel
          delete s.autoRouteStrongModel
          s.routeSlots ??= {}
          s.routeFallback ??= 'conversation'
        }
        if (version < 5) {
          // v5 adds user-controlled context management.
          s.contextStrategy ??= 'window'
          s.contextBudgetFraction ??= 0.75
          s.contextReplyHeadroom ??= 1024
          s.contextSummaryModel ??= ''
          s.contextWindowOverrides ??= {}
        }
        root.settings = s
        return root as unknown as SettingsState
      },
    }
  )
)

// ── Image gallery store ───────────────────────────────────────────────────────

interface ImageGalleryState {
  images: GeneratedImage[]
  addImage: (image: GeneratedImage) => void
  deleteImage: (id: string) => void
}

export const useImageGalleryStore = create<ImageGalleryState>()(
  persist(
    (set) => ({
      images: [],
      addImage(image) {
        set((s) => ({ images: [image, ...s.images] }))
      },
      deleteImage(id) {
        set((s) => ({ images: s.images.filter((img) => img.id !== id) }))
      },
    }),
    { name: 'relay-images' }
  )
)

// ── Recent models store ───────────────────────────────────────────────────────
// Tracks recently picked models per connection so pickers can float them to the
// top. Keyed per connection since model availability differs by provider.

const MAX_RECENTS = 8

interface RecentModelsState {
  recentModels: Record<string, string[]>
  recordModel: (connectionId: string, model: string) => void
}

export const useRecentModelsStore = create<RecentModelsState>()(
  persist(
    (set) => ({
      recentModels: {},
      recordModel(connectionId, model) {
        if (!connectionId || !model) return
        set((s) => {
          const prev = s.recentModels[connectionId] ?? []
          const next = [model, ...prev.filter((m) => m !== model)].slice(0, MAX_RECENTS)
          return { recentModels: { ...s.recentModels, [connectionId]: next } }
        })
      },
    }),
    { name: 'relay-recent-models' }
  )
)
