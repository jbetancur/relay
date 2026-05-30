import { useEffect, useState } from 'react'
import {
  Stack,
  Button,
  Modal,
  Text,
  Alert,
  Group,
  TextInput,
  Switch,
  ActionIcon,
  Tooltip,
  Card,
  Badge,
  Textarea,
  Divider,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { openConfirmModal } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconAlertCircle, IconTrash, IconPencil, IconCheck, IconPlugConnected } from '@tabler/icons-react'
import { useMCPServersStore } from '@/store/mcpServers'
import type { MCPServer, MCPServerInput } from '@/types'

const EMPTY: MCPServerInput = { name: '', url: '', headers: {}, enabled: true }

export function MCPTab() {
  const { servers, loading, error, fetch, create, update, remove } = useMCPServersStore()
  const [modalOpen, { open, close }] = useDisclosure(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [initial, setInitial] = useState<MCPServerInput>(EMPTY)

  useEffect(() => { fetch() }, [fetch])

  async function openAdd() {
    setEditId(null)
    setInitial(EMPTY)
    open()
  }

  async function openEdit(server: MCPServer) {
    try {
      const full = await useMCPServersStore.getState().getFull(server.id)
      setInitial({ name: full.name, url: full.url, headers: full.headers ?? {}, enabled: full.enabled })
    } catch {
      setInitial({ name: server.name, url: server.url, headers: {}, enabled: server.enabled })
    }
    setEditId(server.id)
    open()
  }

  async function handleSubmit(input: MCPServerInput) {
    try {
      if (editId) {
        await update(editId, input)
        notifications.show({ message: 'MCP server updated', color: 'teal' })
      } else {
        await create(input)
        notifications.show({ message: 'MCP server added', color: 'teal' })
      }
      close()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Error', message: e instanceof Error ? e.message : 'Failed to save' })
    }
  }

  function handleDelete(id: string) {
    openConfirmModal({
      title: 'Delete MCP server',
      children: <Text size="sm">This removes the server. Conversations using it will lose its tools.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove(id).catch((e) =>
        notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Failed to delete' })),
    })
  }

  return (
    <>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Connect remote MCP servers (Streamable HTTP). Their tools become available in chats where you enable the server.
        </Text>

        <Button leftSection={<IconPlus size={16} />} variant="light" onClick={openAdd} style={{ alignSelf: 'flex-start' }}>
          Add MCP server
        </Button>

        {error && <Alert icon={<IconAlertCircle size={14} />} color="red">{error}</Alert>}

        {!loading && servers.length === 0 ? (
          <Text size="sm" c="dimmed">No MCP servers configured.</Text>
        ) : (
          servers.map((s) => (
            <Card key={s.id} withBorder padding="sm">
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap="xs">
                    <Text fw={500} size="sm">{s.name}</Text>
                    {!s.enabled && <Badge size="xs" color="gray" variant="light">disabled</Badge>}
                  </Group>
                  <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.url}
                  </Text>
                </Stack>
                <Group gap={4} wrap="nowrap">
                  <Tooltip label="Edit"><ActionIcon variant="subtle" onClick={() => openEdit(s)}><IconPencil size={15} /></ActionIcon></Tooltip>
                  <Tooltip label="Delete"><ActionIcon variant="subtle" color="red" onClick={() => handleDelete(s.id)}><IconTrash size={15} /></ActionIcon></Tooltip>
                </Group>
              </Group>
            </Card>
          ))
        )}
      </Stack>

      <Modal opened={modalOpen} onClose={close} title={editId ? 'Edit MCP server' : 'Add MCP server'} size="md">
        <MCPForm initial={initial} onSubmit={handleSubmit} onCancel={close} />
      </Modal>
    </>
  )
}

type TestState = { ok: true; count: number } | { ok: false; message: string } | null

function MCPForm({ initial, onSubmit, onCancel }: {
  initial: MCPServerInput
  onSubmit: (input: MCPServerInput) => Promise<void>
  onCancel: () => void
}) {
  const { test } = useMCPServersStore()
  const [name, setName] = useState(initial.name)
  const [url, setUrl] = useState(initial.url)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [headersText, setHeadersText] = useState(
    Object.keys(initial.headers).length ? JSON.stringify(initial.headers, null, 2) : ''
  )
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestState>(null)
  const [saving, setSaving] = useState(false)
  const [headerError, setHeaderError] = useState<string | null>(null)

  function parseHeaders(): Record<string, string> | null {
    if (!headersText.trim()) return {}
    try {
      const h = JSON.parse(headersText)
      if (h && typeof h === 'object' && !Array.isArray(h)) return h
      throw new Error()
    } catch {
      setHeaderError('Headers must be a JSON object')
      return null
    }
  }

  function buildInput(): MCPServerInput | null {
    setHeaderError(null)
    const headers = parseHeaders()
    if (headers === null) return null
    return { name: name.trim(), url: url.trim(), headers, enabled }
  }

  // Parse a Claude-Desktop-style mcpServers JSON block into the form.
  function applyImport() {
    try {
      const parsed = JSON.parse(importText)
      const root = parsed.mcpServers ?? parsed
      const firstKey = Object.keys(root)[0]
      const entry = root[firstKey]
      if (!entry?.url) throw new Error('expected a "url" field')
      setName((prev) => prev || firstKey)
      setUrl(entry.url)
      if (entry.headers) setHeadersText(JSON.stringify(entry.headers, null, 2))
      setShowImport(false)
      setImportText('')
      notifications.show({ message: 'Imported from JSON', color: 'teal' })
    } catch (e) {
      notifications.show({ color: 'red', message: `Invalid mcpServers JSON: ${e instanceof Error ? e.message : ''}` })
    }
  }

  async function handleTest() {
    const input = buildInput()
    if (!input) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await test(input)
      if (res.ok) setTestResult({ ok: true, count: res.toolCount })
      else setTestResult({ ok: false, message: res.error })
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    const input = buildInput()
    if (!input) return
    setSaving(true)
    try {
      await onSubmit(input)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Enter fields manually, or import a standard mcpServers JSON block.</Text>
        <Button size="compact-xs" variant="subtle" onClick={() => setShowImport((v) => !v)}>
          {showImport ? 'Hide import' : 'Import JSON'}
        </Button>
      </Group>

      {showImport && (
        <Stack gap={4}>
          <Textarea
            placeholder={'{\n  "my-server": {\n    "url": "https://…/mcp",\n    "headers": { "Authorization": "Bearer …" }\n  }\n}'}
            value={importText}
            onChange={(e) => setImportText(e.currentTarget.value)}
            autosize minRows={4} maxRows={10}
            styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
          />
          <Button size="xs" variant="light" onClick={applyImport} disabled={!importText.trim()} style={{ alignSelf: 'flex-start' }}>
            Apply
          </Button>
          <Divider my="xs" />
        </Stack>
      )}

      <TextInput label="Name" required value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="my-server" />
      <TextInput label="URL" required value={url} onChange={(e) => setUrl(e.currentTarget.value)} placeholder="https://…/mcp" description="Streamable HTTP MCP endpoint" />
      <Textarea
        label="Headers (JSON, optional)"
        value={headersText}
        onChange={(e) => setHeadersText(e.currentTarget.value)}
        placeholder={'{ "Authorization": "Bearer …" }'}
        autosize minRows={2} maxRows={6}
        error={headerError}
        styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
      />
      <Switch label="Enabled" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />

      {testResult && (
        <Alert
          color={testResult.ok ? 'teal' : 'red'}
          icon={testResult.ok ? <IconCheck size={14} /> : <IconAlertCircle size={14} />}
          py="xs"
        >
          {testResult.ok ? `Connected — ${testResult.count} tool${testResult.count === 1 ? '' : 's'} available.` : testResult.message}
        </Alert>
      )}

      <Group justify="space-between" mt="xs">
        <Button variant="default" leftSection={<IconPlugConnected size={14} />} onClick={handleTest} loading={testing} disabled={!url.trim()}>
          Test
        </Button>
        <Group>
          <Button variant="subtle" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={!name.trim() || !url.trim()}>Save</Button>
        </Group>
      </Group>
    </Stack>
  )
}
