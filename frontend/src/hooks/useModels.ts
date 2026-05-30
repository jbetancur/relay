import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { GroupedModels, Model } from '@/types'

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

export function useModels(connectionId?: string | null) {
  const [grouped, setGrouped] = useState<GroupedModels>({ chat: [], image: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (connectionId === null || connectionId === undefined) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    api.models
      .list(connectionId)
      .then((res) => {
        if (cancelled) return
        const chat: Model[] = []
        const image: Model[] = []
        for (const m of res.data) {
          if (isImageModel(m.id)) image.push(m)
          else chat.push(m)
        }
        setGrouped({ chat, image })
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

  return { grouped, loading, error }
}
