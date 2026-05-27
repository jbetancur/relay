import { create } from 'zustand'
import type { Connection, ConnectionInput } from '@/types'

interface ConnectionsState {
  connections: Connection[]
  loading: boolean
  error: string | null
  fetch: () => Promise<void>
  create: (input: ConnectionInput) => Promise<Connection>
  update: (id: string, input: ConnectionInput) => Promise<Connection>
  remove: (id: string) => Promise<void>
  getById: (id: string) => Connection | undefined
  getDefault: () => Connection | undefined
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  loading: false,
  error: null,

  async fetch() {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/connections')
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data: Connection[] = await res.json()
      set({ connections: data ?? [] })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load connections' })
    } finally {
      set({ loading: false })
    }
  },

  async create(input) {
    const res = await fetch('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error ?? res.statusText)
    }
    const conn: Connection = await res.json()
    set((s) => ({ connections: [...s.connections, conn] }))
    return conn
  },

  async update(id, input) {
    const res = await fetch(`/api/connections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error ?? res.statusText)
    }
    const conn: Connection = await res.json()
    set((s) => ({
      connections: s.connections.map((c) => (c.id === id ? conn : c)),
    }))
    return conn
  },

  async remove(id) {
    const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error ?? res.statusText)
    }
    set((s) => ({ connections: s.connections.filter((c) => c.id !== id) }))
  },

  getById(id) {
    return get().connections.find((c) => c.id === id)
  },

  getDefault() {
    const conns = get().connections
    return (
      conns.find((c) => c.isDefault && c.enabled) ??
      conns.find((c) => c.enabled)
    )
  },
}))
