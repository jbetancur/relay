package mcpservers

// MCPServer is a configured remote MCP server. Headers are returned only via the
// single-GET response (for editing); the list response omits them.
type MCPServer struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers,omitempty"`
	Enabled   bool              `json:"enabled"`
	CreatedAt int64             `json:"createdAt"`
	UpdatedAt int64             `json:"updatedAt"`
}

type MCPServerInput struct {
	Name    string            `json:"name"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Enabled bool              `json:"enabled"`
}
