import { create } from 'zustand'
import type { MCPServer, MCPServerInput, MCPToolDef } from '@/types'

type TestResult =
  | { ok: true; toolCount: number; tools: MCPToolDef[] }
  | { ok: false; error: string }

interface MCPServersState {
  servers: MCPServer[]
  loading: boolean
  error: string | null
  fetch: () => Promise<void>
  create: (input: MCPServerInput) => Promise<MCPServer>
  update: (id: string, input: MCPServerInput) => Promise<MCPServer>
  remove: (id: string) => Promise<void>
  test: (input: MCPServerInput) => Promise<TestResult>
  getFull: (id: string) => Promise<MCPServer>
}

export const useMCPServersStore = create<MCPServersState>((set) => ({
  servers: [],
  loading: false,
  error: null,

  async fetch() {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/mcp-servers')
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data: MCPServer[] = await res.json()
      set({ servers: data ?? [] })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load MCP servers' })
    } finally {
      set({ loading: false })
    }
  },

  async create(input) {
    const res = await fetch('/api/mcp-servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error ?? res.statusText)
    }
    const server: MCPServer = await res.json()
    set((s) => ({ servers: [...s.servers, server] }))
    return server
  },

  async update(id, input) {
    const res = await fetch(`/api/mcp-servers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error ?? res.statusText)
    }
    const server: MCPServer = await res.json()
    set((s) => ({ servers: s.servers.map((c) => (c.id === id ? server : c)) }))
    return server
  },

  async remove(id) {
    const res = await fetch(`/api/mcp-servers/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error ?? res.statusText)
    }
    set((s) => ({ servers: s.servers.filter((c) => c.id !== id) }))
  },

  async test(input) {
    const res = await fetch('/api/mcp-servers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return res.json()
  },

  async getFull(id) {
    const res = await fetch(`/api/mcp-servers/${id}`)
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  },
}))
