import { Drawer, Textarea, Button, Stack, Text, Group } from '@mantine/core'
import { useState, useEffect } from 'react'
import { useDisclosure } from '@mantine/hooks'
import { IconBookmark } from '@tabler/icons-react'
import { useConversationStore } from '@/store'
import { PromptLibraryDrawer } from './PromptLibraryDrawer'

interface SystemPromptDrawerProps {
  conversationId: string
  opened: boolean
  onClose: () => void
}

export function SystemPromptDrawer({ conversationId, opened, onClose }: SystemPromptDrawerProps) {
  const { getConversation, setSystemPrompt } = useConversationStore()
  const conv = getConversation(conversationId)
  const [value, setValue] = useState(conv?.systemPrompt ?? '')
  const [libOpen, { open: openLib, close: closeLib }] = useDisclosure(false)

  useEffect(() => {
    setValue(conv?.systemPrompt ?? '')
  }, [conv?.systemPrompt])

  function handleSave() {
    setSystemPrompt(conversationId, value)
    onClose()
  }

  return (
    <>
      <Drawer
        opened={opened}
        onClose={onClose}
        title="System prompt"
        position="right"
        size="lg"
      >
        <Stack h="100%" gap="md">
          <Text size="sm" c="dimmed">
            Set a persona or instructions for this conversation. Applied as the system message before
            any user messages. Use <code>{'{{variable}}'}</code> placeholders in saved templates.
          </Text>
          <Textarea
            flex={1}
            placeholder="You are a helpful assistant…"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            autosize
            minRows={12}
            styles={{ input: { fontFamily: 'monospace', fontSize: 13 } }}
          />
          <Group gap="xs">
            <Button
              variant="outline"
              leftSection={<IconBookmark size={14} />}
              onClick={openLib}
              flex={1}
            >
              Prompt library
            </Button>
            <Button onClick={handleSave} flex={2}>
              Save
            </Button>
          </Group>
        </Stack>
      </Drawer>

      <PromptLibraryDrawer
        opened={libOpen}
        onClose={closeLib}
        currentPrompt={value}
        onApply={(content) => setValue(content)}
      />
    </>
  )
}
