import { useEffect } from 'react'
import { Popover, ActionIcon, Tooltip, Stack, Checkbox, Text, Indicator, Anchor } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconPlugConnected } from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import { useMCPServersStore } from '@/store/mcpServers'

interface MCPSelectorProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

// Per-conversation MCP server picker, shown in the chat header. Lets the user
// enable/disable which configured servers' tools are available in this chat.
export function MCPSelector({ selectedIds, onChange }: MCPSelectorProps) {
  const { servers, fetch } = useMCPServersStore()
  const [opened, { toggle, close }] = useDisclosure(false)
  const navigate = useNavigate()

  useEffect(() => { if (servers.length === 0) fetch() }, [fetch, servers.length])

  const enabledServers = servers.filter((s) => s.enabled)
  const activeCount = selectedIds.filter((id) => enabledServers.some((s) => s.id === id)).length

  function toggleServer(id: string, checked: boolean) {
    onChange(checked ? [...selectedIds, id] : selectedIds.filter((x) => x !== id))
  }

  return (
    <Popover opened={opened} onChange={(o) => !o && close()} position="bottom-end" withArrow shadow="md" width={260}>
      <Popover.Target>
        <Tooltip label="MCP tools" withArrow>
          <Indicator disabled={activeCount === 0} label={activeCount} size={16} color="violet">
            <ActionIcon
              variant={activeCount > 0 ? 'light' : 'subtle'}
              color={activeCount > 0 ? 'violet' : 'gray'}
              onClick={toggle}
              aria-label={activeCount > 0 ? `MCP tools — ${activeCount} active` : 'MCP tools'}
              aria-expanded={opened}
            >
              <IconPlugConnected size={16} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="xs" fw={600}>MCP servers (this chat)</Text>
          {enabledServers.length === 0 ? (
            <Text size="xs" c="dimmed">
              No enabled MCP servers.{' '}
              <Anchor size="xs" onClick={() => navigate('/settings?tab=mcp')}>Add one</Anchor>.
            </Text>
          ) : (
            enabledServers.map((s) => (
              <Checkbox
                key={s.id}
                size="xs"
                label={s.name}
                checked={selectedIds.includes(s.id)}
                onChange={(e) => toggleServer(s.id, e.currentTarget.checked)}
              />
            ))
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
