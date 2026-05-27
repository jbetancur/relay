// ── Connections ───────────────────────────────────────────────────────────────

export type ConnectionTypeHint = 'openai' | 'ollama' | 'anthropic' | 'custom'

export interface Connection {
  id: string
  name: string
  baseUrl: string
  apiKey?: string // only present in single GET response
  typeHint: ConnectionTypeHint
  enabled: boolean
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

export interface ConnectionInput {
  name: string
  baseUrl: string
  apiKey: string
  typeHint: ConnectionTypeHint
  enabled: boolean
  isDefault: boolean
}

// ── Conversations ─────────────────────────────────────────────────────────────

export type Role = 'user' | 'assistant' | 'system'

export interface MessageContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface Message {
  id: string
  role: Role
  content: string | MessageContent[]
  createdAt: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  model: string
  systemPrompt: string
  connectionId: string | null
  createdAt: number
  updatedAt: number
}

// ── Models ────────────────────────────────────────────────────────────────────

export interface Model {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

export interface ModelsResponse {
  object: 'list'
  data: Model[]
}

export type ModelGroup = 'chat' | 'image'

export interface GroupedModels {
  chat: Model[]
  image: Model[]
}

// ── Chat API ──────────────────────────────────────────────────────────────────

export interface ChatCompletionRequest {
  model: string
  messages: Array<{ role: Role; content: string | MessageContent[] }>
  stream: boolean
  temperature?: number
  max_tokens?: number
}

export interface ChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  choices: Array<{
    delta: { role?: Role; content?: string }
    finish_reason: string | null
    index: number
  }>
}

// ── Image API ─────────────────────────────────────────────────────────────────

export type ImageSize =
  | '256x256'
  | '512x512'
  | '1024x1024'
  | '1792x1024'
  | '1024x1792'

export type ImageQuality = 'standard' | 'hd' | 'low' | 'medium' | 'high' | 'auto'
export type ImageStyle = 'vivid' | 'natural'

export interface ImageGenerationRequest {
  model: string
  prompt: string
  n?: number
  size?: ImageSize
  quality?: ImageQuality
  style?: ImageStyle
  response_format?: 'url' | 'b64_json'
}

export interface GeneratedImage {
  id: string
  prompt: string
  model: string
  url?: string
  b64_json?: string
  revisedPrompt?: string
  createdAt: number
  size: ImageSize
  quality: ImageQuality
}

// ── Settings ──────────────────────────────────────────────────────────────────

export interface AppSettings {
  defaultChatModel: string
  defaultImageModel: string
  theme: 'light' | 'dark' | 'auto'
  streamingEnabled: boolean
}
