// Package documents extracts plain text from uploaded files so the frontend can
// inject document content into chat context. PDFs are parsed server-side (the
// browser can't do it reliably); plain-text formats are passed through.
package documents

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/ledongthuc/pdf"
)

// maxUploadBytes caps a single upload to keep memory bounded.
const maxUploadBytes = 25 << 20 // 25 MiB

type extractResponse struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

// Extract handles POST /api/documents/extract (multipart form, field "file").
// Returns the file name and extracted UTF-8 text.
func Extract(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, "file too large or malformed upload")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing 'file' field")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read upload")
		return
	}

	name := header.Filename
	var text string

	if isPDF(name, header.Header.Get("Content-Type"), data) {
		text, err = extractPDF(data)
		if err != nil {
			writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("could not extract PDF text: %v", err))
			return
		}
	} else {
		// Treat everything else as UTF-8 text.
		text = string(data)
	}

	writeJSON(w, http.StatusOK, extractResponse{Name: name, Text: strings.TrimSpace(text)})
}

func isPDF(name, contentType string, data []byte) bool {
	if strings.HasSuffix(strings.ToLower(name), ".pdf") {
		return true
	}
	if strings.Contains(contentType, "application/pdf") {
		return true
	}
	return bytes.HasPrefix(data, []byte("%PDF-"))
}

func extractPDF(data []byte) (string, error) {
	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	var buf strings.Builder
	totalPages := reader.NumPage()
	for i := 1; i <= totalPages; i++ {
		page := reader.Page(i)
		if page.V.IsNull() {
			continue
		}
		content, err := page.GetPlainText(nil)
		if err != nil {
			// Skip pages we can't read rather than failing the whole document.
			continue
		}
		buf.WriteString(content)
		if !strings.HasSuffix(content, "\n") {
			buf.WriteString("\n")
		}
	}
	out := buf.String()
	if strings.TrimSpace(out) == "" {
		return "", fmt.Errorf("no extractable text (the PDF may be scanned images)")
	}
	return out, nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
