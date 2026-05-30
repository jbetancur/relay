package connections

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) List() ([]Connection, error) {
	rows, err := s.db.Query(`
		SELECT id, name, base_url, type_hint, enabled, is_default, created_at, updated_at
		FROM connections ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Connection
	for rows.Next() {
		var c Connection
		var enabled, isDefault int
		if err := rows.Scan(&c.ID, &c.Name, &c.BaseURL, &c.TypeHint,
			&enabled, &isDefault, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.Enabled = enabled == 1
		c.IsDefault = isDefault == 1
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetByID(id string) (*Connection, error) {
	c := &Connection{}
	var enabled, isDefault int
	err := s.db.QueryRow(`
		SELECT id, name, base_url, api_key, type_hint, enabled, is_default, created_at, updated_at
		FROM connections WHERE id = ?`, id).
		Scan(&c.ID, &c.Name, &c.BaseURL, &c.APIKey, &c.TypeHint,
			&enabled, &isDefault, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.Enabled = enabled == 1
	c.IsDefault = isDefault == 1
	return c, nil
}

func (s *Store) GetDefault() (*Connection, error) {
	c := &Connection{}
	var enabled, isDefault int
	err := s.db.QueryRow(`
		SELECT id, name, base_url, api_key, type_hint, enabled, is_default, created_at, updated_at
		FROM connections WHERE is_default = 1 AND enabled = 1 LIMIT 1`).
		Scan(&c.ID, &c.Name, &c.BaseURL, &c.APIKey, &c.TypeHint,
			&enabled, &isDefault, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		// Fall back to any enabled connection
		err = s.db.QueryRow(`
			SELECT id, name, base_url, api_key, type_hint, enabled, is_default, created_at, updated_at
			FROM connections WHERE enabled = 1 ORDER BY created_at ASC LIMIT 1`).
			Scan(&c.ID, &c.Name, &c.BaseURL, &c.APIKey, &c.TypeHint,
				&enabled, &isDefault, &c.CreatedAt, &c.UpdatedAt)
	}
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.Enabled = enabled == 1
	c.IsDefault = isDefault == 1
	return c, nil
}

func (s *Store) Create(input ConnectionInput) (*Connection, error) {
	input = normalize(input)
	if err := validate(input); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	id := newID()

	if input.IsDefault {
		if _, err := s.db.Exec(`UPDATE connections SET is_default = 0`); err != nil {
			return nil, err
		}
	}

	_, err := s.db.Exec(`
		INSERT INTO connections (id, name, base_url, api_key, type_hint, enabled, is_default, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, input.Name, input.BaseURL, input.APIKey, string(input.TypeHint),
		boolToInt(input.Enabled), boolToInt(input.IsDefault), now, now)
	if err != nil {
		return nil, err
	}
	return s.GetByID(id)
}

func (s *Store) Update(id string, input ConnectionInput) (*Connection, error) {
	input = normalize(input)
	if err := validate(input); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()

	if input.IsDefault {
		if _, err := s.db.Exec(`UPDATE connections SET is_default = 0 WHERE id != ?`, id); err != nil {
			return nil, err
		}
	}

	res, err := s.db.Exec(`
		UPDATE connections
		SET name=?, base_url=?, api_key=?, type_hint=?, enabled=?, is_default=?, updated_at=?
		WHERE id=?`,
		input.Name, input.BaseURL, input.APIKey, string(input.TypeHint),
		boolToInt(input.Enabled), boolToInt(input.IsDefault), now, id)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("connection not found")
	}
	return s.GetByID(id)
}

func (s *Store) Delete(id string) error {
	res, err := s.db.Exec(`DELETE FROM connections WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("connection not found")
	}
	return nil
}

// Seed inserts a default connection only if the table is empty.
func (s *Store) Seed(name, baseURL, apiKey string) error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM connections`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err := s.Create(ConnectionInput{
		Name:      name,
		BaseURL:   baseURL,
		APIKey:    apiKey,
		TypeHint:  TypeOpenAI,
		Enabled:   true,
		IsDefault: true,
	})
	return err
}

// normalize trims surrounding whitespace from free-text fields. Pasted API keys
// and URLs commonly pick up trailing spaces or newlines that break auth.
func normalize(input ConnectionInput) ConnectionInput {
	input.Name = strings.TrimSpace(input.Name)
	input.BaseURL = strings.TrimSpace(input.BaseURL)
	input.APIKey = strings.TrimSpace(input.APIKey)
	return input
}

func validate(input ConnectionInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if !strings.HasPrefix(input.BaseURL, "http://") && !strings.HasPrefix(input.BaseURL, "https://") {
		return fmt.Errorf("baseUrl must start with http:// or https://")
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
