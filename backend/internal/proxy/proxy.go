package proxy

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/johnbetancur/vision/backend/internal/config"
	"github.com/johnbetancur/vision/backend/internal/connections"
)

func New(cfg *config.Config, store *connections.Store) http.Handler {
	// Parse the config fallback target once.
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
				if conn, err := store.GetByID(connID); err == nil && conn != nil && conn.Enabled {
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

			// Don't leak our internal routing header upstream.
			req.Out.Header.Del("X-Relay-Connection-ID")

			if apiKey != "" {
				req.Out.Header.Set("Authorization", "Bearer "+apiKey)
			}
		},

		ModifyResponse: func(res *http.Response) error {
			if strings.Contains(res.Header.Get("Content-Type"), "text/event-stream") {
				res.Header.Set("X-Accel-Buffering", "no")
			}
			return nil
		},
	}
}
