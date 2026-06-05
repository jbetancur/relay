package mcpservers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/johnbetancur/vision/backend/internal/idgen"
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// List returns all servers WITHOUT headers (write-only, like connection keys).
func (s *Store) List() ([]MCPServer, error) {
	rows, err := s.db.Query(`
		SELECT id, name, url, enabled, created_at, updated_at
		FROM mcp_servers ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []MCPServer
	for rows.Next() {
		var m MCPServer
		var enabled int
		if err := rows.Scan(&m.ID, &m.Name, &m.URL, &enabled, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		m.Enabled = enabled == 1
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetByID returns a server including its headers (for editing / for the agent).
func (s *Store) GetByID(id string) (*MCPServer, error) {
	m := &MCPServer{}
	var enabled int
	var headersJSON string
	err := s.db.QueryRow(`
		SELECT id, name, url, headers, enabled, created_at, updated_at
		FROM mcp_servers WHERE id = ?`, id).
		Scan(&m.ID, &m.Name, &m.URL, &headersJSON, &enabled, &m.CreatedAt, &m.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	m.Enabled = enabled == 1
	m.Headers = parseHeaders(headersJSON)
	return m, nil
}

func (s *Store) Create(input MCPServerInput) (*MCPServer, error) {
	input = normalize(input)
	if err := validate(input); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	id := idgen.New()
	_, err := s.db.Exec(`
		INSERT INTO mcp_servers (id, name, url, headers, enabled, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, input.Name, input.URL, marshalHeaders(input.Headers), idgen.BoolToInt(input.Enabled), now, now)
	if err != nil {
		return nil, err
	}
	return s.GetByID(id)
}

func (s *Store) Update(id string, input MCPServerInput) (*MCPServer, error) {
	input = normalize(input)
	if err := validate(input); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	res, err := s.db.Exec(`
		UPDATE mcp_servers SET name=?, url=?, headers=?, enabled=?, updated_at=? WHERE id=?`,
		input.Name, input.URL, marshalHeaders(input.Headers), idgen.BoolToInt(input.Enabled), now, id)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("mcp server not found")
	}
	return s.GetByID(id)
}

func (s *Store) Delete(id string) error {
	res, err := s.db.Exec(`DELETE FROM mcp_servers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("mcp server not found")
	}
	return nil
}

func normalize(input MCPServerInput) MCPServerInput {
	input.Name = strings.TrimSpace(input.Name)
	input.URL = strings.TrimSpace(input.URL)
	return input
}

func validate(input MCPServerInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if !strings.HasPrefix(input.URL, "http://") && !strings.HasPrefix(input.URL, "https://") {
		return fmt.Errorf("url must start with http:// or https://")
	}
	return nil
}

func parseHeaders(s string) map[string]string {
	if s == "" {
		return nil
	}
	var m map[string]string
	if json.Unmarshal([]byte(s), &m) != nil {
		return nil
	}
	return m
}

func marshalHeaders(m map[string]string) string {
	if len(m) == 0 {
		return "{}"
	}
	b, err := json.Marshal(m)
	if err != nil {
		return "{}"
	}
	return string(b)
}
