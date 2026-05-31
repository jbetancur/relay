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

export interface ConnectionStats {
  connectionId: string
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  updatedAt: number
}

export interface ModelUsage {
  connectionId: string
  model: string
  requestCount: number
  promptTokens: number
  completionTokens: number
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export interface LogEntry {
  time: number // unix millis
  level: string // DEBUG | INFO | WARN | ERROR
  msg: string
  attrs?: Record<string, unknown>
}

// ── MCP servers ───────────────────────────────────────────────────────────────

export interface MCPServer {
  id: string
  name: string
  url: string
  headers?: Record<string, string> // only present in single GET (write-only in list)
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface MCPServerInput {
  name: string
  url: string
  headers: Record<string, string>
  enabled: boolean
}

export interface MCPToolDef {
  name: string
  description: string
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
  // #routing: when auto-routing picked this assistant turn's model, record the
  // category + model so the UI can surface why. Absent on older/un-routed messages.
  route?: { category: RouteCategory; model: string }
}

// #context: how the conversation history is trimmed before being sent upstream.
// 'none' sends everything, 'window' keeps recent messages within a token budget,
// 'summarize' condenses dropped older messages via a cheap model.
export type ContextStrategy = 'none' | 'window' | 'summarize'

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  model: string
  systemPrompt: string
  connectionId: string | null
  createdAt: number
  updatedAt: number
  // Per-conversation override of the global context strategy; falls back to
  // settings.contextStrategy when unset.
  contextStrategy?: ContextStrategy
  // MCP servers active for this conversation; their tools are offered to the
  // model. Non-empty implies the agent (tool-calling) path for sends.
  mcpServerIds?: string[]
  // Organization: pinned floats to the top; archived hides from the main list.
  pinned?: boolean
  archived?: boolean
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

// Per-model metadata resolved by the backend (table + optional provider probe).
export type ModelKind = 'chat' | 'image' | 'embedding' | 'audio' | 'moderation' | 'other'

export interface ModelMeta {
  contextWindow: number // 0 = unknown
  price?: { input: number; output: number } // USD / 1M tokens
  capabilities?: string[] // e.g. ['vision'], ['image']
  kind?: ModelKind
  source: 'probe' | 'table' | 'unknown'
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

// ── Agent / tool-calling ────────────────────────────────────────────────────

export type AgentEvent =
  | { kind: 'content'; text: string }
  | { kind: 'tool_call'; payload: { name: string; args: string } }
  | { kind: 'tool_result'; payload: { name: string; result: string } }
  | { kind: 'error'; payload: { message: string } }

// ── Image API ─────────────────────────────────────────────────────────────────

export type ImageSize =
  | '256x256'
  | '512x512'
  | '1024x1024'
  | '1792x1024'
  | '1024x1792'
  | '1536x1024'
  | '1024x1536'

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
  output_format?: 'png' | 'jpeg' | 'webp'
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

export interface ModelPriceOverride {
  input: number
  output: number
}

// #3 Auto-routing: an LLM classifier picks a category per prompt; each category
// maps to a model on any connection, so routing can span providers.
export type RouteCategory = 'coding' | 'creative' | 'reasoning' | 'fast'

export interface RouteSlot {
  model: string
  connectionId: string | null // null = use the conversation's own connection
}

export interface AppSettings {
  defaultChatModel: string
  defaultImageModel: string
  theme: 'light' | 'dark' | 'auto'
  streamingEnabled: boolean
  // #3 Auto-routing: when on, a classifier sorts each prompt into a category and
  // the message is sent to that category's configured model + connection.
  autoRouteEnabled: boolean
  routeSlots: Partial<Record<RouteCategory, RouteSlot>>
  // On classifier failure/timeout, fall back to the conversation's own model or
  // the Fast slot.
  routeFallback: 'conversation' | 'fast'
  // #9 Cost: per-model price overrides ($/1M tokens) and an optional monthly
  // budget in USD. Empty/zero budget means "no budget".
  priceOverrides: Record<string, ModelPriceOverride>
  monthlyBudgetUSD: number
  // #2 Tool use: when on, chat routes through the agent loop so the model can
  // call server-side tools (e.g. web search).
  toolsEnabled: boolean
  // #context: default trimming strategy (overridable per conversation) plus its
  // knobs. budgetFraction is the share of the model's context window we fill;
  // replyHeadroom reserves tokens for the response. summaryModel is used only by
  // the 'summarize' strategy. contextWindowOverrides lets users set windows for
  // unknown/self-hosted models, mirroring priceOverrides.
  contextStrategy: ContextStrategy
  contextBudgetFraction: number
  contextReplyHeadroom: number
  contextSummaryModel: string
  contextWindowOverrides: Record<string, number>
  maxTokens: number | null
}
