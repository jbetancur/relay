import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PromptTemplate {
  id: string
  name: string
  content: string
  createdAt: number
}

interface PromptsState {
  prompts: PromptTemplate[]
  save: (name: string, content: string) => PromptTemplate
  update: (id: string, patch: Partial<Pick<PromptTemplate, 'name' | 'content'>>) => void
  remove: (id: string) => void
}

function randomId() {
  return Math.random().toString(36).slice(2, 11)
}

export const usePromptsStore = create<PromptsState>()(
  persist(
    (set) => ({
      prompts: [],
      save(name, content) {
        const p: PromptTemplate = { id: randomId(), name, content, createdAt: Date.now() }
        set((s) => ({ prompts: [p, ...s.prompts] }))
        return p
      },
      update(id, patch) {
        set((s) => ({
          prompts: s.prompts.map((p) => p.id === id ? { ...p, ...patch } : p),
        }))
      },
      remove(id) {
        set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) }))
      },
    }),
    { name: 'relay-prompts' }
  )
)

export function extractVariables(content: string): string[] {
  const matches = content.matchAll(/\{\{(\w+)\}\}/g)
  const seen = new Set<string>()
  const vars: string[] = []
  for (const m of matches) {
    if (!seen.has(m[1])) { seen.add(m[1]); vars.push(m[1]) }
  }
  return vars
}

export function fillVariables(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? `{{${k}}}`)
}
