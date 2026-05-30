// Package logbuf tees slog records into an in-memory ring buffer and fans them
// out to live SSE subscribers, so the web UI can tail the backend's logs for
// troubleshooting. It wraps an inner slog.Handler (the normal stderr handler),
// so existing log output is preserved unchanged.
package logbuf

import (
	"context"
	"log/slog"
	"sync"
)

// Entry is a single captured log line in a UI-friendly shape.
type Entry struct {
	Time  int64          `json:"time"` // unix millis
	Level string         `json:"level"`
	Msg   string         `json:"msg"`
	Attrs map[string]any `json:"attrs,omitempty"`
}

const ringCap = 500

// Hub holds the ring buffer and the set of live subscribers.
type Hub struct {
	mu    sync.RWMutex
	ring  []Entry
	subs  map[chan Entry]struct{}
}

func NewHub() *Hub {
	return &Hub{
		ring: make([]Entry, 0, ringCap),
		subs: make(map[chan Entry]struct{}),
	}
}

// publish appends to the ring (evicting the oldest) and fans out to subscribers
// without blocking — a slow client simply drops lines.
func (h *Hub) publish(e Entry) {
	h.mu.Lock()
	if len(h.ring) >= ringCap {
		copy(h.ring, h.ring[1:])
		h.ring[len(h.ring)-1] = e
	} else {
		h.ring = append(h.ring, e)
	}
	for ch := range h.subs {
		select {
		case ch <- e:
		default: // subscriber is full; drop rather than block log emission
		}
	}
	h.mu.Unlock()
}

// Snapshot returns a copy of the current ring buffer (oldest first).
func (h *Hub) Snapshot() []Entry {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]Entry, len(h.ring))
	copy(out, h.ring)
	return out
}

// Subscribe returns a channel of future entries and an unsubscribe func.
func (h *Hub) Subscribe() (<-chan Entry, func()) {
	ch := make(chan Entry, 256)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			h.mu.Lock()
			delete(h.subs, ch)
			close(ch)
			h.mu.Unlock()
		})
	}
	return ch, cancel
}

// Handler is a slog.Handler that records into the hub and delegates to an inner
// handler so normal (stderr) logging keeps working.
type Handler struct {
	inner slog.Handler
	hub   *Hub
	attrs []slog.Attr
	group string
}

// NewHandler wraps inner, teeing every record into hub.
func NewHandler(inner slog.Handler, hub *Hub) *Handler {
	return &Handler{inner: inner, hub: hub}
}

func (h *Handler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *Handler) Handle(ctx context.Context, r slog.Record) error {
	attrs := make(map[string]any, r.NumAttrs()+len(h.attrs))
	for _, a := range h.attrs {
		attrs[a.Key] = a.Value.Any()
	}
	r.Attrs(func(a slog.Attr) bool {
		attrs[a.Key] = a.Value.Any()
		return true
	})
	h.hub.publish(Entry{
		Time:  r.Time.UnixMilli(),
		Level: r.Level.String(),
		Msg:   r.Message,
		Attrs: attrs,
	})
	return h.inner.Handle(ctx, r)
}

func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &Handler{
		inner: h.inner.WithAttrs(attrs),
		hub:   h.hub,
		attrs: append(append([]slog.Attr{}, h.attrs...), attrs...),
		group: h.group,
	}
}

func (h *Handler) WithGroup(name string) slog.Handler {
	return &Handler{
		inner: h.inner.WithGroup(name),
		hub:   h.hub,
		attrs: h.attrs,
		group: name,
	}
}
