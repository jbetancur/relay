package router

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/johnbetancur/vision/backend/internal/httputil"
	"github.com/johnbetancur/vision/backend/internal/stringutil"
)

// classifyTimeout bounds the tie-breaker call. The classifier is strictly
// best-effort: on any error or timeout we fall back to the heuristic score.
const classifyTimeout = 3 * time.Second

// classify asks a local model to rate task complexity 1–5 and maps that to a
// 0..1 value. Returns (value, true) on success; (0, false) on any error.
func (h *Handler) classify(ctx context.Context, task string, local Candidate) (float64, bool) {
	conn, err := h.connStore.GetByID(local.ConnectionID)
	if err != nil || conn == nil {
		return 0, false
	}

	body, _ := json.Marshal(map[string]any{
		"model": local.Model,
		"messages": []map[string]string{
			{"role": "system", "content": "Rate the engineering complexity of the user's coding task from 1 (trivial) to 5 (very hard). Reply with only the single digit."},
			{"role": "user", "content": stringutil.Truncate(task, 2000)},
		},
		"max_tokens":  4,
		"temperature": 0,
		"stream":      false,
	})

	cctx, cancel := context.WithTimeout(ctx, classifyTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(cctx, http.MethodPost,
		httputil.NormalizeBaseURL(conn.BaseURL)+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return 0, false
	}
	req.Header.Set("Content-Type", "application/json")
	httputil.SetProviderAuth(req, string(conn.TypeHint), conn.APIKey)

	resp, err := h.client.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, false
	}

	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil || len(parsed.Choices) == 0 {
		return 0, false
	}

	rating, ok := firstDigit(parsed.Choices[0].Message.Content)
	if !ok {
		return 0, false
	}
	return float64(rating)*0.2 - 0.1, true
}

func firstDigit(s string) (int, bool) {
	for _, r := range s {
		if r >= '1' && r <= '5' {
			return int(r - '0'), true
		}
	}
	return 0, false
}
