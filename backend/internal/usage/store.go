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

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Record atomically upserts usage for a connection.
func (s *Store) Record(connectionID string, promptTokens, completionTokens int64) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(`
		INSERT INTO connection_stats (connection_id, request_count, prompt_tokens, completion_tokens, updated_at)
		VALUES (?, 1, ?, ?, ?)
		ON CONFLICT(connection_id) DO UPDATE SET
			request_count     = request_count + 1,
			prompt_tokens     = prompt_tokens + excluded.prompt_tokens,
			completion_tokens = completion_tokens + excluded.completion_tokens,
			updated_at        = excluded.updated_at
	`, connectionID, promptTokens, completionTokens, now)
	return err
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

// Reset clears all stats for a connection.
func (s *Store) Reset(connectionID string) error {
	_, err := s.db.Exec(`DELETE FROM connection_stats WHERE connection_id = ?`, connectionID)
	return err
}
