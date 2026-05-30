import { AppShell } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Routes, Route, Navigate } from 'react-router'

import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatPage } from '@/pages/ChatPage'
import { ImagePage } from '@/pages/ImagePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { LogDrawer } from '@/components/logs/LogDrawer'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'

export default function App() {
  const [sidebarOpen, { toggle: toggleSidebar }] = useDisclosure(true)
  const [logsOpen, { toggle: toggleLogs, close: closeLogs }] = useDisclosure(false)

  useKeyboardShortcuts(toggleSidebar, toggleLogs)

  return (
    <AppShell
      navbar={{
        width: 260,
        breakpoint: 'sm',
        collapsed: { mobile: !sidebarOpen, desktop: !sidebarOpen },
      }}
      padding={0}
    >
      <AppShell.Navbar>
        <Sidebar onToggle={toggleSidebar} onToggleLogs={toggleLogs} />
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Navigate to="/c/new" replace />} />
          <Route path="/c/:id" element={<ChatPage onToggleSidebar={toggleSidebar} />} />
          <Route path="/images" element={<ImagePage onToggleSidebar={toggleSidebar} />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppShell.Main>

      <LogDrawer opened={logsOpen} onClose={closeLogs} />
    </AppShell>
  )
}
