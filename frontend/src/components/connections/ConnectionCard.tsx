import { useState } from 'react'
import {
  Card,
  Group,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  Stack,
  Switch,
} from '@mantine/core'
import { IconPencil, IconTrash, IconPlugConnected } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import type { Connection } from '@/types'

const TYPE_COLORS: Record<string, string> = {
  openai: 'teal',
  ollama: 'orange',
  anthropic: 'violet',
  custom: 'gray',
}

const TYPE_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  ollama: 'Ollama',
  anthropic: 'Anthropic',
  custom: 'Custom',
}

interface ConnectionCardProps {
  connection: Connection
  onEdit: (connection: Connection) => void
  onDelete: (id: string) => void
  onToggleEnabled: (id: string, enabled: boolean) => void
}

export function ConnectionCard({
  connection,
  onEdit,
  onDelete,
  onToggleEnabled,
}: ConnectionCardProps) {
  const [testing, setTesting] = useState(false)

  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch(`/api/connections/${connection.id}/models`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data = await res.json()
      const count = data?.data?.length ?? 0
      notifications.show({
        color: 'teal',
        title: 'Connection OK',
        message: `${count} model${count !== 1 ? 's' : ''} discovered`,
      })
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Connection failed',
        message: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card withBorder radius="md" padding="sm">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs">
            <Text fw={600} size="sm" truncate>
              {connection.name}
            </Text>
            {connection.isDefault && (
              <Badge size="xs" variant="light" color="violet">
                default
              </Badge>
            )}
            <Badge
              size="xs"
              variant="light"
              color={TYPE_COLORS[connection.typeHint] ?? 'gray'}
            >
              {TYPE_LABELS[connection.typeHint] ?? connection.typeHint}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" truncate>
            {connection.baseUrl}
          </Text>
        </Stack>

        <Group gap="xs" style={{ flexShrink: 0 }}>
          <Switch
            size="xs"
            checked={connection.enabled}
            onChange={(e) => onToggleEnabled(connection.id, e.currentTarget.checked)}
          />
          <Tooltip label="Test connection">
            <ActionIcon
              variant="subtle"
              size="sm"
              loading={testing}
              onClick={handleTest}
            >
              <IconPlugConnected size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Edit">
            <ActionIcon variant="subtle" size="sm" onClick={() => onEdit(connection)}>
              <IconPencil size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Delete">
            <ActionIcon
              variant="subtle"
              size="sm"
              color="red"
              onClick={() => onDelete(connection.id)}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Card>
  )
}
