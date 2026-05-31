import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useConversationStore, useConnectionsStore, useSettingsStore } from '@/store'

export function useKeyboardShortcuts(toggleSidebar: () => void, toggleLogs: () => void) {
  const navigate = useNavigate()
  const { createConversation, setConnection } = useConversationStore()
  const { getDefault } = useConnectionsStore()
  const { settings } = useSettingsStore()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey

      // Cmd/Ctrl+K — new chat
      if (mod && e.key === 'k') {
        e.preventDefault()
        const conv = createConversation(settings.defaultChatModel)
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

      // Cmd/Ctrl+` — toggle log drawer
      if (mod && e.key === '`') {
        e.preventDefault()
        toggleLogs()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate, toggleSidebar, toggleLogs, createConversation, setConnection, getDefault, settings.defaultChatModel])
}
