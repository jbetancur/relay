import { useState } from 'react'
import {
  Drawer,
  Stack,
  TextInput,
  Textarea,
  Button,
  Group,
  Text,
  ActionIcon,
  Tooltip,
  Divider,
  Box,
  Badge,
  Modal,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconTrash, IconPencil, IconCheck, IconBookmark, IconVariable } from '@tabler/icons-react'
import { usePromptsStore, extractVariables, fillVariables } from '@/store/prompts'
import type { PromptTemplate } from '@/store/prompts'

interface PromptLibraryDrawerProps {
  opened: boolean
  onClose: () => void
  onApply: (content: string) => void
  currentPrompt?: string
}

export function PromptLibraryDrawer({ opened, onClose, onApply, currentPrompt }: PromptLibraryDrawerProps) {
  const { prompts, save, update, remove } = usePromptsStore()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editContent, setEditContent] = useState('')
  const [applyTarget, setApplyTarget] = useState<PromptTemplate | null>(null)
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  const [varModalOpen, { open: openVarModal, close: closeVarModal }] = useDisclosure(false)

  function handleSaveCurrent() {
    if (!currentPrompt?.trim() || !newName.trim()) return
    save(newName.trim(), currentPrompt)
    setNewName('')
  }

  function handleStartEdit(p: PromptTemplate) {
    setEditingId(p.id)
    setEditName(p.name)
    setEditContent(p.content)
  }

  function handleCommitEdit() {
    if (!editingId) return
    update(editingId, { name: editName.trim(), content: editContent.trim() })
    setEditingId(null)
  }

  function handleApply(p: PromptTemplate) {
    const vars = extractVariables(p.content)
    if (vars.length > 0) {
      setApplyTarget(p)
      setVarValues(Object.fromEntries(vars.map((v) => [v, ''])))
      openVarModal()
    } else {
      onApply(p.content)
      onClose()
    }
  }

  function handleApplyWithVars() {
    if (!applyTarget) return
    onApply(fillVariables(applyTarget.content, varValues))
    closeVarModal()
    setApplyTarget(null)
    onClose()
  }

  return (
    <>
      <Drawer
        opened={opened}
        onClose={onClose}
        title="Prompt library"
        position="right"
        size="md"
        padding="md"
      >
        <Stack gap="md">
          {/* Save current prompt */}
          {currentPrompt?.trim() && (
            <Box>
              <Text size="xs" c="dimmed" mb={6}>Save current system prompt</Text>
              <Group gap="xs">
                <TextInput
                  placeholder="Template name…"
                  value={newName}
                  onChange={(e) => setNewName(e.currentTarget.value)}
                  size="xs"
                  flex={1}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveCurrent() }}
                />
                <Button
                  size="xs"
                  leftSection={<IconBookmark size={13} />}
                  disabled={!newName.trim()}
                  onClick={handleSaveCurrent}
                >
                  Save
                </Button>
              </Group>
            </Box>
          )}

          <Divider />

          {prompts.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              No saved prompts yet. Write a system prompt and save it above.
            </Text>
          ) : (
            <Stack gap="xs">
              {prompts.map((p) => (
                <Box
                  key={p.id}
                  p="sm"
                  style={(theme) => ({
                    border: `1px solid ${theme.colors.dark[4]}`,
                    borderRadius: theme.radius.md,
                    background: theme.colors.dark[7],
                  })}
                >
                  {editingId === p.id ? (
                    <Stack gap="xs">
                      <TextInput
                        value={editName}
                        onChange={(e) => setEditName(e.currentTarget.value)}
                        size="xs"
                        placeholder="Template name"
                      />
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.currentTarget.value)}
                        size="xs"
                        autosize
                        minRows={3}
                        maxRows={10}
                      />
                      <Group justify="flex-end" gap="xs">
                        <Button size="xs" variant="subtle" onClick={() => setEditingId(null)}>Cancel</Button>
                        <Button size="xs" onClick={handleCommitEdit}>Save</Button>
                      </Group>
                    </Stack>
                  ) : (
                    <>
                      <Group justify="space-between" mb={4}>
                        <Group gap="xs">
                          <Text size="sm" fw={600}>{p.name}</Text>
                          {extractVariables(p.content).length > 0 && (
                            <Tooltip label="Has variables">
                              <Badge size="xs" variant="light" color="violet" leftSection={<IconVariable size={10} />}>
                                {extractVariables(p.content).length}
                              </Badge>
                            </Tooltip>
                          )}
                        </Group>
                        <Group gap={4}>
                          <Tooltip label="Edit">
                            <ActionIcon size="xs" variant="subtle" onClick={() => handleStartEdit(p)}>
                              <IconPencil size={12} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete" color="red">
                            <ActionIcon size="xs" variant="subtle" color="red" onClick={() => remove(p.id)}>
                              <IconTrash size={12} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>
                      <Text size="xs" c="dimmed" lineClamp={3} mb="xs" style={{ whiteSpace: 'pre-wrap' }}>
                        {p.content}
                      </Text>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconCheck size={12} />}
                        onClick={() => handleApply(p)}
                        fullWidth
                      >
                        Use this prompt
                      </Button>
                    </>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      </Drawer>

      {/* Variable fill-in modal */}
      <Modal
        opened={varModalOpen}
        onClose={closeVarModal}
        title="Fill in variables"
        size="sm"
      >
        {applyTarget && (
          <Stack gap="sm">
            <Text size="xs" c="dimmed">This template has variables. Fill them in below.</Text>
            {extractVariables(applyTarget.content).map((v) => (
              <TextInput
                key={v}
                label={`{{${v}}}`}
                value={varValues[v] ?? ''}
                onChange={(e) => setVarValues((prev) => ({ ...prev, [v]: e.currentTarget.value }))}
                size="sm"
              />
            ))}
            <Button mt="xs" onClick={handleApplyWithVars}>Apply</Button>
          </Stack>
        )}
      </Modal>
    </>
  )
}
