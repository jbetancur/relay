// Package tools defines the server-side tools the agent loop can call and a
// registry that exposes their OpenAI-compatible specs and executes calls.
//
// Web search ships as a pluggable provider that is UNCONFIGURED by default: the
// tool spec is advertised to the model, but execution returns a clear "not
// configured" message until a provider is wired in (see search.go). This lets
// the whole tool-calling loop ship and be tested now, with the search backend
// dropped in later.
package tools

import (
	"context"
	"encoding/json"
	"fmt"
)

// ToolSpec is the OpenAI "tools" array entry advertised to the model.
type ToolSpec struct {
	Type     string       `json:"type"` // always "function"
	Function FunctionSpec `json:"function"`
}

type FunctionSpec struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

// Tool is a server-side capability the model can invoke.
type Tool interface {
	Spec() ToolSpec
	// Execute runs the tool with JSON-encoded arguments and returns a string
	// result that is fed back to the model as a "tool" role message.
	Execute(ctx context.Context, args json.RawMessage) (string, error)
}

// Registry holds the enabled tools.
type Registry struct {
	tools map[string]Tool
}

func NewRegistry(ts ...Tool) *Registry {
	r := &Registry{tools: make(map[string]Tool)}
	for _, t := range ts {
		r.tools[t.Spec().Function.Name] = t
	}
	return r
}

// All returns the registered tools, for composing a new registry.
func (r *Registry) All() []Tool {
	out := make([]Tool, 0, len(r.tools))
	for _, t := range r.tools {
		out = append(out, t)
	}
	return out
}

// Specs returns the tool specs to advertise to the model, or nil if empty.
func (r *Registry) Specs() []ToolSpec {
	if len(r.tools) == 0 {
		return nil
	}
	out := make([]ToolSpec, 0, len(r.tools))
	for _, t := range r.tools {
		out = append(out, t.Spec())
	}
	return out
}

// Execute dispatches a tool call by name. Unknown tools return an error string
// (not a Go error) so the model can recover gracefully within the loop.
func (r *Registry) Execute(ctx context.Context, name string, args json.RawMessage) string {
	t, ok := r.tools[name]
	if !ok {
		return fmt.Sprintf("error: unknown tool %q", name)
	}
	result, err := t.Execute(ctx, args)
	if err != nil {
		return fmt.Sprintf("error: %v", err)
	}
	return result
}

// Default returns the registry used by the agent endpoint. Web search is
// included so its spec is advertised; it self-reports as unconfigured until a
// provider is set.
func Default() *Registry {
	return NewRegistry(NewWebSearch())
}
