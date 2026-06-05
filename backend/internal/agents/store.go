package agents

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/johnbetancur/vision/backend/internal/idgen"
)

// Store handles agent and budget persistence.
type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// ── Agents ───────────────────────────────────────────────────────────────────

func (s *Store) List() ([]Agent, error) {
	rows, err := s.db.Query(`
		SELECT id, slug, name, model, instructions, COALESCE(connection_id,''),
		       mcp_server_ids, builtin_tools,
		       max_rounds, max_tokens_run, max_cost_run, enabled, created_at, updated_at
		FROM agents ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Agent
	for rows.Next() {
		a, err := scanAgentRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) GetByID(id string) (*Agent, error) {
	row := s.db.QueryRow(`
		SELECT id, slug, name, model, instructions, COALESCE(connection_id,''),
		       mcp_server_ids, builtin_tools,
		       max_rounds, max_tokens_run, max_cost_run, enabled, created_at, updated_at
		FROM agents WHERE id = ?`, id)
	a, err := scanAgentRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &a, err
}

func (s *Store) GetBySlug(slug string) (*Agent, error) {
	row := s.db.QueryRow(`
		SELECT id, slug, name, model, instructions, COALESCE(connection_id,''),
		       mcp_server_ids, builtin_tools,
		       max_rounds, max_tokens_run, max_cost_run, enabled, created_at, updated_at
		FROM agents WHERE slug = ?`, slug)
	a, err := scanAgentRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &a, err
}

func (s *Store) Create(input AgentInput) (*Agent, error) {
	input = normalizeAgent(input)
	slug, err := s.resolveSlug(input.Slug, input.Name, "")
	if err != nil {
		return nil, err
	}
	if err := validateAgent(input); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	id := idgen.New()
	connID := nullableString(input.ConnectionID)
	_, err = s.db.Exec(`
		INSERT INTO agents
		  (id, slug, name, model, instructions, connection_id,
		   mcp_server_ids, builtin_tools,
		   max_rounds, max_tokens_run, max_cost_run, enabled, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		id, slug, input.Name, input.Model, input.Instructions, connID,
		marshalStringSlice(input.MCPServerIDs),
		marshalStringSlice(input.BuiltinTools),
		input.MaxRounds, input.MaxTokensRun, input.MaxCostRun,
		idgen.BoolToInt(input.Enabled), now, now)
	if err != nil {
		return nil, err
	}
	return s.GetByID(id)
}

func (s *Store) Update(id string, input AgentInput) (*Agent, error) {
	existing, err := s.GetByID(id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, fmt.Errorf("agent not found")
	}
	input = normalizeAgent(input)
	slug, err := s.resolveSlug(input.Slug, input.Name, id)
	if err != nil {
		return nil, err
	}
	if err := validateAgent(input); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	connID := nullableString(input.ConnectionID)
	res, err := s.db.Exec(`
		UPDATE agents SET
		  slug=?, name=?, model=?, instructions=?, connection_id=?,
		  mcp_server_ids=?, builtin_tools=?,
		  max_rounds=?, max_tokens_run=?, max_cost_run=?, enabled=?, updated_at=?
		WHERE id=?`,
		slug, input.Name, input.Model, input.Instructions, connID,
		marshalStringSlice(input.MCPServerIDs),
		marshalStringSlice(input.BuiltinTools),
		input.MaxRounds, input.MaxTokensRun, input.MaxCostRun,
		idgen.BoolToInt(input.Enabled), now, id)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("agent not found")
	}
	return s.GetByID(id)
}

