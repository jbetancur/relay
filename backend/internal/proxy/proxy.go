package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/johnbetancur/vision/backend/internal/config"
	"github.com/johnbetancur/vision/backend/internal/connections"
	"github.com/johnbetancur/vision/backend/internal/usage"
)

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

			if connID != "" {
				ctx := context.WithValue(req.Out.Context(), connIDKey{}, connID)
				req.Out = req.Out.WithContext(ctx)
			}
			req.Out.Header.Del("X-Relay-Connection-ID")

			if apiKey != "" {
				req.Out.Header.Set("Authorization", "Bearer "+apiKey)
			}

			if req.Out.Body != nil {
				body, _ := io.ReadAll(req.Out.Body)
				req.Out.Body = io.NopCloser(bytes.NewReader(body))
				slog.Debug("proxy request", "method", req.Out.Method, "url", req.Out.URL.String(), "body", string(body))
			} else {
				slog.Debug("proxy request", "method", req.Out.Method, "url", req.Out.URL.String())
			}
		},

		ModifyResponse: func(res *http.Response) error {
			contentType := res.Header.Get("Content-Type")
			isStream := strings.Contains(contentType, "text/event-stream")

			if isStream {
				res.Header.Set("X-Accel-Buffering", "no")
			}

			if res.StatusCode >= 400 {
				body, _ := io.ReadAll(res.Body)
				res.Body = io.NopCloser(bytes.NewReader(body))
				slog.Error("upstream error", "status", res.StatusCode, "url", res.Request.URL.String(), "body", string(body))
				return nil
			}

			slog.Debug("proxy response", "status", res.StatusCode, "url", res.Request.URL.String())

			connID, _ := res.Request.Context().Value(connIDKey{}).(string)
			if connID == "" {
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

type connIDKey struct{}

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
		slog.Error("usage record error", "err", err)
	}
}

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
		slog.Error("usage record (stream) error", "err", err)
	}
}
