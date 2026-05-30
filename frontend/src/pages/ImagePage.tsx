import { useState, useEffect } from 'react'
import {
  Box,
  Group,
  ActionIcon,
  Tooltip,
  Text,
  Textarea,
  Button,
  Select,
  NumberInput,
  SimpleGrid,
  Card,
  Image,
  Stack,
  Alert,
  Divider,
  ScrollArea,
} from '@mantine/core'
import {
  IconLayoutSidebarLeftExpand,
  IconWand,
  IconAlertCircle,
  IconDownload,
  IconTrash,
} from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'

import { useImageGen } from '@/hooks/useImageGen'
import { useImageGalleryStore, useSettingsStore, useConnectionsStore } from '@/store'
import { ModelSwitcher } from '@/components/chat/ModelSwitcher'
import type { ImageSize, ImageQuality } from '@/types'
import classes from './ImagePage.module.css'

const SIZE_OPTIONS_GPT: { value: ImageSize; label: string }[] = [
  { value: '1024x1024', label: '1024 × 1024 (square)' },
  { value: '1536x1024', label: '1536 × 1024 (landscape)' },
  { value: '1024x1536', label: '1024 × 1536 (portrait)' },
]

const SIZE_OPTIONS_DALLE3: { value: ImageSize; label: string }[] = [
  { value: '1024x1024', label: '1024 × 1024 (square)' },
  { value: '1792x1024', label: '1792 × 1024 (landscape)' },
  { value: '1024x1792', label: '1024 × 1792 (portrait)' },
]

const SIZE_OPTIONS_DALLE2: { value: ImageSize; label: string }[] = [
  { value: '1024x1024', label: '1024 × 1024' },
  { value: '512x512', label: '512 × 512' },
  { value: '256x256', label: '256 × 256' },
]

const QUALITY_OPTIONS_GPT: { value: ImageQuality; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

const QUALITY_OPTIONS_DALLE3: { value: ImageQuality; label: string }[] = [
  { value: 'hd', label: 'HD' },
  { value: 'standard', label: 'Standard' },
]

const QUALITY_OPTIONS_DALLE2: { value: ImageQuality; label: string }[] = [
  { value: 'standard', label: 'Standard' },
]


function getModelFamily(model: string): 'gpt-image' | 'dall-e-3' | 'dall-e-2' {
  if (model.startsWith('gpt-image')) return 'gpt-image'
  if (model === 'dall-e-3') return 'dall-e-3'
  return 'dall-e-2'
}

interface ImagePageProps {
  onToggleSidebar: () => void
}

export function ImagePage({ onToggleSidebar }: ImagePageProps) {
  const { settings } = useSettingsStore()
  const { connections, getDefault } = useConnectionsStore()
  const defaultConnectionId = getDefault()?.id ?? null
  const [connectionId, setConnectionId] = useState<string | null>(defaultConnectionId)

  useEffect(() => {
    if (defaultConnectionId) setConnectionId((prev) => prev ?? defaultConnectionId)
  }, [defaultConnectionId])
  const [model, setModel] = useState(settings.defaultImageModel)
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState<ImageSize>('1024x1024')
  const [quality, setQuality] = useState<ImageQuality>('auto')
  const [n, setN] = useState<number>(1)

  const modelFamily = getModelFamily(model)
  const sizeOptions =
    modelFamily === 'gpt-image' ? SIZE_OPTIONS_GPT :
    modelFamily === 'dall-e-3' ? SIZE_OPTIONS_DALLE3 :
    SIZE_OPTIONS_DALLE2
  const qualityOptions =
    modelFamily === 'gpt-image' ? QUALITY_OPTIONS_GPT :
    modelFamily === 'dall-e-3' ? QUALITY_OPTIONS_DALLE3 :
    QUALITY_OPTIONS_DALLE2

  function handleModelChange(m: string) {
    setModel(m)
    const family = getModelFamily(m)
    setQuality(family === 'gpt-image' ? 'auto' : family === 'dall-e-3' ? 'hd' : 'standard')
    setSize('1024x1024')
    setN(1)
  }

  const { generate, generating, error } = useImageGen(connectionId)
  const { images, deleteImage } = useImageGalleryStore()

  async function handleGenerate() {
    if (!prompt.trim()) return
    await generate({ prompt, model, size, quality, n })
    notifications.show({ message: 'Image generated', color: 'teal' })
  }

  function handleDownload(url: string, id: string) {
    const a = document.createElement('a')
    a.href = url
    a.download = `relay-${id}.png`
    a.click()
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
        <Text fw={600} size="sm">Image generation</Text>
      </Group>

      <Box className={classes.body}>
        {/* Controls panel */}
        <Box className={classes.controls}>
          <ScrollArea h="100%" offsetScrollbars>
            <Stack gap="md" p="md">
              {connections.filter((c) => c.enabled).length > 1 && (
                <Select
                  label="Connection"
                  data={connections.filter((c) => c.enabled).map((c) => ({ value: c.id, label: c.name }))}
                  value={connectionId}
                  onChange={(v) => { setConnectionId(v); setModel('') }}
                  size="sm"
                />
              )}
              <ModelSwitcher value={model} onChange={handleModelChange} group="image" connectionId={connectionId} />

              <Textarea
                label="Prompt"
                placeholder="A photorealistic cat astronaut floating in space…"
                value={prompt}
                onChange={(e) => setPrompt(e.currentTarget.value)}
                autosize
                minRows={4}
                maxRows={10}
              />

              <Select
                label="Size"
                data={sizeOptions}
                value={size}
                onChange={(v) => v && setSize(v as ImageSize)}
              />

              <Select
                label="Quality"
                data={qualityOptions}
                value={quality}
                onChange={(v) => v && setQuality(v as ImageQuality)}
              />


              {modelFamily !== 'dall-e-3' && (
                <NumberInput
                  label="Number of images"
                  value={n}
                  onChange={(v) => setN(Number(v))}
                  min={1}
                  max={4}
                />
              )}

              {error && (
                <Alert icon={<IconAlertCircle size={14} />} color="red">
                  {error}
                </Alert>
              )}

              <Button
                leftSection={<IconWand size={16} />}
                loading={generating}
                disabled={!prompt.trim() || !model}
                onClick={handleGenerate}
                fullWidth
              >
                Generate
              </Button>
            </Stack>
          </ScrollArea>
        </Box>

        <Divider orientation="vertical" />

        {/* Gallery */}
        <ScrollArea flex={1}>
          {images.length === 0 ? (
            <Stack h="100%" align="center" justify="center" py="xl">
              <Text c="dimmed" size="sm">Generated images will appear here</Text>
            </Stack>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} p="md" spacing="md">
              {images.map((img) => (
                <Card key={img.id} radius="md" padding="xs" withBorder>
                  <Card.Section>
                    <Image
                      src={img.url}
                      radius="sm"
                      fallbackSrc="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
                    />
                  </Card.Section>
                  <Group mt="xs" justify="space-between">
                    <Text size="xs" c="dimmed" truncate flex={1}>
                      {img.prompt}
                    </Text>
                    <Group gap={4}>
                      {img.url && (
                        <Tooltip label="Download">
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            onClick={() => handleDownload(img.url!, img.id)}
                          >
                            <IconDownload size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <Tooltip label="Delete">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          onClick={() => deleteImage(img.id)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                </Card>
              ))}
            </SimpleGrid>
          )}
        </ScrollArea>
      </Box>
    </Box>
  )
}
