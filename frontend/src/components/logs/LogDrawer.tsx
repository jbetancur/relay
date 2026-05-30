import { useMemo, useState } from 'react'
import {
  Drawer,
  Group,
  TextInput,
  Button,
  Badge,
  Text,
  Box,
  Chip,
  ScrollArea,
} from '@mantine/core'
import { IconSearch, IconTrash } from '@tabler/icons-react'
import { useLogsStore } from '@/store/logs'
import { useLogStream } from '@/hooks/useLogStream'
import type { LogEntry } from '@/types'
import classes from './LogDrawer.module.css'

interface LogDrawerProps {
  opened: boolean
  onClose: () => void
}

const LEVELS = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const
type LevelFilter = (typeof LEVELS)[number]

const LEVEL_COLOR: Record<string, string> = {
  ERROR: 'red',
  WARN: 'yellow',
  INFO: 'blue',
  DEBUG: 'gray',
}

export function LogDrawer({ opened, onClose }: LogDrawerProps) {
  // Stream only while the drawer is open.
  useLogStream(opened)
  const { entries, connected, clear } = useLogsStore()
  const [level, setLevel] = useState<LevelFilter>('ALL')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (level !== 'ALL' && e.level.toUpperCase() !== level) return false
      if (!q) return true
      const hay = (e.msg + ' ' + JSON.stringify(e.attrs ?? {})).toLowerCase()
      return hay.includes(q)
    })
  }, [entries, level, query])

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={600} size="sm">Logs</Text>
          <Badge size="xs" variant="dot" color={connected ? 'teal' : 'gray'}>
            {connected ? 'live' : 'disconnected'}
          </Badge>
          <Text size="xs" c="dimmed">{filtered.length} / {entries.length}</Text>
        </Group>
      }
      position="bottom"
      size="50%"
      padding="sm"
    >
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Chip.Group multiple={false} value={level} onChange={(v) => setLevel(v as LevelFilter)}>
          <Group gap={6}>
            {LEVELS.map((l) => (
              <Chip key={l} value={l} size="xs" variant="light">{l}</Chip>
            ))}
          </Group>
        </Chip.Group>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            size="xs"
            placeholder="Search…"
            leftSection={<IconSearch size={12} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={220}
          />
          <Button size="xs" variant="subtle" color="gray" leftSection={<IconTrash size={12} />} onClick={clear}>
            Clear
          </Button>
        </Group>
      </Group>

      <ScrollArea className={classes.scroll} type="auto">
        {filtered.length === 0 ? (
          <Text size="xs" c="dimmed" ta="center" py="xl">No log entries.</Text>
        ) : (
          filtered.map((e, i) => <LogRow key={i} entry={e} />)
        )}
      </ScrollArea>
    </Drawer>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  const level = entry.level.toUpperCase()
  const color = LEVEL_COLOR[level] ?? 'gray'
  const attrStr = entry.attrs && Object.keys(entry.attrs).length > 0
    ? Object.entries(entry.attrs).map(([k, v]) => `${k}=${format(v)}`).join('  ')
    : ''

  return (
    <Box className={classes.row} data-level={level}>
      <Text component="span" className={classes.time}>{time(entry.time)}</Text>
      <Badge size="xs" color={color} variant="light" radius="sm" className={classes.level}>
        {level}
      </Badge>
      <Text component="span" className={classes.msg}>{entry.msg}</Text>
      {attrStr && <Text component="span" className={classes.attrs}>{attrStr}</Text>}
    </Box>
  )
}

function time(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function format(v: unknown): string {
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}
