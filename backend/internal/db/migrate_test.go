package db

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// TestMigrate_AddsAgentIDToExistingDB simulates an old database that shipped
// usage_events without agent_id (the pre-agent shape, with no dependent index),
// then verifies Open() migrates it additively without losing existing rows.
func TestMigrate_AddsAgentIDToExistingDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")

	// Build the legacy usage_events table directly (no agent_id, no agent index),
	// matching what an old binary would have created, and insert a legacy row.
	old, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	if _, err := old.Exec(`
		CREATE TABLE usage_events (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			connection_id     TEXT NOT NULL,
			model             TEXT NOT NULL DEFAULT '',
			prompt_tokens     INTEGER NOT NULL DEFAULT 0,
			completion_tokens INTEGER NOT NULL DEFAULT 0,
			created_at        INTEGER NOT NULL
		);
		INSERT INTO usage_events (connection_id, model, prompt_tokens, completion_tokens, created_at)
		VALUES ('c1','m',10,20,1);
	`); err != nil {
		t.Fatalf("seed legacy table: %v", err)
	}
	old.Close()

	// Open() runs the full schema (CREATE TABLE IF NOT EXISTS is a no-op on the
	// existing table) then migrate(), which must add the column + index back
	// without error or data loss.
	d2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen/migrate: %v", err)
	}
	defer d2.Close()

	if !hasColumn(d2, "usage_events", "agent_id") {
		t.Fatal("agent_id column missing after migrate")
	}
	var agentID string
	var pt int64
	if err := d2.QueryRow(`SELECT agent_id, prompt_tokens FROM usage_events WHERE connection_id='c1'`).Scan(&agentID, &pt); err != nil {
		t.Fatalf("read migrated row: %v", err)
	}
	if agentID != "" || pt != 10 {
		t.Fatalf("migrated row = agent_id=%q prompt=%d, want ''/10", agentID, pt)
	}
}
