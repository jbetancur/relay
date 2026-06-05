import * as vscode from 'vscode';

export interface RouteHints {
  fileCount: number;
  selectionLen: number;
  language: string;
  hasDiff: boolean;
}

export interface RouteRequest {
  task: string;
  messages?: { role: string; content: string }[];
  hints: RouteHints;
  agentId?: string;
}

export interface RouteResponse {
  model: string;
  connectionId: string;
  tier: 'local' | 'mid' | 'frontier';
  reason: string;
  confidence: number;
  classifierUsed: boolean;
  candidates: { connectionId: string; model: string; tier: string }[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class RelayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly defaultConnectionId: string,
  ) {}

  private headers(connectionId?: string): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    const connId = connectionId ?? this.defaultConnectionId;
    if (connId) {
      h['X-Relay-Connection-ID'] = connId;
    }
    return h;
  }

  async route(req: RouteRequest): Promise<RouteResponse> {
    const resp = await fetch(`${this.baseUrl}/api/route`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Relay /api/route ${resp.status}: ${body}`);
    }
    return resp.json() as Promise<RouteResponse>;
  }

  // Streams content chunks from /api/v1/chat/completions (OpenAI-compatible SSE).
  // Yields each text delta as it arrives. Stops on [DONE] or cancellation.
  async *chatCompletionsStream(
    model: string,
    connectionId: string,
    messages: ChatMessage[],
    cancelToken: vscode.CancellationToken,
  ): AsyncIterable<string> {
    const controller = new AbortController();
    const dispose = cancelToken.onCancellationRequested(() => controller.abort());

    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}/api/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers(connectionId),
        body: JSON.stringify({ model, messages, stream: true }),
        signal: controller.signal,
      });
    } catch (err) {
      dispose.dispose();
      if ((err as Error).name === 'AbortError') return;
      throw err;
    }

    if (!resp.ok) {
      dispose.dispose();
      const body = await resp.text();
      throw new Error(`Relay /api/v1/chat/completions ${resp.status}: ${body}`);
    }

    try {
      yield* this.parseSSE(resp, controller);
    } finally {
      dispose.dispose();
    }
  }

  private async *parseSSE(
    resp: Response,
    controller: AbortController,
  ): AsyncIterable<string> {
    if (!resp.body) return;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data) as {
              choices?: { delta?: { content?: string } }[];
            };
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) yield chunk;
          } catch {
            // malformed chunk — skip
          }
        }
      }
    } finally {
      reader.releaseLock();
      controller.abort(); // clean up if we exit early
    }
  }
}
