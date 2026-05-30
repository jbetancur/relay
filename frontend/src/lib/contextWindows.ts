// Context-window resolution now lives in the backend (internal/modelmeta), which
// maintains the table and probes providers that expose the value. The frontend
// only layers the user's manual overrides on top of the backend's answer.

/**
 * Apply a user override (exact key or longest substring match) over the window
 * the backend resolved. Override wins; otherwise the backend value is used.
 * Returns null when neither yields a positive window.
 */
export function resolveContextWindow(
  model: string,
  backendWindow: number | null | undefined,
  overrides: Record<string, number> = {}
): number | null {
  if (model && Object.keys(overrides).length > 0) {
    const lower = model.toLowerCase()
    if (overrides[model]) return overrides[model]
    const keys = Object.keys(overrides).sort((a, b) => b.length - a.length)
    for (const k of keys) {
      if (lower.includes(k.toLowerCase())) return overrides[k]
    }
  }
  return backendWindow && backendWindow > 0 ? backendWindow : null
}
