import { useState } from 'react'
import {
  Stack,
  Button,
  Modal,
  Text,
  Alert,
  Skeleton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { openConfirmModal } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconAlertCircle } from '@tabler/icons-react'

import { useConnectionsStore } from '@/store'
import { ConnectionCard } from './ConnectionCard'
import { ConnectionForm } from './ConnectionForm'
import type { Connection, ConnectionInput } from '@/types'

export function ConnectionsTab() {
  const { connections, loading, error, create, update, remove } = useConnectionsStore()
  const [modalOpen, { open, close }] = useDisclosure(false)
  const [editTarget, setEditTarget] = useState<Connection | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(input: ConnectionInput) {
    setSaving(true)
    try {
      if (editTarget) {
        await update(editTarget.id, input)
        notifications.show({ message: 'Connection updated', color: 'teal' })
      } else {
        await create(input)
        notifications.show({ message: 'Connection added', color: 'teal' })
      }
      close()
      setEditTarget(null)
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Error',
        message: e instanceof Error ? e.message : 'Failed to save',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(conn: Connection) {
    // Fetch full connection (with apiKey) for pre-filling the form
    try {
      const res = await fetch(`/api/connections/${conn.id}`)
      if (!res.ok) throw new Error(`${res.status}`)
      const full: Connection = await res.json()
      setEditTarget(full)
    } catch {
      setEditTarget(conn)
    }
    open()
  }

  function handleDelete(id: string) {
    openConfirmModal({
      title: 'Delete connection',
      children: <Text size="sm">This will permanently delete this connection. Conversations using it will fall back to the default.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await remove(id)
          notifications.show({ message: 'Connection deleted', color: 'teal' })
        } catch (e) {
          notifications.show({
            color: 'red',
            title: 'Error',
            message: e instanceof Error ? e.message : 'Failed to delete',
          })
        }
      },
    })
  }

  async function handleToggleEnabled(id: string, enabled: boolean) {
    const conn = connections.find((c) => c.id === id)
    if (!conn) return
    try {
      // Fetch the full connection to get the stored apiKey before updating,
      // since the list response omits it for security.
      const res = await fetch(`/api/connections/${id}`)
      const full: Connection = res.ok ? await res.json() : conn
      await update(id, {
        name: full.name,
        baseUrl: full.baseUrl,
        apiKey: full.apiKey ?? '',
        typeHint: full.typeHint,
        enabled,
        isDefault: full.isDefault,
      })
    } catch (e) {
      notifications.show({
        color: 'red',
        message: e instanceof Error ? e.message : 'Failed to update',
      })
    }
  }

  return (
    <>
      <Stack gap="sm">
        <Button
          leftSection={<IconPlus size={16} />}
          variant="light"
          onClick={() => { setEditTarget(null); open() }}
          style={{ alignSelf: 'flex-start' }}
        >
          Add connection
        </Button>

        {error && (
          <Alert icon={<IconAlertCircle size={14} />} color="red">
            {error}
          </Alert>
        )}

        {loading ? (
          <>
            <Skeleton height={64} radius="md" />
            <Skeleton height={64} radius="md" />
          </>
        ) : connections.length === 0 ? (
          <Text size="sm" c="dimmed">
            No connections configured. Add one to get started.
          </Text>
        ) : (
          connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              connection={conn}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleEnabled={handleToggleEnabled}
            />
          ))
        )}
      </Stack>

      <Modal
        opened={modalOpen}
        onClose={() => { close(); setEditTarget(null) }}
        title={editTarget ? 'Edit connection' : 'Add connection'}
        size="md"
      >
        <ConnectionForm
          initial={editTarget ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => { close(); setEditTarget(null) }}
          loading={saving}
        />
      </Modal>
    </>
  )
}
