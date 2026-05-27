import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Box,
  Group,
  ActionIcon,
  Tooltip,
  Text,
  Center,
  Stack,
  Alert,
  Select,
  Button,
  UnstyledButton,
  ThemeIcon,
  Badge,
  Menu,
  CopyButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconLayoutSidebarLeftExpand,
  IconTerminal2,
  IconAlertCircle,
  IconChevronDown,
  IconRefresh,
  IconPlug,
  IconAccessPoint,
  IconLayoutColumns,
  IconDownload,
  IconMarkdown,
  IconJson,
  IconCopy,
  IconCheck,
} from '@tabler/icons-react'
import { useParams, useNavigate } from 'react-router'

import { useConversationStore, useConnectionsStore } from '@/store'
import { useChat } from '@/hooks/useChat'
import { isVisionModel } from '@/hooks/useModels'
import { useTokenCount } from '@/hooks/useTokenCount'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { MessageInput } from '@/components/chat/MessageInput'
import { ModelSwitcher } from '@/components/chat/ModelSwitcher'
import { SystemPromptDrawer } from '@/components/chat/SystemPromptDrawer'
import { ArtifactPanel, extractArtifacts } from '@/components/chat/ArtifactPanel'
import type { Artifact } from '@/components/chat/ArtifactPanel'
import { conversationToMarkdown, downloadJSON, downloadMarkdown } from '@/lib/exportConversation'
import classes from './ChatPage.module.css'

const PROMPT_SUGGESTIONS = [
  { label: 'Explain a concept', prompt: 'Explain how transformers work in machine learning, in simple terms.' },
  { label: 'Write code', prompt: 'Write a Python function that reads a CSV file and returns the top 5 rows by a given column.' },
  { label: 'Brainstorm ideas', prompt: 'Give me 10 creative names for a self-hosted AI assistant app.' },
  { label: 'Summarise text', prompt: 'Summarise the following text in 3 bullet points:\n\n[paste your text here]' },
]

interface ChatPageProps {
  onToggleSidebar: () => void
}

