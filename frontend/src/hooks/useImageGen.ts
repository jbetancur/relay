import { useState } from 'react'
import { api } from '@/lib/api'
import { useImageGalleryStore, useSettingsStore } from '@/store'
import type { ImageSize, ImageQuality, GeneratedImage } from '@/types'

export interface ImageGenParams {
  prompt: string
  model: string
  size: ImageSize
  quality: ImageQuality
  n: number
}

export function useImageGen(connectionId?: string | null) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { addImage } = useImageGalleryStore()
  const { settings } = useSettingsStore()

  async function generate(params: ImageGenParams) {
    setError(null)
    setGenerating(true)
    try {
      const model = params.model || settings.defaultImageModel
      const isGptImage = model.startsWith('gpt-image')
      const res = await api.images.generate(
        {
          model,
          prompt: params.prompt,
          n: params.n,
          size: params.size,
          quality: params.quality,
          ...(!isGptImage && { response_format: 'url' }),
        },
        connectionId
      )

      const images: GeneratedImage[] = res.data.map((item) => {
        const src = item.url
          ? item.url
          : item.b64_json
          ? `data:image/png;base64,${item.b64_json}`
          : undefined
        return {
          id: Math.random().toString(36).slice(2),
          prompt: params.prompt,
          model,
          url: src,
          revisedPrompt: item.revised_prompt,
          createdAt: Date.now(),
          size: params.size,
          quality: params.quality,
        }
      })

      images.forEach(addImage)
      return images
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Generation failed'
      setError(msg)
      return []
    } finally {
      setGenerating(false)
    }
  }

  return { generate, generating, error }
}
