import { Group, Select, Stack, Text } from '@mantine/core'
import { useConnectionsStore } from '@/store'
import { ModelSwitcher } from '@/components/chat/ModelSwitcher'
import type { RouteSlot } from '@/types'

interface SlotPickerProps {
  label: string
  hint?: string
  value: RouteSlot | undefined
  onChange: (slot: RouteSlot | undefined) => void
}

// One routing category: pick a connection, then a model from it. Clearing the
// model clears the whole slot (treated as "not configured").
export function SlotPicker({ label, hint, value, onChange }: SlotPickerProps) {
  const { connections, getDefault } = useConnectionsStore()
  const enabled = connections.filter((c) => c.enabled)

  // null connectionId means "use the conversation's connection" — resolve a
  // concrete one for the model dropdown so we can list models to pick from.
  const effectiveConnId = value?.connectionId ?? getDefault()?.id ?? null

  const connData = enabled.map((c) => ({ value: c.id, label: c.name }))

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{label}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
      <Group grow align="flex-start" gap="xs">
        <Select
          data={connData}
          value={effectiveConnId}
          onChange={(connId) =>
            onChange({ model: value?.model ?? '', connectionId: connId })
          }
          placeholder="Connection"
          size="xs"
          searchable
        />
        <ModelSwitcher
          value={value?.model ?? ''}
          onChange={(model) =>
            model
              ? onChange({ model, connectionId: value?.connectionId ?? effectiveConnId })
              : onChange(undefined)
          }
          group="chat"
          connectionId={effectiveConnId}
        />
      </Group>
    </Stack>
  )
}
