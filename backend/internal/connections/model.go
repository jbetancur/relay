package connections

// TypeHint helps the UI show appropriate defaults per provider.
type TypeHint string

const (
	TypeOpenAI    TypeHint = "openai"
	TypeOllama    TypeHint = "ollama"
	TypeAnthropic TypeHint = "anthropic"
	TypeCustom    TypeHint = "custom"
)

type Connection struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	BaseURL   string   `json:"baseUrl"`
	APIKey    string   `json:"apiKey,omitempty"`
	TypeHint  TypeHint `json:"typeHint"`
	Enabled   bool     `json:"enabled"`
	IsDefault bool     `json:"isDefault"`
	CreatedAt int64    `json:"createdAt"`
	UpdatedAt int64    `json:"updatedAt"`
}

type ConnectionInput struct {
	Name      string   `json:"name"`
	BaseURL   string   `json:"baseUrl"`
	APIKey    string   `json:"apiKey"`
	TypeHint  TypeHint `json:"typeHint"`
	Enabled   bool     `json:"enabled"`
	IsDefault bool     `json:"isDefault"`
}
