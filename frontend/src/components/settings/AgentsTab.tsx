import { useEffect, useState } from 'react'
import {
  Stack,
  Button,
  Modal,
  Text,
  Alert,
  Group,
  TextInput,
  Textarea,
  Switch,
  ActionIcon,
  Tooltip,
  Card,
  Badge,
  NumberInput,
  Divider,
  MultiSelect,
  Select,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { openConfirmModal } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconAlertCircle, IconTrash, IconPencil, IconRobot } from '@tabler/icons-react'
import { useAgentsStore } from '@/store/agents'
import { useMCPServersStore } from '@/store/mcpServers'
import { useConnectionsStore } from '@/store'
import { ModelSwitcher } from '@/components/chat/ModelSwitcher'
import type { Agent, AgentBudget, AgentInput } from '@/types'

const BUILTIN_TOOLS = [{ value: 'web_search', label: 'Web search' }]

const EMPTY: AgentInput = {
  name: '',
  model: '',
  instructions: '',
  connectionId: '',
  mcpServerIds: [],
  builtinTools: [],
  maxRounds: 5,
  maxTokensRun: 0,
  maxCostRun: 0,
  enabled: true,
}

export function AgentsTab() {
  const { agents, loading, error, fetch, create, update, remove } = useAgentsStore()
  const { fetch: fetchServers } = useMCPServersStore()
  const [modalOpen, { open, close }] = useDisclosure(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [initial, setInitial] = useState<AgentInput>(EMPTY)
  const [initialBudgets, setInitialBudgets] = useState<AgentBudget[]>([])

  useEffect(() => { fetch() }, [fetch])
  useEffect(() => { fetchServers() }, [fetchServers])

  function openAdd() {
    setEditId(null)
    setInitial(EMPTY)
    setInitialBudgets([])
    open()
  }

  async function openEdit(agent: Agent) {
    setInitial({
      name: agent.name,
      slug: agent.slug,
      model: agent.model,
      instructions: agent.instructions,
      connectionId: agent.connectionId ?? '',
      mcpServerIds: agent.mcpServerIds,
      builtinTools: agent.builtinTools,
      maxRounds: agent.maxRounds,
      maxTokensRun: agent.maxTokensRun,
      maxCostRun: agent.maxCostRun,
      enabled: agent.enabled,
    })
    setEditId(agent.id)
    try {
      const budgets = await useAgentsStore.getState().getBudgets(agent.id)
      setInitialBudgets(budgets ?? [])
    } catch {
      setInitialBudgets([])
    }
    open()
  }

  async function handleSubmit(input: AgentInput, budgetPatches: BudgetPatch[]) {
    try {
      let savedId = editId
      if (editId) {
        await update(editId, input)
        notifications.show({ message: 'Agent updated', color: 'teal' })
      } else {
        const a = await create(input)
        savedId = a.id
        notifications.show({ message: 'Agent created', color: 'teal' })
      }
      // Upsert any budget rows where at least one limit is set.
      if (savedId) {
        for (const patch of budgetPatches) {
          if (patch.limitUsd > 0 || patch.limitTokens > 0) {
            await useAgentsStore.getState().upsertBudget(savedId, patch)
          }
        }
      }
      close()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Error', message: e instanceof Error ? e.message : 'Failed to save' })
    }
  }

  function handleDelete(id: string) {
    openConfirmModal({
      title: 'Delete agent',
      children: <Text size="sm">This removes the agent. Conversations using it will fall back to plain model chat.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove(id).catch((e) =>
        notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Failed to delete' })),
    })
  }

  return (
    <>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Saved agents combine a model, system instructions, tools, and cost caps into a reusable configuration you can attach to any conversation.
        </Text>

        <Button leftSection={<IconPlus size={16} />} variant="light" onClick={openAdd} style={{ alignSelf: 'flex-start' }}>
          New agent
        </Button>

        {error && <Alert icon={<IconAlertCircle size={14} />} color="red">{error}</Alert>}

        {!loading && agents.length === 0 ? (
          <Text size="sm" c="dimmed">No agents yet.</Text>
        ) : (
          agents.map((a) => (
            <Card key={a.id} withBorder padding="sm">
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap="xs">
                    <IconRobot size={14} />
                    <Text fw={500} size="sm">{a.name}</Text>
                    <Badge size="xs" variant="light" color="gray">{a.slug}</Badge>
                    {!a.enabled && <Badge size="xs" color="gray" variant="light">disabled</Badge>}
                  </Group>
                  <Text size="xs" c="dimmed">{a.model}</Text>
                  {a.instructions && (
                    <Text size="xs" c="dimmed" lineClamp={1}>{a.instructions}</Text>
                  )}
                  <Group gap="xs" mt={2}>
                    {a.maxCostRun > 0 && <Badge size="xs" color="green" variant="light">${a.maxCostRun}/run</Badge>}
                    {a.maxTokensRun > 0 && <Badge size="xs" color="blue" variant="light">{a.maxTokensRun.toLocaleString()} tok/run</Badge>}
                  </Group>
                </Stack>
                <Group gap={4} wrap="nowrap">
                  <Tooltip label="Edit"><ActionIcon variant="subtle" onClick={() => openEdit(a)}><IconPencil size={15} /></ActionIcon></Tooltip>
                  <Tooltip label="Delete"><ActionIcon variant="subtle" color="red" onClick={() => handleDelete(a.id)}><IconTrash size={15} /></ActionIcon></Tooltip>
                </Group>
              </Group>
            </Card>
          ))
        )}
      </Stack>

      <Modal opened={modalOpen} onClose={close} title={editId ? 'Edit agent' : 'New agent'} size="lg" scrollAreaComponent={Modal.NativeScrollArea}>
        <AgentForm initial={initial} initialBudgets={initialBudgets} onSubmit={handleSubmit} onCancel={close} />
      </Modal>
    </>
  )
}

// BudgetPatch is what the form collects for one period ceiling.
interface BudgetPatch {
  period: 'day' | 'month'
  limitUsd: number
  limitTokens: number
}

function AgentForm({ initial, initialBudgets, onSubmit, onCancel }: {
  initial: AgentInput
  initialBudgets: AgentBudget[]
  onSubmit: (input: AgentInput, budgetPatches: BudgetPatch[]) => Promise<void>
  onCancel: () => void
}) {
  const { servers } = useMCPServersStore()
  const { connections, getDefault } = useConnectionsStore()
  const defaultConn = getDefault()

  const [name, setName] = useState(initial.name)
  const [model, setModel] = useState(initial.model)
  const [instructions, setInstructions] = useState(initial.instructions)
  const [connectionId, setConnectionId] = useState<string | null>(initial.connectionId || null)
  const [mcpServerIds, setMcpServerIds] = useState<string[]>(initial.mcpServerIds)
  const [builtinTools, setBuiltinTools] = useState<string[]>(initial.builtinTools)
  const [maxRounds, setMaxRounds] = useState<number>(initial.maxRounds)
  const [maxTokensRun, setMaxTokensRun] = useState<number>(initial.maxTokensRun)
  const [maxCostRun, setMaxCostRun] = useState<number>(initial.maxCostRun)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [saving, setSaving] = useState(false)

  // Budget (period ceiling) state — pre-populated from existing budgets.
  const existingDay = initialBudgets.find((b) => b.period === 'day')
  const existingMonth = initialBudgets.find((b) => b.period === 'month')
  const [dayLimitUsd, setDayLimitUsd] = useState<number>(existingDay?.limitUsd ?? 0)
  const [dayLimitTokens, setDayLimitTokens] = useState<number>(existingDay?.limitTokens ?? 0)
  const [monthLimitUsd, setMonthLimitUsd] = useState<number>(existingMonth?.limitUsd ?? 0)
  const [monthLimitTokens, setMonthLimitTokens] = useState<number>(existingMonth?.limitTokens ?? 0)

  const mcpOptions = servers.filter((s) => s.enabled).map((s) => ({ value: s.id, label: s.name }))
  const connOptions = [
    { value: '', label: 'Auto (per-request)' },
    ...connections.filter((c) => c.enabled).map((c) => ({ value: c.id, label: c.name })),
  ]

  async function handleSave() {
    setSaving(true)
    try {
      const budgetPatches: BudgetPatch[] = [
        { period: 'day', limitUsd: dayLimitUsd, limitTokens: dayLimitTokens },
        { period: 'month', limitUsd: monthLimitUsd, limitTokens: monthLimitTokens },
      ]
      await onSubmit(
        {
          name: name.trim(),
          model,
          instructions,
          connectionId: connectionId ?? '',
          mcpServerIds,
          builtinTools,
          maxRounds,
          maxTokensRun,
          maxCostRun,
          enabled,
        },
        budgetPatches,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack gap="sm">
      <TextInput label="Name" required value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="My coding agent" />

      <Stack gap={4}>
        <Text size="sm" fw={500}>Model</Text>
        <ModelSwitcher value={model} onChange={setModel} group="chat" connectionId={connectionId ?? defaultConn?.id} />
      </Stack>

      <Select
        label="Connection"
        description="Pin this agent to a specific connection, or leave auto to resolve per request."
        data={connOptions}
        value={connectionId ?? ''}
        onChange={(v) => setConnectionId(v || null)}
      />

      <Textarea
        label="System instructions"
        value={instructions}
        onChange={(e) => setInstructions(e.currentTarget.value)}
        placeholder="You are a helpful assistant that…"
        autosize minRows={3} maxRows={10}
      />

      <Divider label="Tools" labelPosition="left" />

      <MultiSelect
        label="Built-in tools"
        data={BUILTIN_TOOLS}
        value={builtinTools}
        onChange={setBuiltinTools}
        placeholder="None"
      />

      {mcpOptions.length > 0 && (
        <MultiSelect
          label="MCP servers"
          data={mcpOptions}
          value={mcpServerIds}
          onChange={setMcpServerIds}
          placeholder="None"
        />
      )}

      <Divider label="Cost caps (per run)" labelPosition="left" />

      <Group grow>
        <NumberInput
          label="Max tokens"
          description="0 = no limit"
          value={maxTokensRun}
          onChange={(v) => setMaxTokensRun(typeof v === 'number' ? v : 0)}
          min={0}
          step={1000}
        />
        <NumberInput
          label="Max cost (USD)"
          description="0 = no limit"
          value={maxCostRun}
          onChange={(v) => setMaxCostRun(typeof v === 'number' ? v : 0)}
          min={0}
          step={0.1}
          decimalScale={2}
        />
        <NumberInput
          label="Max rounds"
          description="Tool-call iterations"
          value={maxRounds}
          onChange={(v) => setMaxRounds(typeof v === 'number' ? v : 5)}
          min={1}
          max={20}
        />
      </Group>

      <Divider label="Period ceilings (daily / monthly)" labelPosition="left" />
      <Text size="xs" c="dimmed">Hard limits checked before a run starts. A run is refused when the period total already meets the ceiling. Set to 0 to disable.</Text>

      <Group grow align="flex-start">
        <Stack gap="xs">
          <Text size="sm" fw={500}>Daily</Text>
          <NumberInput
            label="Max USD / day"
            description="0 = no ceiling"
            value={dayLimitUsd}
            onChange={(v) => setDayLimitUsd(typeof v === 'number' ? v : 0)}
            min={0} step={1} decimalScale={2}
          />
          <NumberInput
            label="Max tokens / day"
            description="0 = no ceiling"
            value={dayLimitTokens}
            onChange={(v) => setDayLimitTokens(typeof v === 'number' ? v : 0)}
            min={0} step={10000}
          />
        </Stack>
        <Stack gap="xs">
          <Text size="sm" fw={500}>Monthly</Text>
          <NumberInput
            label="Max USD / month"
            description="0 = no ceiling"
            value={monthLimitUsd}
            onChange={(v) => setMonthLimitUsd(typeof v === 'number' ? v : 0)}
            min={0} step={5} decimalScale={2}
          />
          <NumberInput
            label="Max tokens / month"
            description="0 = no ceiling"
            value={monthLimitTokens}
            onChange={(v) => setMonthLimitTokens(typeof v === 'number' ? v : 0)}
            min={0} step={100000}
          />
        </Stack>
      </Group>

      <Switch label="Enabled" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />

      <Group justify="flex-end" mt="xs">
        <Button variant="subtle" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} loading={saving} disabled={!name.trim() || !model}>Save</Button>
      </Group>
    </Stack>
  )
}
