package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS connections (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	base_url    TEXT NOT NULL,
	api_key     TEXT NOT NULL DEFAULT '',
	type_hint   TEXT NOT NULL DEFAULT 'openai',
	enabled     INTEGER NOT NULL DEFAULT 1,
	is_default  INTEGER NOT NULL DEFAULT 0,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connection_stats (
	connection_id    TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
	request_count    INTEGER NOT NULL DEFAULT 0,
	prompt_tokens    INTEGER NOT NULL DEFAULT 0,
	completion_tokens INTEGER NOT NULL DEFAULT 0,
	updated_at       INTEGER NOT NULL DEFAULT 0
);

-- Per-model, per-request usage events. Powers accurate cost reporting and
-- month-to-date budgets (connection_stats only holds running totals).
-- agent_id is '' for non-agent (proxy) traffic; set when an agent run records
-- usage, so per-agent period ceilings can be summed with an indexed range scan.
CREATE TABLE IF NOT EXISTS usage_events (
	id                INTEGER PRIMARY KEY AUTOINCREMENT,
	connection_id     TEXT NOT NULL,
	agent_id          TEXT NOT NULL DEFAULT '',
	model             TEXT NOT NULL DEFAULT '',
	prompt_tokens     INTEGER NOT NULL DEFAULT 0,
	completion_tokens INTEGER NOT NULL DEFAULT 0,
	created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_conn_model ON usage_events(connection_id, model);
-- NOTE: the agent_id column and its index idx_usage_events_agent_created are
-- created in migrate() (after the ADD COLUMN), not here — on a legacy DB the
-- table pre-exists without agent_id, so an index referencing it must run after
-- the column is added.

-- Remote MCP servers (Streamable HTTP). headers is a JSON object of static
-- request headers (e.g. auth), stored server-side and never returned to clients.
CREATE TABLE IF NOT EXISTS mcp_servers (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	url         TEXT NOT NULL,
	headers     TEXT NOT NULL DEFAULT '{}',
	enabled     INTEGER NOT NULL DEFAULT 1,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);

-- Saved agents: reusable model + instructions + allowed tools + per-run caps.
-- connection_id is nullable (NULL = resolve per-request); no FK so agents survive
-- a deleted connection and fall back to request-level resolution.
CREATE TABLE IF NOT EXISTS agents (
	id             TEXT PRIMARY KEY,
	slug           TEXT NOT NULL UNIQUE,
	name           TEXT NOT NULL,
	model          TEXT NOT NULL,
	instructions   TEXT NOT NULL DEFAULT '',
	connection_id  TEXT,
	mcp_server_ids TEXT NOT NULL DEFAULT '[]',
	builtin_tools  TEXT NOT NULL DEFAULT '[]',
	max_rounds     INTEGER NOT NULL DEFAULT 5,
	max_tokens_run INTEGER NOT NULL DEFAULT 0,
	max_cost_run   REAL    NOT NULL DEFAULT 0,
	enabled        INTEGER NOT NULL DEFAULT 1,
	created_at     INTEGER NOT NULL,
	updated_at     INTEGER NOT NULL
);

-- Polymorphic period ceilings. v1 writes only subject_type='agent'.
-- Future paid tier inserts 'user'/'workspace' rows — additive, no migration.
CREATE TABLE IF NOT EXISTS budgets (
	id           TEXT PRIMARY KEY,
	subject_type TEXT NOT NULL,
	subject_id   TEXT NOT NULL,
	period       TEXT NOT NULL,
	limit_usd    REAL    NOT NULL DEFAULT 0,
	limit_tokens INTEGER NOT NULL DEFAULT 0,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL,
	UNIQUE(subject_type, subject_id, period)
);
CREATE INDEX IF NOT EXISTS idx_budgets_subject ON budgets(subject_type, subject_id);
`

func Open(path string) (*sql.DB, error) {
	dsn := path + "?_journal_mode=WAL&_foreign_keys=on"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(schema); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if err = migrate(db); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

// migrate applies idempotent, additive schema changes that CREATE TABLE IF NOT
// EXISTS can't make to a pre-existing table (e.g. adding a column on an
// already-initialized database). Each step tolerates "already applied".
func migrate(db *sql.DB) error {
	// usage_events.agent_id: added after the table shipped without it.
	if !hasColumn(db, "usage_events", "agent_id") {
		if _, err := db.Exec(`ALTER TABLE usage_events ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	// Index creation is already idempotent via IF NOT EXISTS in schema; re-run
	// here so it exists even when the column was just added on an old DB.
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_usage_events_agent_created ON usage_events(agent_id, created_at)`); err != nil {
		return err
	}
	return nil
}

// hasColumn reports whether table has a column of the given name.
func hasColumn(db *sql.DB, table, column string) bool {
	rows, err := db.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil && name == column {
			return true
		}
	}
	return false
}
