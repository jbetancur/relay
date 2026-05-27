package middleware

import "net/http"

// Auth is a stub that passes all requests through.
// Replace this with JWT/session validation when multi-user auth is added.
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
}
