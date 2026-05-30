import {
  Box,
  Stack,
  Title,
  Text,
  Select,
  Switch,
  Button,
  Divider,
  Group,
  Tabs,
  Slider,
  NumberInput,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { IconDeviceFloppy, IconPlug, IconAdjustments, IconCoin, IconPlugConnected } from '@tabler/icons-react'
import { useSearchParams } from 'react-router'
import { useSettingsStore, useConnectionsStore } from '@/store'
import { ModelSwitcher } from '@/components/chat/ModelSwitcher'
import { ConnectionsTab } from '@/components/connections/ConnectionsTab'
import { CostsTab } from '@/components/settings/CostsTab'
import { MCPTab } from '@/components/settings/MCPTab'
import { SlotPicker } from '@/components/settings/SlotPicker'
import type { RouteCategory, RouteSlot } from '@/types'
import classes from './SettingsPage.module.css'

const ROUTE_SLOTS: Array<{ key: RouteCategory; label: string; hint: string }> = [
  { key: 'fast', label: 'Fast', hint: 'Short Q&A and simple tasks. Also used as the classifier that routes every prompt.' },
  { key: 'coding', label: 'Coding', hint: 'Code generation, debugging, refactoring.' },
  { key: 'creative', label: 'Creative', hint: 'Writing, stories, brainstorming, tone.' },
  { key: 'reasoning', label: 'Reasoning', hint: 'Math, logic, analysis, multi-step problems.' },
]

export function SettingsPage() {
  const { settings, updateSettings } = useSettingsStore()
  const { getDefault } = useConnectionsStore()
  const defaultConnection = getDefault()
  const [searchParams] = useSearchParams()
  const defaultTab = searchParams.get('tab') ?? 'general'

  const form = useForm({
    initialValues: {
      defaultChatModel: settings.defaultChatModel,
      defaultImageModel: settings.defaultImageModel,
      theme: settings.theme,
      streamingEnabled: settings.streamingEnabled,
      autoRouteEnabled: settings.autoRouteEnabled,
      routeSlots: settings.routeSlots,
      routeFallback: settings.routeFallback,
      toolsEnabled: settings.toolsEnabled,
      contextStrategy: settings.contextStrategy,
      contextBudgetFraction: settings.contextBudgetFraction,
      contextReplyHeadroom: settings.contextReplyHeadroom,
      contextSummaryModel: settings.contextSummaryModel,
    },
  })

  function handleSubmit(values: typeof form.values) {
    updateSettings(values)
    notifications.show({ message: 'Settings saved', color: 'teal' })
  }

  return (
    <Box className={classes.root}>
      <Box className={classes.inner}>
        <Stack gap="md" mb="lg">
          <Title order={3}>Settings</Title>
          <Text size="sm" c="dimmed">Configure your Relay instance.</Text>
        </Stack>

        <Tabs defaultValue={defaultTab}>
          <Tabs.List mb="lg">
            <Tabs.Tab value="general" leftSection={<IconAdjustments size={14} />}>
              General
            </Tabs.Tab>
            <Tabs.Tab value="connections" leftSection={<IconPlug size={14} />}>
              Connections
            </Tabs.Tab>
            <Tabs.Tab value="costs" leftSection={<IconCoin size={14} />}>
              Costs
            </Tabs.Tab>
            <Tabs.Tab value="mcp" leftSection={<IconPlugConnected size={14} />}>
              MCP
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="general">
            <form onSubmit={form.onSubmit(handleSubmit)}>
              <Stack gap="xl">
                <Divider label="Defaults" labelPosition="left" />

                <Stack gap="xs">
                  <Text size="sm" fw={500}>Default chat model</Text>
                  <Text size="xs" c="dimmed">
                    Uses models from your default connection
                    {defaultConnection ? ` (${defaultConnection.name})` : ''}
                  </Text>
                  <ModelSwitcher
                    value={form.values.defaultChatModel}
                    onChange={(v) => form.setFieldValue('defaultChatModel', v)}
                    group="chat"
                    connectionId={defaultConnection?.id}
                  />
                </Stack>

                <Stack gap="xs">
                  <Text size="sm" fw={500}>Default image model</Text>
                  <ModelSwitcher
                    value={form.values.defaultImageModel}
                    onChange={(v) => form.setFieldValue('defaultImageModel', v)}
                    group="image"
                    connectionId={defaultConnection?.id}
                  />
                </Stack>

                <Switch
                  label="Streaming"
                  description="Stream assistant responses token by token"
                  checked={form.values.streamingEnabled}
                  onChange={(e) => form.setFieldValue('streamingEnabled', e.currentTarget.checked)}
                />

                <Divider label="Tools" labelPosition="left" />

                <Switch
                  label="Tool use (web search)"
                  description="Let the model call server-side tools like web search. Web search must still be configured by the operator; until then the model is told search is unavailable."
                  checked={form.values.toolsEnabled}
                  onChange={(e) => form.setFieldValue('toolsEnabled', e.currentTarget.checked)}
                />

                <Divider label="Auto-routing" labelPosition="left" />

                <Switch
                  label="Smart model routing"
                  description="A classifier sorts each prompt into a category and sends it to that category's model — across any of your connections."
                  checked={form.values.autoRouteEnabled}
                  onChange={(e) => form.setFieldValue('autoRouteEnabled', e.currentTarget.checked)}
                />

                {form.values.autoRouteEnabled && (
                  <Stack gap="lg">
                    {ROUTE_SLOTS.map(({ key, label, hint }) => (
                      <SlotPicker
                        key={key}
                        label={label}
                        hint={hint}
                        value={form.values.routeSlots[key]}
                        onChange={(slot: RouteSlot | undefined) =>
                          form.setFieldValue('routeSlots', {
                            ...form.values.routeSlots,
                            [key]: slot,
                          })
                        }
                      />
                    ))}
                    <Select
                      label="Fallback"
                      description="Used when the classifier can't decide or its connection is unavailable."
                      data={[
                        { value: 'conversation', label: "Conversation's current model" },
                        { value: 'fast', label: 'Fast slot' },
                      ]}
                      value={form.values.routeFallback}
                      onChange={(v) => v && form.setFieldValue('routeFallback', v as 'conversation' | 'fast')}
                      maw={320}
                    />
                  </Stack>
                )}

                <Divider label="Context" labelPosition="left" />

                <Select
                  label="Default context strategy"
                  description="How conversation history is trimmed before being sent. Overridable per chat from the chat header."
                  data={[
                    { value: 'none', label: 'None — send the full history (may hit the model limit)' },
                    { value: 'window', label: 'Window — keep recent messages within a token budget (free)' },
                    { value: 'summarize', label: 'Summarize — condense older messages (costs tokens)' },
                  ]}
                  value={form.values.contextStrategy}
                  onChange={(v) => v && form.setFieldValue('contextStrategy', v as typeof form.values.contextStrategy)}
                  maw={460}
                />

                {form.values.contextStrategy !== 'none' && (
                  <>
                    <Box maw={460}>
                      <Text size="sm" fw={500}>Context budget: {Math.round(form.values.contextBudgetFraction * 100)}% of the window</Text>
                      <Text size="xs" c="dimmed" mb="xs">Share of the model's context window to fill with history before trimming.</Text>
                      <Slider
                        min={0.3}
                        max={0.95}
                        step={0.05}
                        value={form.values.contextBudgetFraction}
                        onChange={(v) => form.setFieldValue('contextBudgetFraction', v)}
                        label={(v) => `${Math.round(v * 100)}%`}
                      />
                    </Box>

                    <NumberInput
                      label="Reply headroom (tokens)"
                      description="Tokens reserved for the model's response, kept free of history."
                      value={form.values.contextReplyHeadroom}
                      onChange={(v) => form.setFieldValue('contextReplyHeadroom', typeof v === 'number' ? v : 1024)}
                      min={0}
                      step={256}
                      maw={260}
                    />
                  </>
                )}

                {form.values.contextStrategy === 'summarize' && (
                  <Stack gap="xs">
                    <Text size="sm" fw={500}>Summary model</Text>
                    <Text size="xs" c="dimmed">
                      Used to condense dropped messages. This spends tokens each time history overflows — pick a cheap model. Leave blank to reuse the conversation's model.
                    </Text>
                    <ModelSwitcher
                      value={form.values.contextSummaryModel}
                      onChange={(v) => form.setFieldValue('contextSummaryModel', v)}
                      group="chat"
                      connectionId={defaultConnection?.id}
                    />
                  </Stack>
                )}

                <Divider label="Appearance" labelPosition="left" />

                <Select
                  label="Theme"
                  data={[
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                    { value: 'auto', label: 'System' },
                  ]}
                  {...form.getInputProps('theme')}
                />

                <Group justify="flex-end">
                  <Button type="submit" leftSection={<IconDeviceFloppy size={16} />}>
                    Save settings
                  </Button>
                </Group>
              </Stack>
            </form>
          </Tabs.Panel>

          <Tabs.Panel value="connections">
            <ConnectionsTab />
          </Tabs.Panel>

          <Tabs.Panel value="costs">
            <CostsTab />
          </Tabs.Panel>

          <Tabs.Panel value="mcp">
            <MCPTab />
          </Tabs.Panel>
        </Tabs>
      </Box>
    </Box>
  )
}
