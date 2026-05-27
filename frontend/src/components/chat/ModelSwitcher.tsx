import { Select, Loader } from '@mantine/core'
import { useModels } from '@/hooks/useModels'

interface ModelSwitcherProps {
  value: string
  onChange: (model: string) => void
  group?: 'chat' | 'image'
  connectionId?: string | null
}

export function ModelSwitcher({ value, onChange, group = 'chat', connectionId }: ModelSwitcherProps) {
  const { grouped, loading } = useModels(connectionId)

  const models = group === 'chat' ? grouped.chat : grouped.image
  const data = models.map((m) => ({ value: m.id, label: m.id }))

  return (
    <Select
      data={data}
      value={value || null}
      onChange={(v) => v && onChange(v)}
      placeholder={loading ? 'Loading models…' : 'Select model'}
      rightSection={loading ? <Loader size="xs" /> : undefined}
      searchable
      size="xs"
      maw={260}
      styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
    />
  )
}
