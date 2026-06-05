import { create } from 'zustand'
import { api } from '@/lib/api'
import type { Agent, AgentInput, AgentBudget, AgentBudgetInput } from '@/types'

interface AgentsState {
  agents: Agent[]
  loading: boolean
  error: string | null
  fetch: () => Promise<void>
  create: (input: AgentInput) => Promise<Agent>
  update: (id: string, input: AgentInput) => Promise<Agent>
  remove: (id: string) => Promise<void>
  getBudgets: (id: string) => Promise<AgentBudget[]>
  upsertBudget: (id: string, input: AgentBudgetInput) => Promise<AgentBudget>
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  loading: false,
  error: null,

  async fetch() {
    set({ loading: true, error: null })
    try {
      const data = await api.agents.list()
      set({ agents: data ?? [] })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load agents' })
    } finally {
      set({ loading: false })
    }
  },

  async create(input) {
    const agent = await api.agents.create(input)
    set((s) => ({ agents: [...s.agents, agent] }))
    return agent
  },

  async update(id, input) {
    const agent = await api.agents.update(id, input)
    set((s) => ({ agents: s.agents.map((a) => (a.id === id ? agent : a)) }))
    return agent
  },

  async remove(id) {
    await api.agents.remove(id)
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }))
  },

  getBudgets: (id) => api.agents.getBudgets(id),
  upsertBudget: (id, input) => api.agents.upsertBudget(id, input),
}))
