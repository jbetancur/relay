package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/johnbetancur/vision/backend/internal/config"
	"github.com/johnbetancur/vision/backend/internal/connections"
	"github.com/johnbetancur/vision/backend/internal/db"
	"github.com/johnbetancur/vision/backend/internal/middleware"
	"github.com/johnbetancur/vision/backend/internal/proxy"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("db error: %v", err)
	}
	defer database.Close()

	connStore := connections.NewStore(database)
	connHandler := connections.NewHandler(connStore)

	// Seed a default connection from env vars on first startup.
	if apiBase := os.Getenv("API_BASE_URL"); apiBase != "" {
		if err := connStore.Seed("Default", cfg.APIBaseURL, cfg.APIKey); err != nil {
			log.Printf("seed warning: %v", err)
		}
	}

	r := chi.NewRouter()
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.RealIP)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth)

		// Connection CRUD — registered before the wildcard proxy.
		r.Get("/api/connections", connHandler.List)
		r.Post("/api/connections", connHandler.Create)
		r.Get("/api/connections/{id}", connHandler.Get)
		r.Put("/api/connections/{id}", connHandler.Update)
		r.Delete("/api/connections/{id}", connHandler.Delete)
		r.Get("/api/connections/{id}/models", connHandler.Models)

		// Wildcard proxy for all other /api/* traffic.
		r.Handle("/api/*", proxy.New(cfg, connStore))
	})

	log.Printf("relay backend listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
