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
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { IconDeviceFloppy, IconPlug, IconAdjustments, IconCoin } from '@tabler/icons-react'
import { useSearchParams } from 'react-router'
import { useSettingsStore, useConnectionsStore } from '@/store'
import { ModelSwitcher } from '@/components/chat/ModelSwitcher'
import { ConnectionsTab } from '@/components/connections/ConnectionsTab'
import { CostsTab } from '@/components/settings/CostsTab'
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
      autoRouteCheapModel: settings.autoRouteCheapModel,
      autoRouteStrongModel: settings.autoRouteStrongModel,
      toolsEnabled: settings.toolsEnabled,
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
                  description="Automatically send short/simple prompts to a cheaper model and complex/code prompts to a stronger one."
                  checked={form.values.autoRouteEnabled}
                  onChange={(e) => form.setFieldValue('autoRouteEnabled', e.currentTarget.checked)}
                />

                {form.values.autoRouteEnabled && (
                  <Group grow align="flex-start">
                    <Stack gap="xs">
                      <Text size="sm" fw={500}>Cheap model</Text>
                      <ModelSwitcher
                        value={form.values.autoRouteCheapModel}
                        onChange={(v) => form.setFieldValue('autoRouteCheapModel', v)}
                        group="chat"
                        connectionId={defaultConnection?.id}
                      />
                    </Stack>
                    <Stack gap="xs">
                      <Text size="sm" fw={500}>Strong model</Text>
                      <ModelSwitcher
                        value={form.values.autoRouteStrongModel}
                        onChange={(v) => form.setFieldValue('autoRouteStrongModel', v)}
                        group="chat"
                        connectionId={defaultConnection?.id}
                      />
                    </Stack>
                  </Group>
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
        </Tabs>
      </Box>
    </Box>
  )
}
