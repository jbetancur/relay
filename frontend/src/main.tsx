import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import { BrowserRouter } from 'react-router'

import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'

import App from './App'
import { useSettingsStore, useConnectionsStore } from './store'
import { theme, mochaCssVars } from './theme'

function Root() {
  const { settings } = useSettingsStore()

  useEffect(() => {
    useConnectionsStore.getState().fetch()
  }, [])

  // Inject Catppuccin Mocha CSS vars — always dark for chat/code blocks
  useEffect(() => {
    const style = document.getElementById('ctp-vars') ?? (() => {
      const el = document.createElement('style')
      el.id = 'ctp-vars'
      document.head.appendChild(el)
      return el
    })()
    style.textContent = `:root { ${mochaCssVars} }`
  }, [])


  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme="dark"
      forceColorScheme={settings.theme === 'auto' ? undefined : settings.theme}
    >
      <ModalsProvider>
        <Notifications position="top-right" />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ModalsProvider>
    </MantineProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
