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
  Text,
} from '@mantine/core'
import { IconCheck, IconAlertCircle } from '@tabler/icons-react'
import { useForm } from '@mantine/form'
import type { Connection, ConnectionInput, ConnectionTypeHint } from '@/types'

type TestResult = { ok: true } | { ok: false; message: string }

const PROVIDER_DEFAULTS: Record<
  ConnectionTypeHint,
  { label: string; baseUrl: string; keyPlaceholder: string; keyRequired: boolean }
> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    keyPlaceholder: 'sk-…',
    keyRequired: true,
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyPlaceholder: 'sk-ant-…',
    keyRequired: true,
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://localhost:11434',
    keyPlaceholder: '(not required)',
    keyRequired: false,
  },
  custom: {
    label: 'Custom / OpenAI-compatible',
    baseUrl: '',
    keyPlaceholder: 'API key (leave empty if not required)',
    keyRequired: false,
  },
}

const TYPE_OPTIONS = Object.entries(PROVIDER_DEFAULTS).map(([value, { label }]) => ({
  value: value as ConnectionTypeHint,
  label,
}))

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
      baseUrl: initial?.baseUrl ?? PROVIDER_DEFAULTS.openai.baseUrl,
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

  function handleTypeChange(value: string | null) {
    const type = (value ?? 'openai') as ConnectionTypeHint
    const defaults = PROVIDER_DEFAULTS[type]
    form.setFieldValue('typeHint', type)
    // Only auto-fill baseUrl when it's a known provider (not custom)
    if (type !== 'custom') {
      form.setFieldValue('baseUrl', defaults.baseUrl)
    }
    // Auto-fill name if the user hasn't set one yet
    if (!form.values.name.trim()) {
      form.setFieldValue('name', defaults.label)
    }
    setTestResult(null)
  }

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

  const provider = PROVIDER_DEFAULTS[form.values.typeHint]
  const isKnownProvider = form.values.typeHint !== 'custom'

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="sm">
        <Select
          label="Provider"
          data={TYPE_OPTIONS}
          value={form.values.typeHint}
          onChange={handleTypeChange}
        />

        <TextInput
          label="Name"
          placeholder={provider.label}
          required
          {...form.getInputProps('name')}
        />

        {isKnownProvider ? (
          <TextInput
            label="Base URL"
            value={form.values.baseUrl}
            readOnly
            styles={{ input: { color: 'var(--mantine-color-dimmed)' } }}
            rightSection={
              <Text size="xs" c="dimmed" pr="xs">
                fixed
              </Text>
            }
          />
        ) : (
          <TextInput
            label="Base URL"
            placeholder="https://my-provider.example.com"
            required
            description="Root URL of the OpenAI-compatible API (no /v1 suffix)"
            {...form.getInputProps('baseUrl')}
          />
        )}

        <PasswordInput
          label="API key"
          placeholder={provider.keyPlaceholder}
          {...form.getInputProps('apiKey')}
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
