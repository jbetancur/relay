import {
  Stack,
  Group,
  Text,
  Button,
  TextInput,
  ScrollArea,
  Divider,
  ActionIcon,
  Tooltip,
  Box,
} from '@mantine/core'
import {
  IconPlus,
  IconSearch,
  IconPhoto,
  IconSettings,
  IconLayoutSidebarLeftCollapse,
  IconAccessPoint,
  IconTerminal2,
  IconArchive,
} from '@tabler/icons-react'
import { useNavigate, useParams } from 'react-router'
import { useState } from 'react'

import { useConversationStore, useSettingsStore } from '@/store'
import { ConversationList } from './ConversationList'

interface SidebarProps {
  onToggle: () => void
  onToggleLogs: () => void
}

export function Sidebar({ onToggle, onToggleLogs }: SidebarProps) {
  const navigate = useNavigate()
  const { id } = useParams()
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const { createConversation } = useConversationStore()
  const { settings } = useSettingsStore()

  function handleNew() {
    const conv = createConversation(settings.defaultChatModel)
    navigate(`/c/${conv.id}`)
  }

  return (
    <Stack h="100%" gap={0} style={{ overflow: 'hidden' }}>
      {/* Header */}
      <Group px="sm" py="xs" justify="space-between" style={{ flexShrink: 0 }}>
        <Group gap="xs">
          <IconAccessPoint size={20} color="var(--mantine-color-violet-4)" style={{ filter: 'drop-shadow(0 0 6px var(--mantine-color-violet-5))' }} />
          <Text
            fw={700}
            size="lg"
            style={{
              background: 'linear-gradient(90deg, var(--mantine-color-violet-3), var(--mantine-color-blue-3))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Relay
          </Text>
        </Group>
        <Tooltip label="Collapse sidebar">
          <ActionIcon variant="subtle" onClick={onToggle} aria-label="Collapse sidebar">
            <IconLayoutSidebarLeftCollapse size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Box px="sm" pb="xs" style={{ flexShrink: 0 }}>
        <Button
          leftSection={<IconPlus size={16} />}
          fullWidth
          variant="light"
          onClick={handleNew}
        >
          New chat
        </Button>
      </Box>

      <Box px="sm" pb="xs" style={{ flexShrink: 0 }}>
        <Group gap={6} wrap="nowrap">
          <TextInput
            placeholder="Search title or messages..."
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            size="xs"
            flex={1}
          />
          <Tooltip label={showArchived ? 'Show active' : 'Show archived'}>
            <ActionIcon
              variant={showArchived ? 'light' : 'subtle'}
              color={showArchived ? 'violet' : 'gray'}
              onClick={() => setShowArchived((v) => !v)}
              aria-label={showArchived ? 'Show active conversations' : 'Show archived conversations'}
            >
              <IconArchive size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>

      <ScrollArea flex={1} px="sm">
        <ConversationList search={search} activeId={id} showArchived={showArchived} />
      </ScrollArea>

      <Divider />

      {/* Bottom nav */}
      <Stack gap={0} p="xs" style={{ flexShrink: 0 }}>
        <Button
          variant="subtle"
          justify="start"
          leftSection={<IconPhoto size={16} />}
          onClick={() => navigate('/images')}
          fullWidth
        >
          Image generation
        </Button>
        <Button
          variant="subtle"
          justify="start"
          leftSection={<IconTerminal2 size={16} />}
          onClick={onToggleLogs}
          fullWidth
        >
          Logs
        </Button>
        <Button
          variant="subtle"
          justify="start"
          leftSection={<IconSettings size={16} />}
          onClick={() => navigate('/settings')}
          fullWidth
        >
          Settings
        </Button>
      </Stack>
    </Stack>
  )
}
