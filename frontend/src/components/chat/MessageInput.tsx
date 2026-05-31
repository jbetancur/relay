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
      <Box className={classes.pill}>
        {/* Attachments inside pill */}
        {(images.length > 0 || attachments.length > 0) && (
          <Box className={classes.pillAttachments}>
            <Group gap="xs">
              {images.map((src, i) => (
                <Box key={i} pos="relative">
                  <Image src={src} radius="sm" w={56} h={56} fit="cover" />
                  <CloseButton
                    size="xs"
                    style={{ position: 'absolute', top: -4, right: -4 }}
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  />
                </Box>
              ))}
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
          </Box>
        )}

        <Box className={classes.pillRow}>
          {/* Hidden file inputs */}
          {supportsVision && (
            <input
              ref={imageFileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { handleImageFiles(e.target.files); e.target.value = '' }}
            />
          )}
          <input
            ref={attachFileRef}
            type="file"
            accept=".txt,.md,.csv,.pdf,text/plain,text/markdown,text/csv,application/pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { handleAttachFiles(e.target.files); e.target.value = '' }}
          />

          {/* Left action buttons */}
          {supportsVision && (
            <Tooltip label="Attach image">
              <ActionIcon
                variant="subtle"
                size="md"
                onClick={() => imageFileRef.current?.click()}
                disabled={disabled || streaming}
              >
                <IconPhoto size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={extracting > 0 ? 'Extracting…' : 'Attach file (txt, md, csv, pdf)'}>
            <ActionIcon
              variant="subtle"
              size="md"
              onClick={() => attachFileRef.current?.click()}
              disabled={disabled || streaming || extracting > 0}
            >
              {extracting > 0 ? <Loader size={14} /> : <IconPaperclip size={16} />}
            </ActionIcon>
          </Tooltip>

          <Textarea
            ref={inputRef}
            className={classes.textarea}
            placeholder={streaming ? 'Streaming… (Esc to stop)' : 'Message…'}
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
              <ActionIcon size="md" variant="filled" color="red" radius="xl" onClick={onStop}>
                <IconPlayerStop size={14} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label="Send (Enter)">
              <ActionIcon
                size="md"
                variant="filled"
                color="violet"
                radius="xl"
                disabled={disabled || !hasContent}
                onClick={handleSend}
              >
                <IconSend size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Box>
      </Box>
    </Box>
  )
}
