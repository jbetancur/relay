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
CREATE TABLE IF NOT EXISTS usage_events (
	id                INTEGER PRIMARY KEY AUTOINCREMENT,
	connection_id     TEXT NOT NULL,
	model             TEXT NOT NULL DEFAULT '',
	prompt_tokens     INTEGER NOT NULL DEFAULT 0,
	completion_tokens INTEGER NOT NULL DEFAULT 0,
	created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_conn_model ON usage_events(connection_id, model);

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
	return db, nil
}
