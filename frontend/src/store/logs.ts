import { create } from 'zustand'
import type { LogEntry } from '@/types'

const MAX_ENTRIES = 1000

interface LogsState {
  entries: LogEntry[]
  connected: boolean
  add: (entry: LogEntry) => void
  setConnected: (connected: boolean) => void
  clear: () => void
}

// Ephemeral by design — logs are live troubleshooting state, never persisted.
export const useLogsStore = create<LogsState>((set) => ({
  entries: [],
  connected: false,

  add(entry) {
    set((s) => {
      const next = s.entries.length >= MAX_ENTRIES
        ? [...s.entries.slice(s.entries.length - MAX_ENTRIES + 1), entry]
        : [...s.entries, entry]
      return { entries: next }
    })
  },

  setConnected(connected) {
    set({ connected })
  },

  clear() {
    set({ entries: [] })
  },
}))
