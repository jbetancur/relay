// Package idgen provides shared ID generation and SQLite bool helpers used
// across all store packages.
package idgen

import (
	"crypto/rand"
	"encoding/hex"
)

// New returns a random 32-char hex string suitable for use as a record ID.
func New() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// BoolToInt converts a bool to the 0/1 integer SQLite expects.
func BoolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
