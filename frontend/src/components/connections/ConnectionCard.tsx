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
  Divider,
  SimpleGrid,
} from '@mantine/core'
import { IconPencil, IconTrash, IconPlugConnected, IconRefresh } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import type { Connection } from '@/types'
import { useConnectionStats } from '@/hooks/useConnectionStats'

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

// Blended estimate: ~$1.50/1M prompt + $2.00/1M completion (approximate GPT-3.5 tier)
const PROMPT_COST_PER_TOKEN = 1.5 / 1_000_000
const COMPLETION_COST_PER_TOKEN = 2.0 / 1_000_000

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function estimateCost(promptTokens: number, completionTokens: number): string {
  const cost = promptTokens * PROMPT_COST_PER_TOKEN + completionTokens * COMPLETION_COST_PER_TOKEN
  if (cost < 0.001) return '<$0.001'
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

interface StatCellProps {
  label: string
  value: string
}

function StatCell({ label, value }: StatCellProps) {
  return (
    <Stack gap={1}>
      <Text size="xs" c="dimmed" lh={1.2}>
        {label}
      </Text>
      <Text size="xs" fw={600} lh={1.2}>
        {value}
      </Text>
    </Stack>
  )
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
  const { stats, loading: statsLoading, refresh, reset } = useConnectionStats(connection.id)

  const hasStats = stats !== null && stats.requestCount > 0

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

  async function handleReset() {
    await reset()
    notifications.show({
      color: 'gray',
      title: 'Stats cleared',
      message: `Usage stats for ${connection.name} have been reset`,
    })
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

      {/* Usage stats */}
      {!statsLoading && (
        <>
          <Divider my="xs" />
          {hasStats ? (
            <Group justify="space-between" align="flex-end">
              <SimpleGrid cols={4} spacing="xs" style={{ flex: 1 }}>
                <StatCell label="Requests" value={String(stats.requestCount)} />
                <StatCell label="Prompt tkns" value={formatTokens(stats.promptTokens)} />
                <StatCell label="Completion tkns" value={formatTokens(stats.completionTokens)} />
                <StatCell
                  label="Est. cost~"
                  value={estimateCost(stats.promptTokens, stats.completionTokens)}
                />
              </SimpleGrid>
              <Group gap={4} style={{ flexShrink: 0 }}>
                <Tooltip label="Refresh stats">
                  <ActionIcon variant="subtle" size="xs" color="gray" onClick={refresh}>
                    <IconRefresh size={11} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Reset stats">
                  <ActionIcon variant="subtle" size="xs" color="red" onClick={handleReset}>
                    <IconTrash size={11} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          ) : (
            <Text size="xs" c="dimmed">
              No usage recorded yet
            </Text>
          )}
        </>
      )}
    </Card>
  )
}
