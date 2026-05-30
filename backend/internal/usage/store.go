package usage

import (
	"database/sql"
	"time"
)

type Stats struct {
	ConnectionID     string `json:"connectionId"`
	RequestCount     int64  `json:"requestCount"`
	PromptTokens     int64  `json:"promptTokens"`
	CompletionTokens int64  `json:"completionTokens"`
	TotalTokens      int64  `json:"totalTokens"`
	UpdatedAt        int64  `json:"updatedAt"`
}

// ModelUsage is per-model token usage within an optional time window.
type ModelUsage struct {
	ConnectionID     string `json:"connectionId"`
	Model            string `json:"model"`
	RequestCount     int64  `json:"requestCount"`
	PromptTokens     int64  `json:"promptTokens"`
	CompletionTokens int64  `json:"completionTokens"`
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Record atomically upserts running totals for a connection and appends a
// per-model usage event for cost/budget reporting. The model may be empty when
// the upstream response omitted it.
func (s *Store) Record(connectionID, model string, promptTokens, completionTokens int64) error {
	now := time.Now().UnixMilli()
	if _, err := s.db.Exec(`
		INSERT INTO connection_stats (connection_id, request_count, prompt_tokens, completion_tokens, updated_at)
		VALUES (?, 1, ?, ?, ?)
		ON CONFLICT(connection_id) DO UPDATE SET
			request_count     = request_count + 1,
			prompt_tokens     = prompt_tokens + excluded.prompt_tokens,
			completion_tokens = completion_tokens + excluded.completion_tokens,
			updated_at        = excluded.updated_at
	`, connectionID, promptTokens, completionTokens, now); err != nil {
		return err
	}

	_, err := s.db.Exec(`
		INSERT INTO usage_events (connection_id, model, prompt_tokens, completion_tokens, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, connectionID, model, promptTokens, completionTokens, now)
	return err
}

// UsageByModel returns per-model token totals across all connections for events
// at or after sinceMillis (pass 0 for all time). Used to compute cost client-side.
func (s *Store) UsageByModel(sinceMillis int64) ([]ModelUsage, error) {
	rows, err := s.db.Query(`
		SELECT connection_id, model, COUNT(*), COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0)
		FROM usage_events
		WHERE created_at >= ?
		GROUP BY connection_id, model
		ORDER BY connection_id, model
	`, sinceMillis)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ModelUsage
	for rows.Next() {
		var m ModelUsage
		if err := rows.Scan(&m.ConnectionID, &m.Model, &m.RequestCount, &m.PromptTokens, &m.CompletionTokens); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Get returns stats for a single connection. Returns zero-value Stats if none recorded yet.
func (s *Store) Get(connectionID string) (Stats, error) {
	row := s.db.QueryRow(`
		SELECT connection_id, request_count, prompt_tokens, completion_tokens, updated_at
		FROM connection_stats WHERE connection_id = ?
	`, connectionID)

	var st Stats
	err := row.Scan(&st.ConnectionID, &st.RequestCount, &st.PromptTokens, &st.CompletionTokens, &st.UpdatedAt)
	if err == sql.ErrNoRows {
		st.ConnectionID = connectionID
		return st, nil
	}
	if err != nil {
		return st, err
	}
	st.TotalTokens = st.PromptTokens + st.CompletionTokens
	return st, nil
}

// Reset clears all stats and usage events for a connection.
func (s *Store) Reset(connectionID string) error {
	if _, err := s.db.Exec(`DELETE FROM connection_stats WHERE connection_id = ?`, connectionID); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM usage_events WHERE connection_id = ?`, connectionID)
	return err
}
