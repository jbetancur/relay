import { useState, useEffect, useCallback } from 'react'
import type { ConnectionStats } from '@/types'

export function useConnectionStats(connectionId: string) {
  const [stats, setStats] = useState<ConnectionStats | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.fetch(`/api/connections/${connectionId}/stats`)
      if (!res.ok) return
      const data: ConnectionStats = await res.json()
      setStats(data)
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  const reset = useCallback(async () => {
    await window.fetch(`/api/connections/${connectionId}/stats`, { method: 'DELETE' })
    setStats(null)
  }, [connectionId])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { stats, loading, refresh: fetch, reset }
}
