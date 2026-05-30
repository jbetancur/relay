import type {
  ChatCompletionRequest,
  ChatCompletionChunk,
  ModelsResponse,
  ModelMeta,
  ImageGenerationRequest,
  ModelUsage,
  AgentEvent,
} from '@/types'

const BASE = '/api'

function makeHeaders(connectionId?: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (connectionId) headers['X-Relay-Connection-ID'] = connectionId
  return headers
}

async function request<T>(
  path: string,
  init?: RequestInit,
  connectionId?: string | null,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    signal,
    headers: {
      ...makeHeaders(connectionId),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  models: {
    list(connectionId?: string | null): Promise<ModelsResponse> {
      return request('/v1/models', undefined, connectionId)
    },
    // Single-model metadata (probes the provider where supported).
    meta(connectionId: string, model: string): Promise<ModelMeta> {
      return request(`/connections/${connectionId}/model-meta?model=${encodeURIComponent(model)}`)
    },
    // Full static metadata table keyed by model pattern (bulk, no probing).
    metaTable(connectionId: string): Promise<Record<string, ModelMeta>> {
      return request(`/connections/${connectionId}/model-meta`)
    },
  },

  chat: {
    async *stream(
      body: ChatCompletionRequest,
      connectionId?: string | null,
      signal?: AbortSignal
    ): AsyncGenerator<string> {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: makeHeaders(connectionId),
        body: JSON.stringify({ ...body, stream: true }),
        signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(`API error ${res.status}: ${text}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') return
          try {
            const chunk: ChatCompletionChunk = JSON.parse(data)
            const content = chunk.choices[0]?.delta?.content
            if (content) yield content
          } catch {
            // malformed chunk — skip
          }
        }
      }
    },

    complete(body: ChatCompletionRequest, connectionId?: string | null, signal?: AbortSignal) {
      return request<{ choices: Array<{ message: { content: string } }> }>(
        '/v1/chat/completions',
        { method: 'POST', body: JSON.stringify({ ...body, stream: false }) },
        connectionId,
        signal
      )
    },
  },

  usage: {
    byModel(sinceMillis?: number): Promise<ModelUsage[]> {
      const qs = sinceMillis ? `?since=${sinceMillis}` : ''
      return request<ModelUsage[]>(`/usage/by-model${qs}`)
    },
  },

  agent: {
    // Tool-calling chat. Yields either assistant text deltas or structured tool
    // step events so the UI can show "Searching…" / results inline.
    async *stream(
      body: { model: string; messages: Array<{ role: string; content: unknown }> },
      connectionId?: string | null,
      signal?: AbortSignal
    ): AsyncGenerator<AgentEvent> {
      const res = await fetch(`${BASE}/agent/chat`, {
        method: 'POST',
        headers: makeHeaders(connectionId),
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(`Agent error ${res.status}: ${text}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE records are separated by a blank line.
        const records = buffer.split('\n\n')
        buffer = records.pop() ?? ''

        for (const record of records) {
          let event = 'message'
          let data = ''
          for (const line of record.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim()
            else if (line.startsWith('data: ')) data = line.slice(6)
          }
          if (!data) continue
          if (data === '[DONE]') return

          if (event === 'tool_call' || event === 'tool_result' || event === 'error') {
            try {
              yield { kind: event, payload: JSON.parse(data) }
            } catch {
              // skip malformed
            }
          } else {
            // default content chunk (OpenAI-style)
            try {
              const chunk: ChatCompletionChunk = JSON.parse(data)
              const content = chunk.choices[0]?.delta?.content
              if (content) yield { kind: 'content', text: content }
            } catch {
              // skip malformed
            }
          }
        }
      }
    },
  },

  documents: {
    // Server-side extraction. PDFs are parsed to text; other files pass through.
    async extract(file: File): Promise<{ name: string; text: string }> {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${BASE}/documents/extract`, { method: 'POST', body: form })
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(`Extract failed ${res.status}: ${text}`)
      }
      return res.json()
    },
  },

  images: {
    generate(body: ImageGenerationRequest, connectionId?: string | null) {
      const { style: _style, response_format: _rf, ...payload } = body
return request<{ data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> }>(
        '/v1/images/generations',
        { method: 'POST', body: JSON.stringify(payload) },
        connectionId
      )
    },
  },
}
