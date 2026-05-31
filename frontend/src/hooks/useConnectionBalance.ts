import { useEffect, useState, useCallback } from 'react'

export interface ConnectionBalance {
  total_credits: number
  total_usage: number
  credits_remaining: number
}

export function useConnectionBalance(connectionId: string, baseUrl: string) {
  const [balance, setBalance] = useState<ConnectionBalance | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSupported = baseUrl.includes('openrouter.ai')

  const fetch_ = useCallback(async () => {
    if (!isSupported) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/connections/${connectionId}/balance`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error ?? res.statusText)
      }
      const data: ConnectionBalance = await res.json()
      setBalance(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch balance')
    } finally {
      setLoading(false)
    }
  }, [connectionId, isSupported])

  useEffect(() => {
    fetch_()
  }, [fetch_])

  return { balance, loading, error, refresh: fetch_, isSupported }
}
