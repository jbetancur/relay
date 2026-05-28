import type {
  ChatCompletionRequest,
  ChatCompletionChunk,
  ModelsResponse,
  ImageGenerationRequest,
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
