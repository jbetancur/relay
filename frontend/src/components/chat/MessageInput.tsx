import { useRef, useState, type KeyboardEvent } from 'react'
import {
  Box,
  Textarea,
  ActionIcon,
  Group,
  Tooltip,
  Image,
  CloseButton,
  Text,
  Badge,
} from '@mantine/core'
import { IconSend, IconPhoto, IconPlayerStop, IconPaperclip } from '@tabler/icons-react'
import { Loader } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { api } from '@/lib/api'
import classes from './MessageInput.module.css'

export interface FileAttachment {
  name: string
  content: string
  type: 'text' | 'pdf'
}

interface MessageInputProps {
  onSend: (text: string, images: string[], attachments: FileAttachment[]) => void
  onStop?: () => void
  disabled?: boolean
  streaming?: boolean
  supportsVision?: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}

export function MessageInput({
  onSend,
  onStop,
  disabled,
  streaming,
  supportsVision,
  inputRef,
}: MessageInputProps) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [extracting, setExtracting] = useState(0)
  const imageFileRef = useRef<HTMLInputElement>(null)
  const attachFileRef = useRef<HTMLInputElement>(null)

  function handleSend() {
    const trimmed = text.trim()
    if (!trimmed && images.length === 0 && attachments.length === 0) return
    onSend(trimmed, images, attachments)
    setText('')
    setImages([])
    setAttachments([])
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (streaming) onStop?.()
      else handleSend()
    }
    if (e.key === 'Escape' && streaming) {
      onStop?.()
    }
  }

  function handleImageFiles(files: FileList | null) {
    if (!files) return
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = (e) => {
        const url = e.target?.result as string
        setImages((prev) => [...prev, url])
      }
      reader.readAsDataURL(file)
    })
  }

  function handleAttachFiles(files: FileList | null) {
    if (!files) return
    Array.from(files).forEach(async (file) => {
      const isText = file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.csv')
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      if (!isText && !isPdf) return

      if (isPdf) {
        // PDFs can't be read as text in the browser — extract server-side.
        setExtracting((n) => n + 1)
        try {
          const { text } = await api.documents.extract(file)
          setAttachments((prev) => [...prev, { name: file.name, content: text, type: 'pdf' }])
        } catch (e) {
          notifications.show({
            color: 'red',
            message: e instanceof Error ? e.message : `Could not read ${file.name}`,
          })
        } finally {
          setExtracting((n) => n - 1)
        }
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setAttachments((prev) => [...prev, { name: file.name, content, type: 'text' }])
      }
      reader.readAsText(file)
    })
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter((i) => i.type.startsWith('image/'))
    if (imageItems.length === 0) return
    e.preventDefault()
    imageItems.forEach((item) => {
      const file = item.getAsFile()
      if (file) {
        const reader = new FileReader()
        reader.onload = (ev) => {
          const url = ev.target?.result as string
          setImages((prev) => [...prev, url])
        }
        reader.readAsDataURL(file)
      }
    })
  }

  const hasContent = !!text.trim() || images.length > 0 || attachments.length > 0

  return (
    <Box className={classes.root}>
      {/* Image previews */}
      {images.length > 0 && (
        <Group gap="xs" px="md" pt="xs">
          {images.map((src, i) => (
            <Box key={i} pos="relative">
              <Image src={src} radius="sm" w={64} h={64} fit="cover" />
              <CloseButton
                size="xs"
                style={{ position: 'absolute', top: -4, right: -4 }}
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
              />
            </Box>
          ))}
        </Group>
      )}

      {/* File attachment chips */}
      {attachments.length > 0 && (
        <Group gap="xs" px="md" pt="xs">
          {attachments.map((att, i) => (
            <Badge
              key={i}
              size="sm"
              variant="outline"
              color="violet"
              rightSection={
                <CloseButton
                  size="xs"
                  style={{ marginLeft: 2 }}
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                />
              }
            >
              <Text size="xs" truncate maw={160}>{att.name}</Text>
            </Badge>
          ))}
        </Group>
      )}

      <Group gap="xs" p="sm" align="flex-end">
        {/* Image attach (vision models only) */}
        {supportsVision && (
          <>
            <input
              ref={imageFileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { handleImageFiles(e.target.files); e.target.value = '' }}
            />
            <Tooltip label="Attach image">
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => imageFileRef.current?.click()}
                disabled={disabled || streaming}
              >
                <IconPhoto size={18} />
              </ActionIcon>
            </Tooltip>
          </>
        )}

        {/* Text / PDF attach — always available */}
        <input
          ref={attachFileRef}
          type="file"
          accept=".txt,.md,.csv,.pdf,text/plain,text/markdown,text/csv,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { handleAttachFiles(e.target.files); e.target.value = '' }}
        />
        <Tooltip label={extracting > 0 ? 'Extracting…' : 'Attach file (txt, md, csv, pdf)'}>
          <ActionIcon
            variant="subtle"
            size="lg"
            onClick={() => attachFileRef.current?.click()}
            disabled={disabled || streaming || extracting > 0}
          >
            {extracting > 0 ? <Loader size={16} /> : <IconPaperclip size={18} />}
          </ActionIcon>
        </Tooltip>

        <Textarea
          ref={inputRef}
          className={classes.textarea}
          placeholder={streaming ? 'Streaming… (Esc to stop)' : 'Message… (Shift+Enter for newline)'}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          autosize
          minRows={1}
          maxRows={8}
          disabled={disabled && !streaming}
        />

        {streaming ? (
          <Tooltip label="Stop (Esc)">
            <ActionIcon size="lg" variant="filled" color="red" onClick={onStop}>
              <IconPlayerStop size={16} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Tooltip label="Send (Enter)">
            <ActionIcon
              size="lg"
              variant="filled"
              color="violet"
              disabled={disabled || !hasContent}
              onClick={handleSend}
            >
              <IconSend size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </Box>
  )
}
