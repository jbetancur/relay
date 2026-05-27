import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useConversationStore, useConnectionsStore } from '@/store'

export function useKeyboardShortcuts(toggleSidebar: () => void) {
  const navigate = useNavigate()
  const { createConversation, setConnection } = useConversationStore()
  const { getDefault } = useConnectionsStore()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey

      // Cmd/Ctrl+K — new chat
      if (mod && e.key === 'k') {
        e.preventDefault()
        const conv = createConversation()
        const defaultConn = getDefault()
        if (defaultConn) setConnection(conv.id, defaultConn.id)
        navigate(`/c/${conv.id}`)
        return
      }

      // Cmd/Ctrl+/ — toggle sidebar
      if (mod && e.key === '/') {
        e.preventDefault()
        toggleSidebar()
        return
      }

      // Cmd/Ctrl+, — settings
      if (mod && e.key === ',') {
        e.preventDefault()
        navigate('/settings')
        return
      }

      // Cmd/Ctrl+Shift+I — image generation
      if (mod && e.shiftKey && e.key === 'I') {
        e.preventDefault()
        navigate('/images')
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate, toggleSidebar, createConversation, setConnection, getDefault])
}
