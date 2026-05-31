import { useRef, useState, useEffect } from 'react'
import { ActionIcon, Tooltip, Group } from '@mantine/core'
import {
  IconX,
  IconCode,
  IconBrowser,
  IconRefresh,
  IconExternalLink,
} from '@tabler/icons-react'
import classes from './ArtifactPanel.module.css'

export type ArtifactType = 'html' | 'svg' | 'react' | 'code'

export interface Artifact {
  id: string
  type: ArtifactType
  lang?: string
  code: string
  title: string
}

interface ArtifactPanelProps {
  artifacts: Artifact[]
  activeId: string | null
  onSelectArtifact: (id: string) => void
  onClose: () => void
}

export function ArtifactPanel({ artifacts, activeId, onSelectArtifact, onClose }: ArtifactPanelProps) {
  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[artifacts.length - 1]
  const [view, setView] = useState<'preview' | 'code'>('preview')

  // Reset to preview when artifact changes
  useEffect(() => {
    setView('preview')
  }, [active?.id])

  if (!active) return null

  const canPreview = active.type === 'html' || active.type === 'svg'

  return (
    <div className={classes.panel}>
      {/* Tab strip */}
      <div className={classes.header}>
        <div className={classes.tabs}>
          {artifacts.map((a) => (
            <button
              key={a.id}
              className={classes.tab}
              data-active={a.id === active.id ? 'true' : 'false'}
              onClick={() => onSelectArtifact(a.id)}
              aria-selected={a.id === active.id}
              role="tab"
            >
              <IconCode size={12} />
              <span className={classes.tabLabel}>{a.title}</span>
            </button>
          ))}
        </div>
        <Tooltip label="Close panel">
          <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close artifact panel">
            <IconX size={14} />
          </ActionIcon>
        </Tooltip>
      </div>

      {/* Preview / Code toggle */}
      {canPreview && (
        <div className={classes.previewToolbar}>
          <Group gap={4}>
            <Tooltip label="Preview">
              <ActionIcon
                size="sm"
                variant={view === 'preview' ? 'filled' : 'subtle'}
                color={view === 'preview' ? 'violet' : 'gray'}
                onClick={() => setView('preview')}
                aria-label="Preview artifact"
                aria-pressed={view === 'preview'}
              >
                <IconBrowser size={13} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Source">
              <ActionIcon
                size="sm"
                variant={view === 'code' ? 'filled' : 'subtle'}
                color={view === 'code' ? 'violet' : 'gray'}
                onClick={() => setView('code')}
                aria-label="View source code"
                aria-pressed={view === 'code'}
              >
                <IconCode size={13} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Tooltip label="Open in new tab">
            <ActionIcon
              size="sm"
              variant="subtle"
              onClick={() => openInNewTab(active)}
              aria-label="Open artifact in new tab"
            >
              <IconExternalLink size={13} />
            </ActionIcon>
          </Tooltip>
        </div>
      )}

      {/* Content */}
      <div className={classes.content}>
        {canPreview && view === 'preview' ? (
          <ArtifactPreview artifact={active} />
        ) : (
          <ArtifactCode artifact={active} />
        )}
      </div>
    </div>
  )
}

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [key, setKey] = useState(0)

  const srcDoc = artifact.type === 'svg'
    ? `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${artifact.code}</body></html>`
    : artifact.code

  return (
    <>
      <Tooltip label="Reload">
        <ActionIcon
          size="xs"
          variant="subtle"
          style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}
          onClick={() => setKey((k) => k + 1)}
          aria-label="Reload preview"
        >
          <IconRefresh size={12} />
        </ActionIcon>
      </Tooltip>
      <iframe
        key={key}
        ref={iframeRef}
        className={classes.iframe}
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-same-origin"
        title={artifact.title}
      />
    </>
  )
}

function ArtifactCode({ artifact }: { artifact: Artifact }) {
  return (
    <pre style={{
      margin: 0,
      padding: '12px 16px',
      fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace",
      fontSize: '0.82em',
      lineHeight: 1.6,
      overflowY: 'auto',
      height: '100%',
      background: '#1e1e2e',
      color: '#cdd6f4',
      boxSizing: 'border-box',
    }}>
      <code>{artifact.code}</code>
    </pre>
  )
}

function openInNewTab(artifact: Artifact) {
  const srcDoc = artifact.type === 'svg'
    ? `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${artifact.code}</body></html>`
    : artifact.code
  const blob = new Blob([srcDoc], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ── Artifact extraction ────────────────────────────────────────────────────────

const RENDERABLE = new Set(['html', 'svg', 'jsx', 'tsx'])
const MIN_LINES = 4

export function extractArtifacts(messages: Array<{ id: string; role: string; content: unknown }>): Artifact[] {
  const artifacts: Artifact[] = []

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const text = typeof msg.content === 'string'
      ? msg.content
      : (msg.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? ''

    const fenceRe = /```(\w+)?\n([\s\S]*?)```/g
    let match: RegExpExecArray | null
    let idx = 0
    while ((match = fenceRe.exec(text)) !== null) {
      const lang = (match[1] ?? '').toLowerCase()
      const code = match[2].trim()
      if (!lang || !RENDERABLE.has(lang)) continue
      if (code.split('\n').length < MIN_LINES) continue
      idx++
      artifacts.push({
        id: `${msg.id}-${idx}`,
        type: lang === 'jsx' || lang === 'tsx' ? 'react' : lang as ArtifactType,
        lang,
        code,
        title: `${lang.toUpperCase()} ${artifacts.length + 1}`,
      })
    }
  }

  return artifacts
}
