import { useState, useRef, useEffect } from 'react'
import { Stack, Group, Text, ActionIcon, Menu, UnstyledButton, TextInput } from '@mantine/core'
import { IconDots, IconPencil, IconTrash } from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import { useConversationStore } from '@/store'
import type { Conversation } from '@/types'

interface ConversationListProps {
  search: string
  activeId?: string
}

export function ConversationList({ search, activeId }: ConversationListProps) {
  const { conversations, deleteConversation, renameConversation } = useConversationStore()
  const navigate = useNavigate()

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  )

  if (filtered.length === 0) {
    return (
      <Text size="xs" c="dimmed" ta="center" py="md">
        No conversations
      </Text>
    )
  }

  return (
    <Stack gap={2}>
      {filtered.map((conv) => (
        <ConversationItem
          key={conv.id}
          conversation={conv}
          isActive={conv.id === activeId}
          onSelect={() => navigate(`/c/${conv.id}`)}
          onDelete={() => {
            deleteConversation(conv.id)
            if (conv.id === activeId) navigate('/c/new')
          }}
          onRename={(title) => renameConversation(conv.id, title)}
        />
      ))}
    </Stack>
  )
}

interface ConversationItemProps {
  conversation: Conversation
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: ConversationItemProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(conversation.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(conversation.title)
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [editing, conversation.title])

  function commitRename() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== conversation.title) onRename(trimmed)
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <Group
      gap={0}
      style={(theme) => ({
        borderRadius: theme.radius.md,
        backgroundColor: isActive
          ? 'color-mix(in srgb, var(--mantine-color-violet-filled) 20%, transparent)'
          : 'transparent',
      })}
    >
      {editing ? (
        <TextInput
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitRename}
          size="xs"
          flex={1}
          mx={4}
          my={2}
          styles={{ input: { padding: '4px 8px' } }}
        />
      ) : (
        <UnstyledButton
          flex={1}
          px="sm"
          py={6}
          onClick={onSelect}
          onDoubleClick={() => setEditing(true)}
          style={{ minWidth: 0 }}
        >
          <Text size="sm" truncate>
            {conversation.title}
          </Text>
          <Text size="xs" c="dimmed">
            {new Date(conversation.updatedAt).toLocaleDateString()}
          </Text>
        </UnstyledButton>
      )}

      {!editing && (
        <Menu shadow="md" width={160} position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="subtle" size="sm" mr={4}>
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconPencil size={14} />}
              onClick={() => setEditing(true)}
            >
              Rename
            </Menu.Item>
            <Menu.Item
              leftSection={<IconTrash size={14} />}
              color="red"
              onClick={onDelete}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  )
}