func (s *Store) Delete(id string) error {
	res, err := s.db.Exec(`DELETE FROM agents WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("agent not found")
	}
	return nil
}

// ── Budgets ──────────────────────────────────────────────────────────────────

func (s *Store) GetBudgets(subjectType, subjectID string) ([]Budget, error) {
	rows, err := s.db.Query(`
		SELECT id, subject_type, subject_id, period, limit_usd, limit_tokens, created_at, updated_at
		FROM budgets WHERE subject_type=? AND subject_id=?
		ORDER BY period ASC`, subjectType, subjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Budget
	for rows.Next() {
		var b Budget
		if err := rows.Scan(&b.ID, &b.SubjectType, &b.SubjectID, &b.Period,
			&b.LimitUSD, &b.LimitTokens, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) UpsertBudget(subjectType, subjectID string, input BudgetInput) (*Budget, error) {
	if input.Period != "day" && input.Period != "month" {
		return nil, fmt.Errorf("period must be 'day' or 'month'")
	}
	now := time.Now().UnixMilli()

	var existing Budget
	err := s.db.QueryRow(`
		SELECT id, subject_type, subject_id, period, limit_usd, limit_tokens, created_at, updated_at
		FROM budgets WHERE subject_type=? AND subject_id=? AND period=?`,
		subjectType, subjectID, input.Period).
		Scan(&existing.ID, &existing.SubjectType, &existing.SubjectID, &existing.Period,
			&existing.LimitUSD, &existing.LimitTokens, &existing.CreatedAt, &existing.UpdatedAt)

	if err == sql.ErrNoRows {
		id := idgen.New()
		_, err = s.db.Exec(`
			INSERT INTO budgets (id, subject_type, subject_id, period, limit_usd, limit_tokens, created_at, updated_at)
			VALUES (?,?,?,?,?,?,?,?)`,
			id, subjectType, subjectID, input.Period, input.LimitUSD, input.LimitTokens, now, now)
		if err != nil {
			return nil, err
		}
		return &Budget{
			ID: id, SubjectType: subjectType, SubjectID: subjectID,
			Period: input.Period, LimitUSD: input.LimitUSD, LimitTokens: input.LimitTokens,
			CreatedAt: now, UpdatedAt: now,
		}, nil
	}
	if err != nil {
		return nil, err
	}

	_, err = s.db.Exec(`
		UPDATE budgets SET limit_usd=?, limit_tokens=?, updated_at=?
		WHERE subject_type=? AND subject_id=? AND period=?`,
		input.LimitUSD, input.LimitTokens, now, subjectType, subjectID, input.Period)
	if err != nil {
		return nil, err
	}
	existing.LimitUSD = input.LimitUSD
	existing.LimitTokens = input.LimitTokens
	existing.UpdatedAt = now
	return &existing, nil
}

// ── Helpers ──────────────────────────────────────────────────────────────────

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// resolveSlug returns a valid unique slug. If the caller supplied one, validate
// and use it. Otherwise derive from name. currentID is the agent being updated
// (empty on create) so its own slug doesn't count as a collision.
func (s *Store) resolveSlug(supplied, name, currentID string) (string, error) {
	base := supplied
	if base == "" {
		base = slugRe.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-")
		base = strings.Trim(base, "-")
	}
	if base == "" {
		return "", fmt.Errorf("could not derive slug from name")
	}

	candidate := base
	for i := 2; ; i++ {
		var existingID string
		err := s.db.QueryRow(`SELECT id FROM agents WHERE slug=?`, candidate).Scan(&existingID)
		if err == sql.ErrNoRows {
			return candidate, nil
		}
		if err != nil {
			return "", err
		}
		if existingID == currentID {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s-%d", base, i)
	}
}

func validateAgent(input AgentInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if strings.TrimSpace(input.Model) == "" {
		return fmt.Errorf("model is required")
	}
	if input.MaxRounds < 0 {
		return fmt.Errorf("maxRounds must be >= 0")
	}
	return nil
}

func normalizeAgent(input AgentInput) AgentInput {
	input.Name = strings.TrimSpace(input.Name)
	input.Model = strings.TrimSpace(input.Model)
	input.Slug = strings.TrimSpace(input.Slug)
	if input.MCPServerIDs == nil {
		input.MCPServerIDs = []string{}
	}
	if input.BuiltinTools == nil {
		input.BuiltinTools = []string{}
	}
	if input.MaxRounds == 0 {
		input.MaxRounds = 5
	}
	return input
}

func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func marshalStringSlice(ss []string) string {
	if len(ss) == 0 {
		return "[]"
	}
	b, _ := json.Marshal(ss)
	return string(b)
}

func parseStringSlice(s string) []string {
	if s == "" {
		return []string{}
	}
	var out []string
	if json.Unmarshal([]byte(s), &out) != nil {
		return []string{}
	}
	return out
}

// scanner is satisfied by both *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanAgentRow(r scanner) (Agent, error) {
	var a Agent
	var enabled int
	var mcpJSON, builtinJSON string
	err := r.Scan(
		&a.ID, &a.Slug, &a.Name, &a.Model, &a.Instructions, &a.ConnectionID,
		&mcpJSON, &builtinJSON,
		&a.MaxRounds, &a.MaxTokensRun, &a.MaxCostRun,
		&enabled, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return Agent{}, err
	}
	a.Enabled = enabled == 1
	a.MCPServerIDs = parseStringSlice(mcpJSON)
	a.BuiltinTools = parseStringSlice(builtinJSON)
	return a, nil
}
