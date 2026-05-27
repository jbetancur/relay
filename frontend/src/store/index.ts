import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Conversation, Message, AppSettings, GeneratedImage } from '@/types'

export { useConnectionsStore } from './connections'

function randomId() {
  return Math.random().toString(36).slice(2, 11)
}

// ── Conversation store ────────────────────────────────────────────────────────

interface ConversationState {
  conversations: Conversation[]
  createConversation: () => Conversation
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'createdAt'>) => Message
  updateLastAssistantMessage: (conversationId: string, content: string) => void
  setModel: (conversationId: string, model: string) => void
  setSystemPrompt: (conversationId: string, prompt: string) => void
  setConnection: (conversationId: string, connectionId: string | null) => void
  deleteLastMessages: (conversationId: string, count: number) => void
  truncateAfterMessage: (conversationId: string, messageId: string) => void
  getConversation: (id: string) => Conversation | undefined
}

export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      conversations: [],

      createConversation() {
        const conv: Conversation = {
          id: randomId(),
          title: 'New conversation',
          messages: [],
          model: '',
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
      },
      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
      },
    }),
    {
      name: 'relay-settings',
      version: 2,
      migrate(state: unknown, version: number) {
        if (version < 2) {
          const old = state as Record<string, unknown>
          delete old.apiBaseUrl
          delete old.apiKey
          return old
        }
        return state as SettingsState
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
