import { Select, Loader } from '@mantine/core'
import { useModels } from '@/hooks/useModels'

interface ModelSwitcherProps {
  value: string
  onChange: (model: string) => void
  group?: 'chat' | 'image'
  connectionId?: string | null
}

export function ModelSwitcher({ value, onChange, group = 'chat', connectionId }: ModelSwitcherProps) {
  const { grouped, loading, error } = useModels(connectionId)

  const models = group === 'chat' ? grouped.chat : grouped.image
  const data = models.map((m) => ({ value: m.id, label: m.id }))
  // Always keep the current value in the list so Mantine doesn't clear it while loading
  const dataWithCurrent =
    value && !data.find((d) => d.value === value)
      ? [{ value, label: value }, ...data]
      : data

  return (
    <Select
      data={dataWithCurrent}
      value={value || null}
      onChange={(v) => v && onChange(v)}
      placeholder={loading ? 'Loading models…' : error ? `Error: ${error}` : 'Select model'}
      rightSection={loading ? <Loader size="xs" /> : undefined}
      searchable
      size="xs"
      maw={260}
      styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
    />
  )
}
