import { useState } from 'react'
import { Box, Text, Avatar, Group, Image, CopyButton, ActionIcon, Tooltip, Badge, Textarea } from '@mantine/core'
import { IconCheck, IconCopy, IconRobot, IconUser, IconPencil, IconX } from '@tabler/icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import hljs from 'highlight.js'
import type { Components } from 'react-markdown'
import type { Message, MessageContent } from '@/types'
import classes from './MessageBubble.module.css'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  onEdit?: (newText: string) => void
}

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? '')
    const code = String(children).replace(/\n$/, '')
    const isBlock = !!match || code.includes('\n')

    if (isBlock) {
      const lang = match?.[1]
      let highlighted = code
      try {
        highlighted = lang
          ? hljs.highlight(code, { language: lang }).value
          : hljs.highlightAuto(code).value
      } catch {
        // fall back to plain text if language unknown
      }
      return (
        <div className={classes.codeBlock}>
          <div className={classes.codeHeader}>
            {lang && (
              <Badge size="xs" variant="filled" color="dark" radius="xs" className={classes.langBadge}>
                {lang}
              </Badge>
            )}
            <CopyButton value={code} timeout={1500}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color={copied ? 'teal' : 'gray'}
                    onClick={copy}
                    className={classes.codeCopyBtn}
                  >
                    {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </div>
          <pre className={classes.codePre}>
            <code
              className={`hljs${lang ? ` language-${lang}` : ''}`}
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </pre>
        </div>
      )
    }

    return (
      <code className={classes.inlineCode} {...props}>
        {children}
      </code>
    )
  },
}

export function MessageBubble({ message, isStreaming, onEdit }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const textContent = extractText(message.content)
  const images = extractImages(message.content)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(textContent)

  function commitEdit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== textContent) onEdit?.(trimmed)
    setEditing(false)
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <Box className={classes.row} data-role={message.role}>
      <Avatar
        size="sm"
        radius="xl"
        color={isUser ? 'blue' : 'gray'}
        variant="filled"
        style={{ flexShrink: 0, marginTop: 2 }}
      >
        {isUser ? <IconUser size={14} /> : <IconRobot size={14} />}
      </Avatar>

      <Box className={classes.bubble} data-role={message.role}>
        {images.length > 0 && (
          <Group gap="xs" mb="xs">
            {images.map((src, i) => (
              <Image key={i} src={src} radius="sm" maw={200} mah={200} fit="contain" />
            ))}
          </Group>
        )}

        <Box className={classes.markdown}>
          {isUser && editing ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={handleEditKeyDown}
              autosize
              minRows={1}
              maxRows={12}
              size="sm"
              autoFocus
              styles={{ input: { background: 'transparent', border: 'none', padding: 0, color: 'inherit' } }}
            />
          ) : isUser ? (
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{textContent}</Text>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={markdownComponents}
            >
              {textContent + (isStreaming ? '▋' : '')}
            </ReactMarkdown>
          )}
        </Box>

        <Box className={classes.actions}>
          {isUser && !isStreaming && onEdit && (
            editing ? (
              <>
                <Tooltip label="Confirm (Enter)" withArrow>
                  <ActionIcon size="xs" variant="subtle" color="teal" onClick={commitEdit}>
                    <IconCheck size={12} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Cancel (Esc)" withArrow>
                  <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setEditing(false)}>
                    <IconX size={12} />
                  </ActionIcon>
                </Tooltip>
              </>
            ) : (
              <Tooltip label="Edit message" withArrow>
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => { setDraft(textContent); setEditing(true) }}>
                  <IconPencil size={12} />
                </ActionIcon>
              </Tooltip>
            )
          )}
          {!isUser && !isStreaming && textContent && (
            <CopyButton value={textContent} timeout={1500}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color={copied ? 'teal' : 'gray'}
                    onClick={copy}
                  >
                    {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          )}
        </Box>
      </Box>
    </Box>
  )
}

function extractText(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content
  return content.find((c) => c.type === 'text')?.text ?? ''
}

function extractImages(content: string | MessageContent[]): string[] {
  if (typeof content === 'string') return []
  return content
    .filter((c) => c.type === 'image_url' && c.image_url?.url)
    .map((c) => c.image_url!.url)
}
