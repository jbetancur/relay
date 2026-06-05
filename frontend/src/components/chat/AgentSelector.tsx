import { useEffect } from 'react'
import { Popover, ActionIcon, Tooltip, Stack, Text, Indicator, Anchor, Radio } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconRobot } from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import { useAgentsStore } from '@/store/agents'

interface AgentSelectorProps {
  selectedId: string | undefined
  onChange: (id: string | undefined) => void
}

export function AgentSelector({ selectedId, onChange }: AgentSelectorProps) {
  const { agents, fetch } = useAgentsStore()
  const [opened, { toggle, close }] = useDisclosure(false)
  const navigate = useNavigate()

  useEffect(() => { if (agents.length === 0) fetch() }, [fetch, agents.length])

  const enabledAgents = agents.filter((a) => a.enabled)
  const active = enabledAgents.find((a) => a.id === selectedId)

  function select(id: string | undefined) {
    onChange(id)
    close()
  }

  return (
    <Popover opened={opened} onChange={(o) => !o && close()} position="bottom-end" withArrow shadow="md" width={240}>
      <Popover.Target>
        <Tooltip label={active ? `Agent: ${active.name}` : 'Agent'} withArrow>
          <Indicator disabled={!active} size={8} color="violet" offset={4}>
            <ActionIcon
              variant={active ? 'light' : 'subtle'}
              color={active ? 'violet' : 'gray'}
              onClick={toggle}
              aria-label={active ? `Agent: ${active.name}` : 'No agent selected'}
              aria-expanded={opened}
            >
              <IconRobot size={16} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="xs" fw={600}>Agent (this chat)</Text>

          {enabledAgents.length === 0 ? (
            <Text size="xs" c="dimmed">
              No agents yet.{' '}
              <Anchor size="xs" onClick={() => navigate('/settings?tab=agents')}>Create one</Anchor>.
            </Text>
          ) : (
            <>
              <Radio
                size="xs"
                label={<Text size="xs" c="dimmed">None (plain model)</Text>}
                checked={!selectedId}
                onChange={() => select(undefined)}
              />
              {enabledAgents.map((a) => (
                <Radio
                  key={a.id}
                  size="xs"
                  label={
                    <Stack gap={0}>
                      <Text size="xs">{a.name}</Text>
                      <Text size="xs" c="dimmed">{a.model}</Text>
                    </Stack>
                  }
                  checked={selectedId === a.id}
                  onChange={() => select(a.id)}
                />
              ))}
            </>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