export function ChatPage({ onToggleSidebar }: ChatPageProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getConversation, createConversation, setModel, setConnection } = useConversationStore()
  const { connections, getDefault } = useConnectionsStore()
  const [systemDrawerOpen, { open: openSystem, close: closeSystem }] = useDisclosure(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Create conversation on /c/new
  useEffect(() => {
    if (id === 'new') {
      const conv = createConversation()
      const defaultConn = getDefault()
      if (defaultConn) setConnection(conv.id, defaultConn.id)
      navigate(`/c/${conv.id}`, { replace: true })
    }
  }, [id, createConversation, navigate, getDefault, setConnection])

  const conversation = id && id !== 'new' ? getConversation(id) : undefined
  const { send, stop, regenerate, editAndResend, streaming, error } = useChat(conversation)
  const tokenCount = useTokenCount(conversation)

  // Auto-scroll to bottom on new messages/streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages.length])

  // Show scroll-to-bottom button when user scrolls up
  const handleScroll = useCallback(() => {
    const el = messagesRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollBtn(distFromBottom > 120)
  }, [])

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const effectiveConnectionId = conversation?.connectionId ?? getDefault()?.id ?? null
  const enabledConnections = connections.filter((c) => c.enabled)

  const supportsVision = isVisionModel(conversation?.model ?? '')

  const hasConnections = enabledConnections.length > 0
  const lastMsg = conversation?.messages.at(-1)
  const canRegenerate =
    !streaming &&
    conversation &&
    conversation.messages.length >= 2 &&
    lastMsg?.role === 'assistant'

  // Focus input after navigation
  useEffect(() => {
    inputRef.current?.focus()
  }, [id])

  // Extract renderable artifacts from assistant messages
  const artifacts: Artifact[] = conversation ? extractArtifacts(conversation.messages as Parameters<typeof extractArtifacts>[0]) : []

  // Auto-open artifact panel when a new artifact appears
  const prevArtifactCount = useRef(0)
  useEffect(() => {
    if (artifacts.length > prevArtifactCount.current) {
      setArtifactPanelOpen(true)
      setActiveArtifactId(artifacts[artifacts.length - 1].id)
    }
    prevArtifactCount.current = artifacts.length
  }, [artifacts.length])

  if (!conversation) {
    return (
      <Center h="100dvh">
        <Text c="dimmed">Loading…</Text>
      </Center>
    )
  }

  return (
    <Box className={classes.root}>
      {/* Top bar */}
      <Group className={classes.topbar} gap="sm">
        <Tooltip label="Toggle sidebar">
          <ActionIcon variant="subtle" onClick={onToggleSidebar}>
            <IconLayoutSidebarLeftExpand size={18} />
          </ActionIcon>
        </Tooltip>

        {enabledConnections.length > 1 && (
          <Select
            data={enabledConnections.map((c) => ({ value: c.id, label: c.name }))}
            value={effectiveConnectionId}
            onChange={(v) => {
              if (v) { setConnection(conversation.id, v); setModel(conversation.id, '') }
            }}
            size="xs"
            maw={160}
            styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
          />
        )}

        <ModelSwitcher
          value={conversation.model}
          onChange={(model) => setModel(conversation.id, model)}
          group="chat"
          connectionId={effectiveConnectionId}
        />

        <Box flex={1} />

        {tokenCount > 0 && (
          <Tooltip label="Estimated context tokens (≈4 chars/token)" withArrow>
            <Badge size="sm" variant="outline" color="gray" style={{ cursor: 'default', fontFamily: 'monospace' }}>
              ~{tokenCount.toLocaleString()} tok
            </Badge>
          </Tooltip>
        )}

        {canRegenerate && (
          <Tooltip label="Regenerate response">
            <ActionIcon variant="subtle" onClick={regenerate}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        )}

        {artifacts.length > 0 && (
          <Tooltip label={artifactPanelOpen ? 'Hide artifacts' : 'Show artifacts'}>
            <ActionIcon
              variant={artifactPanelOpen ? 'filled' : 'subtle'}
              color={artifactPanelOpen ? 'violet' : undefined}
              onClick={() => setArtifactPanelOpen((v) => !v)}
            >
              <IconLayoutColumns size={16} />
            </ActionIcon>
          </Tooltip>
        )}

        {conversation.messages.length > 0 && (
          <Menu shadow="md" width={200} position="bottom-end">
            <Menu.Target>
              <Tooltip label="Export conversation">
                <ActionIcon variant="subtle">
                  <IconDownload size={16} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Export as</Menu.Label>
              <CopyButton value={conversationToMarkdown(conversation)} timeout={1500}>
                {({ copied, copy }) => (
                  <Menu.Item
                    leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    onClick={copy}
                    color={copied ? 'teal' : undefined}
                  >
                    {copied ? 'Copied!' : 'Copy as Markdown'}
                  </Menu.Item>
                )}
              </CopyButton>
              <Menu.Item
                leftSection={<IconMarkdown size={14} />}
                onClick={() => downloadMarkdown(conversation)}
              >
                Download .md
              </Menu.Item>
              <Menu.Item
                leftSection={<IconJson size={14} />}
                onClick={() => downloadJSON(conversation)}
              >
                Download .json
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}

        <Tooltip label="System prompt">
          <ActionIcon variant="subtle" onClick={openSystem}>
            <IconTerminal2 size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Body — chat + optional artifact panel */}
      <Box className={classes.body}>
        {/* Chat column */}
        <Box className={classes.chatColumn}>
          {/* Message list */}
          <Box
            className={classes.messages}
            ref={messagesRef}
            onScroll={handleScroll}
          >
            {conversation.messages.length === 0 ? (
              <EmptyState
                hasConnections={hasConnections}
                hasModel={!!conversation.model}
                onSuggestion={(p) => send(p)}
              />
            ) : (
              conversation.messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={
                    streaming &&
                    msg.role === 'assistant' &&
                    i === conversation.messages.length - 1
                  }
                  onEdit={msg.role === 'user' && !streaming
                    ? (newText) => editAndResend(msg.id, newText)
                    : undefined
                  }
                />
              ))
            )}

            {error && (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color="red"
                mx="md"
                mb="sm"
                withCloseButton
              >
                {error}
              </Alert>
            )}

            <div ref={bottomRef} />
          </Box>

          {/* Scroll to bottom button */}
          {showScrollBtn && (
            <ActionIcon
              className={classes.scrollBtn}
              variant="filled"
              radius="xl"
              size="lg"
              onClick={scrollToBottom}
            >
              <IconChevronDown size={18} />
            </ActionIcon>
          )}

          <MessageInput
            inputRef={inputRef}
            onSend={(text, images, attachments) => send(text, images, attachments)}
            onStop={stop}
            disabled={!conversation.model || !hasConnections}
            streaming={streaming}
            supportsVision={supportsVision}
          />
        </Box>

        {/* Artifact panel */}
        {artifactPanelOpen && artifacts.length > 0 && (
          <ArtifactPanel
            artifacts={artifacts}
            activeId={activeArtifactId}
            onSelectArtifact={setActiveArtifactId}
            onClose={() => setArtifactPanelOpen(false)}
          />
        )}
      </Box>

      <SystemPromptDrawer
        conversationId={conversation.id}
        opened={systemDrawerOpen}
        onClose={closeSystem}
      />
    </Box>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  hasConnections: boolean
  hasModel: boolean
  onSuggestion: (prompt: string) => void
}

