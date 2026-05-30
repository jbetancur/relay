import { Tooltip, Box, Text } from '@mantine/core'
import type { ContextStrategy } from '@/types'

interface ContextGaugeProps {
  usedTokens: number
  contextWindow: number | null
  strategy: ContextStrategy
}

const STRATEGY_NOTE: Record<ContextStrategy, string> = {
  none: 'Sending the full history. At the limit the request will fail.',
  window: 'Oldest messages are dropped to stay within budget.',
  summarize: 'Oldest messages are summarized to stay within budget.',
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Live context-usage gauge: shows how full the model's context window is for the
// current conversation, so the user can decide before hitting the wall.
export function ContextGauge({ usedTokens, contextWindow, strategy }: ContextGaugeProps) {
  if (usedTokens <= 0) return null

  // Unknown window: show used tokens only, with a hint to set an override.
  if (contextWindow == null) {
    return (
      <Tooltip
        withArrow
        multiline
        w={240}
        label={`~${usedTokens.toLocaleString()} tokens. Context window for this model is unknown — set an override in Settings → Context to enable the gauge.`}
      >
        <Box style={{ cursor: 'default' }}>
          <Text size="xs" c="dimmed" ff="monospace">~{fmt(usedTokens)} tok</Text>
        </Box>
      </Tooltip>
    )
  }

  const pct = Math.min(100, Math.round((usedTokens / contextWindow) * 100))
  const color = pct >= 90 ? 'var(--mantine-color-red-6)'
    : pct >= 70 ? 'var(--mantine-color-yellow-6)'
    : 'var(--mantine-color-teal-6)'

  return (
    <Tooltip
      withArrow
      multiline
      w={260}
      label={`${usedTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${pct}%). ${STRATEGY_NOTE[strategy]}`}
    >
      <Box style={{ cursor: 'default', minWidth: 96 }}>
        <Text size="xs" c="dimmed" ff="monospace" ta="right" mb={2}>
          {fmt(usedTokens)} / {fmt(contextWindow)} · {pct}%
        </Text>
        <Box
          style={{
            height: 4,
            borderRadius: 2,
            background: 'var(--mantine-color-default-border)',
            overflow: 'hidden',
          }}
        >
          <Box style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 150ms' }} />
        </Box>
      </Box>
    </Tooltip>
  )
}
