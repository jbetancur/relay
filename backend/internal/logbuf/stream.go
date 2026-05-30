package logbuf

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// Stream serves the log hub as Server-Sent Events: it first replays the current
// ring buffer, then streams new entries live until the client disconnects.
func (h *Hub) Stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	write := func(e Entry) bool {
		b, err := json.Marshal(e)
		if err != nil {
			return true
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	// Replay buffered history first.
	for _, e := range h.Snapshot() {
		if !write(e) {
			return
		}
	}

	ch, cancel := h.Subscribe()
	defer cancel()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case e, ok := <-ch:
			if !ok {
				return
			}
			if !write(e) {
				return
			}
		}
	}
}
