import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { GroupedModels, Model, ModelKind, ModelMeta } from '@/types'

// Heuristic patterns are the FALLBACK only — the authoritative kind/capability
// source is the backend (internal/modelmeta), fetched here as a bulk table. The
// patterns cover providers/models the backend table doesn't know, so a chat list
// is never empty for self-hosted setups.
const IMAGE_MODEL_PATTERNS = ['dall-e', 'gpt-image', 'stable-diffusion', 'flux', 'imagen']

const VISION_MODEL_PATTERNS = [
  'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision',
  'claude-3', 'claude-4',
  'gemini',
  'llava', 'bakllava', 'moondream', 'cogvlm', 'minicpm-v',
  'vision', 'vl', 'pixtral',
]

export function isVisionModel(id: string): boolean {
  const lower = id.toLowerCase()
  return VISION_MODEL_PATTERNS.some((p) => lower.includes(p))
}

function isImageModel(id: string) {
  const lower = id.toLowerCase()
  return IMAGE_MODEL_PATTERNS.some((p) => lower.includes(p))
}

// Resolve a model id to its kind via longest-substring match over the backend
// table; falls back to the local image heuristic, otherwise treats it as chat.
function kindOf(id: string, table: Record<string, ModelMeta>): ModelKind {
  const lower = id.toLowerCase()
  const keys = Object.keys(table).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    if (lower.includes(k.toLowerCase())) {
      const kind = table[k].kind
      if (kind) return kind
    }
  }
  return isImageModel(id) ? 'image' : 'chat'
}

// Strip a trailing date/version suffix so dated snapshots collapse to one base.
// Conservative: only well-known shapes, leaving anything ambiguous untouched.
export function baseModelId(id: string): string {
  return id
    .replace(/[-@]\d{4}-\d{2}-\d{2}$/, '')   // -2024-08-06
    .replace(/[-@]\d{8}$/, '')               // -20240806
    .replace(/:latest$/, '')                 // ollama :latest
    .replace(/-v\d+(\.\d+)*$/, '')           // -v1, -v1.5
}

export interface UseModelsResult {
  grouped: GroupedModels
  // baseId → all variant models (dated snapshots) under it, for collapsing.
  variants: Map<string, Model[]>
  loading: boolean
  error: string | null
}

export function useModels(connectionId?: string | null): UseModelsResult {
  const [grouped, setGrouped] = useState<GroupedModels>({ chat: [], image: [] })
  const [variants, setVariants] = useState<Map<string, Model[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (connectionId === null || connectionId === undefined) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)

    Promise.all([
      api.models.list(connectionId),
      api.models.metaTable(connectionId).catch(() => ({} as Record<string, ModelMeta>)),
    ])
      .then(([res, table]) => {
        if (cancelled) return
        const chat: Model[] = []
        const image: Model[] = []
        const variantMap = new Map<string, Model[]>()

        for (const m of res.data) {
          const kind = kindOf(m.id, table)
          if (kind === 'image') {
            image.push(m)
            continue
          }
          // Drop non-chat utility models (embedding/audio/moderation/other).
          if (kind !== 'chat') continue
          chat.push(m)
          const base = baseModelId(m.id)
          const arr = variantMap.get(base) ?? []
          arr.push(m)
          variantMap.set(base, arr)
        }

        setGrouped({ chat, image })
        setVariants(variantMap)
        setError(null)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [connectionId])

  return { grouped, variants, loading, error }
}
