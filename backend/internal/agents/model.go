package agents

// Agent is a saved, reusable agent configuration.
type Agent struct {
	ID           string   `json:"id"`
	Slug         string   `json:"slug"`
	Name         string   `json:"name"`
	Model        string   `json:"model"`
	Instructions string   `json:"instructions"`
	ConnectionID string   `json:"connectionId,omitempty"`
	MCPServerIDs []string `json:"mcpServerIds"`
	BuiltinTools []string `json:"builtinTools"`
	MaxRounds    int      `json:"maxRounds"`
	MaxTokensRun int64    `json:"maxTokensRun"`
	MaxCostRun   float64  `json:"maxCostRun"`
	Enabled      bool     `json:"enabled"`
	CreatedAt    int64    `json:"createdAt"`
	UpdatedAt    int64    `json:"updatedAt"`
}

// AgentInput is the create/update payload from the client.
type AgentInput struct {
	Name         string   `json:"name"`
	Slug         string   `json:"slug,omitempty"` // auto-generated from name if blank
	Model        string   `json:"model"`
	Instructions string   `json:"instructions"`
	ConnectionID string   `json:"connectionId,omitempty"`
	MCPServerIDs []string `json:"mcpServerIds"`
	BuiltinTools []string `json:"builtinTools"`
	MaxRounds    int      `json:"maxRounds"`
	MaxTokensRun int64    `json:"maxTokensRun"`
	MaxCostRun   float64  `json:"maxCostRun"`
	Enabled      bool     `json:"enabled"`
}

// Budget is a period spending ceiling for an agent (or future: user/workspace).
type Budget struct {
	ID          string  `json:"id"`
	SubjectType string  `json:"subjectType"`
	SubjectID   string  `json:"subjectId"`
	Period      string  `json:"period"` // "day" | "month"
	LimitUSD    float64 `json:"limitUsd"`
	LimitTokens int64   `json:"limitTokens"`
	CreatedAt   int64   `json:"createdAt"`
	UpdatedAt   int64   `json:"updatedAt"`
}

// BudgetInput is the upsert payload for a budget.
type BudgetInput struct {
	Period      string  `json:"period"`
	LimitUSD    float64 `json:"limitUsd"`
	LimitTokens int64   `json:"limitTokens"`
}
