package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/johnbetancur/vision/backend/internal/config"
	"github.com/johnbetancur/vision/backend/internal/connections"
	"github.com/johnbetancur/vision/backend/internal/usage"
)

// usageBody is the subset of an OpenAI-compatible response we care about.
type usageBody struct {
	Usage struct {
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
	} `json:"usage"`
}

func New(cfg *config.Config, connStore *connections.Store, usageStore *usage.Store) http.Handler {
	fallbackTarget, err := url.Parse(cfg.APIBaseURL)
	if err != nil {
		panic("invalid API_BASE_URL: " + err.Error())
	}

	return &httputil.ReverseProxy{
		Rewrite: func(req *httputil.ProxyRequest) {
			target := fallbackTarget
			apiKey := cfg.APIKey

			connID := req.In.Header.Get("X-Relay-Connection-ID")
			if connID != "" {
				if conn, err := connStore.GetByID(connID); err == nil && conn != nil && conn.Enabled {
					if t, err := url.Parse(conn.BaseURL); err == nil {
						target = t
						apiKey = conn.APIKey
					}
				}
			}

			req.SetURL(target)
			req.Out.URL.Path = strings.TrimPrefix(req.In.URL.Path, "/api")
			req.Out.URL.RawPath = strings.TrimPrefix(req.In.URL.RawPath, "/api")
			req.Out.Host = target.Host

			// Store connID in context before stripping the header so
			// ModifyResponse can recover it after the upstream round-trip.
			if connID != "" {
				ctx := context.WithValue(req.Out.Context(), connIDKey{}, connID)
				req.Out = req.Out.WithContext(ctx)
			}
			req.Out.Header.Del("X-Relay-Connection-ID")

			if apiKey != "" {
				req.Out.Header.Set("Authorization", "Bearer "+apiKey)
			}
		},

		ModifyResponse: func(res *http.Response) error {
			contentType := res.Header.Get("Content-Type")
			isStream := strings.Contains(contentType, "text/event-stream")

			if isStream {
				res.Header.Set("X-Accel-Buffering", "no")
			}

			connID, _ := res.Request.Context().Value(connIDKey{}).(string)
			if connID == "" || res.StatusCode >= 400 {
				return nil
			}

			if isStream {
				res.Body = newStreamingInterceptor(res.Body, connID, usageStore)
			} else {
				recordFromBody(res, connID, usageStore)
			}

			return nil
		},
	}
}

// connIDKey is the context key used to pass the connection ID through to ModifyResponse.
type connIDKey struct{}

// recordFromBody reads the full response, extracts usage, then restores the body.
func recordFromBody(res *http.Response, connID string, usageStore *usage.Store) {
	body, err := io.ReadAll(res.Body)
	res.Body.Close()
	res.Body = io.NopCloser(bytes.NewReader(body))
	if err != nil {
		return
	}

	var u usageBody
	if err := json.Unmarshal(body, &u); err != nil {
		return
	}
	if u.Usage.PromptTokens == 0 && u.Usage.CompletionTokens == 0 {
		return
	}
	if err := usageStore.Record(connID, u.Usage.PromptTokens, u.Usage.CompletionTokens); err != nil {
		log.Printf("usage record error: %v", err)
	}
}

// streamingInterceptor wraps an SSE body and scans for the usage chunk sent
// by most providers as the last data: {...} line before data: [DONE].
type streamingInterceptor struct {
	inner      io.ReadCloser
	connID     string
	usageStore *usage.Store
	buf        bytes.Buffer
	done       bool
}

func newStreamingInterceptor(r io.ReadCloser, connID string, us *usage.Store) *streamingInterceptor {
	return &streamingInterceptor{inner: r, connID: connID, usageStore: us}
}

func (s *streamingInterceptor) Read(p []byte) (int, error) {
	n, err := s.inner.Read(p)
	if n > 0 && !s.done {
		s.buf.Write(p[:n])
	}
	return n, err
}

func (s *streamingInterceptor) Close() error {
	if !s.done {
		s.done = true
		s.extractAndRecord()
	}
	return s.inner.Close()
}

func (s *streamingInterceptor) extractAndRecord() {
	data := s.buf.Bytes()
	// Walk SSE lines looking for the last JSON chunk that has a usage field.
	var best usageBody
	for _, line := range bytes.Split(data, []byte("\n")) {
		line = bytes.TrimPrefix(line, []byte("data: "))
		if len(line) == 0 || bytes.Equal(line, []byte("[DONE]")) {
			continue
		}
		var u usageBody
		if err := json.Unmarshal(line, &u); err == nil {
			if u.Usage.PromptTokens > 0 || u.Usage.CompletionTokens > 0 {
				best = u
			}
		}
	}
	if best.Usage.PromptTokens == 0 && best.Usage.CompletionTokens == 0 {
		return
	}
	if err := s.usageStore.Record(s.connID, best.Usage.PromptTokens, best.Usage.CompletionTokens); err != nil {
		log.Printf("usage record (stream) error: %v", err)
	}
}
