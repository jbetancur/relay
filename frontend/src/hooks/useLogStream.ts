import { useEffect } from 'react'
import { useLogsStore } from '@/store/logs'
import type { LogEntry } from '@/types'

const STREAM_URL = '/api/logs/stream'

// Opens an SSE connection to the backend log stream only while `enabled` (i.e.
// while the log drawer is open). The server replays its ring buffer on connect,
// so we clear first to avoid duplicating history across reopens. Reconnects with
// a small backoff if the stream drops.
export function useLogStream(enabled: boolean) {
  const { add, clear, setConnected } = useLogsStore()

  useEffect(() => {
    if (!enabled) return

    clear()
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const connect = () => {
      if (closed) return
      source = new EventSource(STREAM_URL)

      source.onopen = () => setConnected(true)

      source.onmessage = (ev) => {
        try {
          const entry = JSON.parse(ev.data) as LogEntry
          add(entry)
        } catch {
          // skip malformed frame
        }
      }

      source.onerror = () => {
        setConnected(false)
        source?.close()
        if (!closed) {
          retry = setTimeout(connect, 2000)
        }
      }
    }

    connect()

    return () => {
      closed = true
      setConnected(false)
      if (retry) clearTimeout(retry)
      source?.close()
    }
  }, [enabled, add, clear, setConnected])
}
