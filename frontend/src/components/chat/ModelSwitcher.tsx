import { useState } from 'react'
import { Select, Loader, Switch, Group } from '@mantine/core'
import { useModels } from '@/hooks/useModels'
import { useRecentModelsStore } from '@/store'

interface ModelSwitcherProps {
  value: string
  onChange: (model: string) => void
  group?: 'chat' | 'image'
  connectionId?: string | null
}

interface SelectGroup {
  group: string
  items: { value: string; label: string }[]
}

export function ModelSwitcher({ value, onChange, group = 'chat', connectionId }: ModelSwitcherProps) {
  const { grouped, variants, loading, error } = useModels(connectionId)
  const { recentModels, recordModel } = useRecentModelsStore()
  const [showAllVersions, setShowAllVersions] = useState(false)

  const models = group === 'chat' ? grouped.chat : grouped.image
  const ids = models.map((m) => m.id)

  // Image group: short list, no recents/collapse treatment.
  if (group === 'image') {
    return (
      <BasicSelect
        data={ids.map((id) => ({ value: id, label: id }))}
        value={value}
        onChange={onChange}
        loading={loading}
        error={error}
      />
    )
  }

  // Collapsed view: one entry per base id; expanded: every variant.
  const bases = [...variants.keys()].sort()
  const hasCollapsedVariants = [...variants.values()].some((v) => v.length > 1)
  const modelItems = showAllVersions
    ? ids.map((id) => ({ value: id, label: id }))
    : bases.map((base) => {
        // When a base has exactly one model with a different id, show the real id.
        const vs = variants.get(base)!
        const id = vs.length === 1 ? vs[0].id : base
        return { value: id, label: id }
      })

  const recents = (connectionId ? recentModels[connectionId] ?? [] : [])
    .filter((m) => ids.includes(m))
    .slice(0, 5)

  const data: SelectGroup[] = []
  if (recents.length > 0) {
    data.push({ group: 'Recent', items: recents.map((id) => ({ value: id, label: id })) })
  }
  data.push({ group: 'Models', items: modelItems })

  // Always keep the current value selectable even if collapsed/filtered out.
  if (value && !modelItems.find((i) => i.value === value) && !recents.includes(value)) {
    data.unshift({ group: 'Current', items: [{ value, label: value }] })
  }

  const handleChange = (v: string | null) => {
    if (!v) return
    onChange(v)
    if (connectionId) recordModel(connectionId, v)
  }

  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <Select
        data={data}
        value={value || null}
        onChange={handleChange}
        placeholder={loading ? 'Loading models…' : error ? `Error: ${error}` : 'Select model'}
        rightSection={loading ? <Loader size="xs" /> : undefined}
        searchable
        size="xs"
        maw={260}
        styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
      />
      {hasCollapsedVariants && (
        <Switch
          size="xs"
          label="Show all versions"
          checked={showAllVersions}
          onChange={(e) => setShowAllVersions(e.currentTarget.checked)}
          styles={{ label: { fontSize: 11 } }}
        />
      )}
    </Group>
  )
}

function BasicSelect({
  data,
  value,
  onChange,
  loading,
  error,
}: {
  data: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  loading: boolean
  error: string | null
}) {
  const dataWithCurrent =
    value && !data.find((d) => d.value === value) ? [{ value, label: value }, ...data] : data
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
