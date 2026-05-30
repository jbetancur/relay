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
} from '@tabler/icons-react'
import { useNavigate, useParams } from 'react-router'
import { useState } from 'react'

import { useConversationStore } from '@/store'
import { ConversationList } from './ConversationList'

interface SidebarProps {
  onToggle: () => void
  onToggleLogs: () => void
}

export function Sidebar({ onToggle, onToggleLogs }: SidebarProps) {
  const navigate = useNavigate()
  const { id } = useParams()
  const [search, setSearch] = useState('')
  const { createConversation } = useConversationStore()

  function handleNew() {
    const conv = createConversation()
    navigate(`/c/${conv.id}`)
  }

  return (
    <Stack h="100%" gap={0} style={{ overflow: 'hidden' }}>
      {/* Header */}
      <Group px="sm" py="xs" justify="space-between" style={{ flexShrink: 0 }}>
        <Group gap="xs">
          <IconAccessPoint size={20} color="var(--mantine-color-violet-4)" />
          <Text fw={700} size="lg">Relay</Text>
        </Group>
        <Tooltip label="Collapse sidebar">
          <ActionIcon variant="subtle" onClick={onToggle}>
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
        <TextInput
          placeholder="Search conversations..."
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          size="xs"
        />
      </Box>

      <ScrollArea flex={1} px="sm">
        <ConversationList search={search} activeId={id} />
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
