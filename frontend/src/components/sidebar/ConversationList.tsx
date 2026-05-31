import { useState, useRef, useEffect, useMemo } from 'react'
import { Stack, Group, Text, ActionIcon, Menu, UnstyledButton, TextInput } from '@mantine/core'
import {
  IconDots, IconPencil, IconTrash, IconPin, IconPinnedOff, IconArchive, IconArchiveOff,
} from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import { useConversationStore } from '@/store'
import { messageText } from '@/hooks/useTokenCount'
import type { Conversation } from '@/types'

interface ConversationListProps {
  search: string
  activeId?: string
  showArchived?: boolean
}

interface Match {
  conversation: Conversation
  snippet?: string // context around a message-content hit, when the title didn't match
}

// Find a search hit in message contents and return a short snippet around it.
function messageSnippet(conv: Conversation, q: string): string | undefined {
  for (const m of conv.messages) {
    const text = messageText(m.content)
    const idx = text.toLowerCase().indexOf(q)
    if (idx !== -1) {
      const start = Math.max(0, idx - 24)
      const end = Math.min(text.length, idx + q.length + 32)
      return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
    }
  }
  return undefined
}

export function ConversationList({ search, activeId, showArchived = false }: ConversationListProps) {
  const { conversations, deleteConversation, renameConversation, togglePinned, toggleArchived } =
    useConversationStore()
  const navigate = useNavigate()

  const matches = useMemo<Match[]>(() => {
    const q = search.trim().toLowerCase()
    const out: Match[] = []
    for (const c of conversations) {
      if (!!c.archived !== showArchived) continue
      if (!q) {
        out.push({ conversation: c })
        continue
      }
      if (c.title.toLowerCase().includes(q)) {
        out.push({ conversation: c })
        continue
      }
      // Title didn't match — search message contents and attach a snippet.
      const snippet = messageSnippet(c, q)
      if (snippet) out.push({ conversation: c, snippet })
    }
    return out
  }, [conversations, search, showArchived])

  const pinned = matches.filter((m) => m.conversation.pinned)
  const rest = matches.filter((m) => !m.conversation.pinned)

  if (matches.length === 0) {
    return (
      <Text size="xs" c="dimmed" ta="center" py="md">
        {showArchived ? 'No archived conversations' : search ? 'No matches' : 'No conversations'}
      </Text>
    )
  }

  const renderItem = (m: Match) => (
    <ConversationItem
      key={m.conversation.id}
      conversation={m.conversation}
      snippet={m.snippet}
      isActive={m.conversation.id === activeId}
      onSelect={() => navigate(`/c/${m.conversation.id}`)}
      onDelete={() => {
        if (m.conversation.id === activeId) navigate('/c/new')
        deleteConversation(m.conversation.id)
      }}
      onRename={(title) => renameConversation(m.conversation.id, title)}
      onTogglePin={() => togglePinned(m.conversation.id)}
      onToggleArchive={() => {
        if (m.conversation.id === activeId) navigate('/c/new')
        toggleArchived(m.conversation.id)
      }}
    />
  )

  return (
    <Stack gap={2}>
      {pinned.length > 0 && (
        <>
          <Text size="xs" c="dimmed" fw={600} px="sm" pt={4}>Pinned</Text>
          {pinned.map(renderItem)}
          {rest.length > 0 && <Text size="xs" c="dimmed" fw={600} px="sm" pt={8}>Recent</Text>}
        </>
      )}
      {rest.map(renderItem)}
    </Stack>
  )
}

interface ConversationItemProps {
  conversation: Conversation
  snippet?: string
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
  onTogglePin: () => void
  onToggleArchive: () => void
}

function ConversationItem({
  conversation,
  snippet,
  isActive,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
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
          <Group gap={4} wrap="nowrap">
            {conversation.pinned && <IconPin size={11} style={{ flexShrink: 0, opacity: 0.6 }} />}
            <Text size="sm" truncate>
              {conversation.title}
            </Text>
          </Group>
          {snippet ? (
            <Text size="xs" c="dimmed" truncate>{snippet}</Text>
          ) : (
            <Text size="xs" c="dimmed">
              {new Date(conversation.updatedAt).toLocaleDateString()}
            </Text>
          )}
        </UnstyledButton>
      )}

      {!editing && (
        <Menu shadow="md" width={170} position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="subtle" size="sm" mr={4}>
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={conversation.pinned ? <IconPinnedOff size={14} /> : <IconPin size={14} />}
              onClick={onTogglePin}
            >
              {conversation.pinned ? 'Unpin' : 'Pin'}
            </Menu.Item>
            <Menu.Item
              leftSection={conversation.archived ? <IconArchiveOff size={14} /> : <IconArchive size={14} />}
              onClick={onToggleArchive}
            >
              {conversation.archived ? 'Unarchive' : 'Archive'}
            </Menu.Item>
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