function EmptyState({ hasConnections, hasModel, onSuggestion }: EmptyStateProps) {
  const navigate = useNavigate()

  if (!hasConnections) {
    return (
      <Center h="100%">
        <Stack align="center" gap="lg" maw={380} ta="center">
          <ThemeIcon size={56} radius="xl" variant="light" color="violet">
            <IconPlug size={28} />
          </ThemeIcon>
          <Stack gap="xs">
            <Text size="xl" fw={700}>No connections configured</Text>
            <Text size="sm" c="dimmed">
              Add an API connection to get started — OpenAI, Ollama, Anthropic, or any
              OpenAI-compatible endpoint.
            </Text>
          </Stack>
          <Button
            leftSection={<IconPlug size={16} />}
            onClick={() => navigate('/settings?tab=connections')}
          >
            Add a connection
          </Button>
        </Stack>
      </Center>
    )
  }

  if (!hasModel) {
    return (
      <Center h="100%">
        <Stack align="center" gap="md" maw={340} ta="center">
          <ThemeIcon size={56} radius="xl" variant="light" color="violet">
            <IconAccessPoint size={28} />
          </ThemeIcon>
          <Text size="xl" fw={700}>Select a model to begin</Text>
          <Text size="sm" c="dimmed">
            Choose a model from the dropdown above to start chatting.
          </Text>
        </Stack>
      </Center>
    )
  }

  return (
    <Center h="100%">
      <Stack align="center" gap="xl" maw={480}>
        <Stack align="center" gap="xs">
          <ThemeIcon size={56} radius="xl" variant="light" color="violet">
            <IconAccessPoint size={28} />
          </ThemeIcon>
          <Text size="xl" fw={700}>What can I help with?</Text>
        </Stack>

        <Group gap="sm" justify="center">
          {PROMPT_SUGGESTIONS.map((s) => (
            <UnstyledButton
              key={s.label}
              className={classes.suggestion}
              onClick={() => onSuggestion(s.prompt)}
            >
              <Text size="sm" fw={500}>{s.label}</Text>
            </UnstyledButton>
          ))}
        </Group>
      </Stack>
    </Center>
  )
}
