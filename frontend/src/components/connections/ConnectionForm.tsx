import { useState } from 'react'
import {
  Stack,
  TextInput,
  PasswordInput,
  Select,
  Switch,
  Button,
  Group,
  Alert,
} from '@mantine/core'
import { IconCheck, IconAlertCircle } from '@tabler/icons-react'
import { useForm } from '@mantine/form'
import type { Connection, ConnectionInput, ConnectionTypeHint } from '@/types'

type TestResult = { ok: true } | { ok: false; message: string }

const TYPE_OPTIONS: { value: ConnectionTypeHint; label: string }[] = [
  { value: 'openai', label: 'OpenAI-compatible' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'custom', label: 'Custom' },
]

interface ConnectionFormProps {
  initial?: Connection
  onSubmit: (input: ConnectionInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

export function ConnectionForm({ initial, onSubmit, onCancel, loading }: ConnectionFormProps) {
  const form = useForm<ConnectionInput>({
    initialValues: {
      name: initial?.name ?? '',
      baseUrl: initial?.baseUrl ?? '',
      apiKey: initial?.apiKey ?? '',
      typeHint: initial?.typeHint ?? 'openai',
      enabled: initial?.enabled ?? true,
      isDefault: initial?.isDefault ?? false,
    },
    validate: {
      name: (v) => (v.trim() ? null : 'Name is required'),
      baseUrl: (v) =>
        v.startsWith('http://') || v.startsWith('https://')
          ? null
          : 'Must start with http:// or https://',
    },
  })

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form.values),
      })
      const data = await res.json()
      if (data.ok) {
        setTestResult({ ok: true })
      } else {
        setTestResult({ ok: false, message: data.error ?? `Failed (status ${data.status ?? '?'})` })
      }
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Request failed' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="sm">
        <TextInput
          label="Name"
          placeholder="My OpenAI connection"
          required
          {...form.getInputProps('name')}
        />

        <TextInput
          label="Base URL"
          placeholder="https://api.openai.com"
          required
          description="The root URL of the OpenAI-compatible API (no /v1 suffix needed for routing, but include it if your provider requires it)"
          {...form.getInputProps('baseUrl')}
        />

        <PasswordInput
          label="API key"
          placeholder="sk-… (leave empty if not required)"
          {...form.getInputProps('apiKey')}
        />

        <Select
          label="Provider type"
          data={TYPE_OPTIONS}
          {...form.getInputProps('typeHint')}
        />

        <Group grow>
          <Switch
            label="Enabled"
            checked={form.values.enabled}
            onChange={(e) => form.setFieldValue('enabled', e.currentTarget.checked)}
          />
          <Switch
            label="Set as default"
            checked={form.values.isDefault}
            onChange={(e) => form.setFieldValue('isDefault', e.currentTarget.checked)}
          />
        </Group>

        {testResult && (
          <Alert
            color={testResult.ok ? 'teal' : 'red'}
            icon={testResult.ok ? <IconCheck size={14} /> : <IconAlertCircle size={14} />}
            py="xs"
          >
            {testResult.ok ? 'Connection succeeded.' : testResult.message}
          </Alert>
        )}

        <Group justify="space-between" mt="xs">
          <Button
            variant="default"
            onClick={handleTest}
            loading={testing}
            disabled={loading || !form.values.baseUrl}
          >
            Test connection
          </Button>
          <Group>
            <Button variant="subtle" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {initial ? 'Save changes' : 'Add connection'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  )
}
