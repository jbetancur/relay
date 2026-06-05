// Package stringutil provides string helpers shared across packages.
package stringutil

// Truncate returns s truncated to at most n bytes, appending "…" when cut.
func Truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
