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

// ── Agents ────────────────────────────────────────────────────────────────────

export interface Agent {
  id: string
  slug: string
  name: string
  model: string
  instructions: string
  connectionId?: string
  mcpServerIds: string[]
  builtinTools: string[]
  maxRounds: number
  maxTokensRun: number
  maxCostRun: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface AgentInput {
  name: string
  slug?: string
  model: string
  instructions: string
  connectionId?: string
  mcpServerIds: string[]
  builtinTools: string[]
  maxRounds: number
  maxTokensRun: number
  maxCostRun: number
  enabled: boolean
}

export interface AgentBudget {
  id: string
  subjectType: string
  subjectId: string
  period: 'day' | 'month'
  limitUsd: number
  limitTokens: number
  createdAt: number
  updatedAt: number
}

export interface AgentBudgetInput {
  period: 'day' | 'month'
  limitUsd: number
  limitTokens: number
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
  // When auto-routing picked this turn's model, record tier/model/reason so
  // the UI can show why. Absent on un-routed messages.
  route?: { tier: string; model: string; reason: string }
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
  // Saved agent active for this conversation. When set, the agent drives model,
  // instructions, tools, and caps — the loop always runs via the agent endpoint.
  agentId?: string
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
  | { kind: 'cost'; payload: { tokens: number; costUsd: number; costKnown: boolean } }
  | { kind: 'budget_exceeded'; payload: { scope: 'run' | 'ceiling'; reason: string } }
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

// ── Auto-routing ─────────────────────────────────────────────────────────────
// The backend POST /api/route owns all routing logic. The frontend only needs
// to call it and display the result.

export interface RouteRequest {
  task: string
  agentId?: string
}

export interface RouteResponse {
  model: string
  connectionId: string
  tier: 'local' | 'mid' | 'frontier'
  reason: string
  confidence: number
  classifierUsed: boolean
  candidates: { connectionId: string; model: string; tier: string }[]
}

export interface AppSettings {
  defaultChatModel: string
  defaultImageModel: string
  theme: 'light' | 'dark' | 'auto'
  streamingEnabled: boolean
  autoRouteEnabled: boolean
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
