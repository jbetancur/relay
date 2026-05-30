package proxy

import (
	"bytes"
	"compress/gzip"
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
	Model string `json:"model"`
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

			req.Out.Header.Del("X-Relay-Connection-ID")

			if apiKey != "" {
				req.Out.Header.Set("Authorization", "Bearer "+apiKey)
			}

			// Read the request body once: needed both for debug logging and to
			// extract the model so usage can be attributed per-model.
			var reqModel string
			if req.Out.Body != nil {
				body, _ := io.ReadAll(req.Out.Body)
				req.Out.Body = io.NopCloser(bytes.NewReader(body))
				var rb struct {
					Model string `json:"model"`
				}
				_ = json.Unmarshal(body, &rb)
				reqModel = rb.Model
				slog.Debug("proxy request", "method", req.Out.Method, "url", req.Out.URL.String(), "body", string(body))
			} else {
				slog.Debug("proxy request", "method", req.Out.Method, "url", req.Out.URL.String())
			}

			if connID != "" {
				ctx := context.WithValue(req.Out.Context(), connIDKey{}, connID)
				ctx = context.WithValue(ctx, modelKey{}, reqModel)
				req.Out = req.Out.WithContext(ctx)
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
				readable := decompress(res.Header.Get("Content-Encoding"), body)
				slog.Error("upstream error", "status", res.StatusCode, "url", res.Request.URL.String(), "body", readable)
				return nil
			}

			slog.Debug("proxy response", "status", res.StatusCode, "url", res.Request.URL.String())

			connID, _ := res.Request.Context().Value(connIDKey{}).(string)
			if connID == "" {
				return nil
			}
			reqModel, _ := res.Request.Context().Value(modelKey{}).(string)

			if isStream {
				res.Body = newStreamingInterceptor(res.Body, connID, reqModel, usageStore)
			} else {
				recordFromBody(res, connID, reqModel, usageStore)
			}

			return nil
		},
	}
}

type connIDKey struct{}
type modelKey struct{}

func decompress(encoding string, data []byte) string {
	if strings.Contains(encoding, "gzip") {
		r, err := gzip.NewReader(bytes.NewReader(data))
		if err == nil {
			defer r.Close()
			if out, err := io.ReadAll(r); err == nil {
				return string(out)
			}
		}
	}
	return string(data)
}

func recordFromBody(res *http.Response, connID, reqModel string, usageStore *usage.Store) {
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
	if err := usageStore.Record(connID, pickModel(u.Model, reqModel), u.Usage.PromptTokens, u.Usage.CompletionTokens); err != nil {
		slog.Error("usage record error", "err", err)
	}
}

// pickModel prefers the model echoed by the upstream response, falling back to
// the model from the original request.
func pickModel(respModel, reqModel string) string {
	if respModel != "" {
		return respModel
	}
	return reqModel
}

type streamingInterceptor struct {
	inner      io.ReadCloser
	connID     string
	reqModel   string
	usageStore *usage.Store
	buf        bytes.Buffer
	done       bool
}

func newStreamingInterceptor(r io.ReadCloser, connID, reqModel string, us *usage.Store) *streamingInterceptor {
	return &streamingInterceptor{inner: r, connID: connID, reqModel: reqModel, usageStore: us}
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
	model := s.reqModel
	for _, line := range bytes.Split(data, []byte("\n")) {
		line = bytes.TrimPrefix(line, []byte("data: "))
		if len(line) == 0 || bytes.Equal(line, []byte("[DONE]")) {
			continue
		}
		var u usageBody
		if err := json.Unmarshal(line, &u); err == nil {
			if u.Model != "" {
				model = u.Model
			}
			if u.Usage.PromptTokens > 0 || u.Usage.CompletionTokens > 0 {
				best = u
			}
		}
	}
	if best.Usage.PromptTokens == 0 && best.Usage.CompletionTokens == 0 {
		return
	}
	if err := s.usageStore.Record(s.connID, model, best.Usage.PromptTokens, best.Usage.CompletionTokens); err != nil {
		slog.Error("usage record (stream) error", "err", err)
	}
}
