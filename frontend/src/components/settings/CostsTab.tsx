import { useEffect, useMemo, useState } from 'react'
import {
  Stack,
  Divider,
  Text,
  Group,
  NumberInput,
  Button,
  Table,
  TextInput,
  ActionIcon,
  Tooltip,
  Progress,
  Alert,
  Badge,
  Box,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconTrash, IconPlus, IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import { useSettingsStore, useConnectionsStore } from '@/store'
import { api } from '@/lib/api'
import { costFor, formatUSD, priceForModel, type ModelPrice } from '@/lib/pricing'
import type { ModelUsage } from '@/types'

function startOfMonthMillis(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

export function CostsTab() {
  const { settings, updateSettings } = useSettingsStore()
  const { getDefault } = useConnectionsStore()
  const [usage, setUsage] = useState<ModelUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [budgetDraft, setBudgetDraft] = useState(settings.monthlyBudgetUSD)
  // Base price table fetched from the backend (keyed by model pattern).
  const [basePrices, setBasePrices] = useState<Record<string, ModelPrice>>({})

  // New override row inputs
  const [newModel, setNewModel] = useState('')
  const [newInput, setNewInput] = useState<number | string>('')
  const [newOutput, setNewOutput] = useState<number | string>('')

  const refresh = () => {
    setLoading(true)
    api.usage
      .byModel(startOfMonthMillis())
      .then(setUsage)
      .catch(() => setUsage([]))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  // Fetch the backend's base price table once (bulk, no probing).
  useEffect(() => {
    const conn = getDefault()
    if (!conn) return
    api.models
      .metaTable(conn.id)
      .then((table) => {
        const prices: Record<string, ModelPrice> = {}
        for (const [pattern, meta] of Object.entries(table)) {
          if (meta.price) prices[pattern] = meta.price
        }
        setBasePrices(prices)
      })
      .catch(() => setBasePrices({}))
  }, [getDefault])

  const overrides = settings.priceOverrides

  // Month-to-date cost, aggregated per model.
  const perModel = useMemo(() => {
    const map = new Map<string, { tokens: number; cost: number; priced: boolean }>()
    for (const u of usage) {
      const cost = costFor(u.model, u.promptTokens, u.completionTokens, basePrices, overrides)
      const priced = priceForModel(u.model, basePrices, overrides) !== null
      const prev = map.get(u.model) ?? { tokens: 0, cost: 0, priced }
      map.set(u.model, {
        tokens: prev.tokens + u.promptTokens + u.completionTokens,
        cost: prev.cost + cost,
        priced: prev.priced || priced,
      })
    }
    return [...map.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost)
  }, [usage, basePrices, overrides])

  const totalCost = perModel.reduce((sum, m) => sum + m.cost, 0)
  const budget = settings.monthlyBudgetUSD
  const overBudget = budget > 0 && totalCost > budget
  const pct = budget > 0 ? Math.min(100, (totalCost / budget) * 100) : 0

  function saveBudget() {
    updateSettings({ monthlyBudgetUSD: Number(budgetDraft) || 0 })
    notifications.show({ message: 'Budget saved', color: 'teal' })
  }

  function addOverride() {
    const model = newModel.trim()
    if (!model) return
    updateSettings({
      priceOverrides: {
        ...overrides,
        [model]: { input: Number(newInput) || 0, output: Number(newOutput) || 0 },
      },
    })
    setNewModel('')
    setNewInput('')
    setNewOutput('')
  }

  function removeOverride(model: string) {
    const next = { ...overrides }
    delete next[model]
    updateSettings({ priceOverrides: next })
  }

  return (
    <Stack gap="xl">
      <Divider label="This month" labelPosition="left" />

      {overBudget && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          You've exceeded your monthly budget of {formatUSD(budget)} — current spend is{' '}
          {formatUSD(totalCost)}.
        </Alert>
      )}

      <Box>
        <Group justify="space-between" mb={6}>
          <Text size="sm" fw={500}>
            Month-to-date spend: <strong>{formatUSD(totalCost)}</strong>
            {budget > 0 && <Text span c="dimmed"> / {formatUSD(budget)}</Text>}
          </Text>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={refresh} loading={loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {budget > 0 && (
          <Progress
            value={pct}
            color={overBudget ? 'red' : pct > 80 ? 'orange' : 'teal'}
            size="lg"
            radius="sm"
          />
        )}
      </Box>

      {perModel.length === 0 ? (
        <Text size="sm" c="dimmed">No usage recorded yet this month.</Text>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Model</Table.Th>
              <Table.Th>Tokens</Table.Th>
              <Table.Th ta="right">Cost</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {perModel.map((m) => (
              <Table.Tr key={m.model}>
                <Table.Td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {m.model || '(unknown)'}
                  {!m.priced && (
                    <Badge size="xs" variant="light" color="gray" ml={6}>
                      unpriced
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{m.tokens.toLocaleString()}</Table.Td>
                <Table.Td ta="right">{formatUSD(m.cost)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Divider label="Monthly budget" labelPosition="left" />
      <Group align="flex-end">
        <NumberInput
          label="Budget (USD / month)"
          description="0 disables budget alerts"
          value={budgetDraft}
          onChange={(v) => setBudgetDraft(Number(v) || 0)}
          min={0}
          prefix="$"
          decimalScale={2}
          step={5}
          w={220}
        />
        <Button onClick={saveBudget}>Save budget</Button>
      </Group>

      <Divider label="Model pricing ($/1M tokens)" labelPosition="left" />
      <Text size="xs" c="dimmed">
        Relay ships with prices for common OpenAI &amp; Anthropic models. Add an override below
        for custom endpoints or to correct a price — overrides match by substring, longest first.
      </Text>

      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Model</Table.Th>
            <Table.Th>Input</Table.Th>
            <Table.Th>Output</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {Object.entries(overrides).map(([model, p]) => (
            <Table.Tr key={model}>
              <Table.Td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {model} <Badge size="xs" variant="light" color="violet">override</Badge>
              </Table.Td>
              <Table.Td>${p.input}</Table.Td>
              <Table.Td>${p.output}</Table.Td>
              <Table.Td ta="right">
                <ActionIcon variant="subtle" color="red" onClick={() => removeOverride(model)}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
          {/* Add-override row */}
          <Table.Tr>
            <Table.Td>
              <TextInput
                placeholder="model id or substring"
                value={newModel}
                onChange={(e) => setNewModel(e.currentTarget.value)}
                size="xs"
                styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
              />
            </Table.Td>
            <Table.Td>
              <NumberInput placeholder="0.00" value={newInput} onChange={setNewInput} size="xs" min={0} prefix="$" decimalScale={2} w={90} />
            </Table.Td>
            <Table.Td>
              <NumberInput placeholder="0.00" value={newOutput} onChange={setNewOutput} size="xs" min={0} prefix="$" decimalScale={2} w={90} />
            </Table.Td>
            <Table.Td ta="right">
              <Tooltip label="Add override">
                <ActionIcon variant="light" color="violet" onClick={addOverride} disabled={!newModel.trim()}>
                  <IconPlus size={14} />
                </ActionIcon>
              </Tooltip>
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--mantine-color-dimmed)' }}>
          Built-in prices ({Object.keys(basePrices).length})
        </summary>
        <Table mt="sm">
          <Table.Tbody>
            {Object.entries(basePrices).map(([model, p]) => (
              <Table.Tr key={model}>
                <Table.Td style={{ fontFamily: 'monospace', fontSize: 12 }}>{model}</Table.Td>
                <Table.Td>${p.input}</Table.Td>
                <Table.Td>${p.output}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </details>
    </Stack>
  )
}
