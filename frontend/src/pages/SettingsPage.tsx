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
import { IconDeviceFloppy, IconPlug, IconAdjustments, IconCoin, IconPlugConnected, IconRobot } from '@tabler/icons-react'
import { useSearchParams } from 'react-router'
import { useSettingsStore, useConnectionsStore } from '@/store'
import { ModelSwitcher } from '@/components/chat/ModelSwitcher'
import { ConnectionsTab } from '@/components/connections/ConnectionsTab'
import { CostsTab } from '@/components/settings/CostsTab'
import { MCPTab } from '@/components/settings/MCPTab'
import { AgentsTab } from '@/components/settings/AgentsTab'
import classes from './SettingsPage.module.css'

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
      toolsEnabled: settings.toolsEnabled,
      contextStrategy: settings.contextStrategy,
      contextBudgetFraction: settings.contextBudgetFraction,
      contextReplyHeadroom: settings.contextReplyHeadroom,
      contextSummaryModel: settings.contextSummaryModel,
      maxTokens: settings.maxTokens,
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
            <Tabs.Tab value="agents" leftSection={<IconRobot size={14} />}>
              Agents
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
                  description="Automatically picks the best model for each prompt — local models for simple tasks, stronger models for complex ones. No configuration needed; the backend scores complexity from your prompt and available connections."
                  checked={form.values.autoRouteEnabled}
                  onChange={(e) => form.setFieldValue('autoRouteEnabled', e.currentTarget.checked)}
                />

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

                <NumberInput
                  label="Max response tokens"
                  description="Cap the length of each reply. Lower values produce shorter, more concise responses. Leave blank for the model's default (often very long)."
                  value={form.values.maxTokens ?? ''}
                  onChange={(v) => form.setFieldValue('maxTokens', typeof v === 'number' ? v : null)}
                  min={64}
                  step={256}
                  placeholder="No limit"
                  maw={260}
                />

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

          <Tabs.Panel value="agents">
            <AgentsTab />
          </Tabs.Panel>
        </Tabs>
      </Box>
    </Box>
  )
}
