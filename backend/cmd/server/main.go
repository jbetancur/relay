package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/johnbetancur/vision/backend/internal/config"
	"github.com/johnbetancur/vision/backend/internal/connections"
	"github.com/johnbetancur/vision/backend/internal/db"
	"github.com/johnbetancur/vision/backend/internal/middleware"
	"github.com/johnbetancur/vision/backend/internal/proxy"
	"github.com/johnbetancur/vision/backend/internal/usage"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config error", "err", err)
		os.Exit(1)
	}

	database, err := db.Open(cfg.DBPath)
	if err != nil {
		slog.Error("db error", "err", err)
		os.Exit(1)
	}
	defer database.Close()

	connStore := connections.NewStore(database)
	usageStore := usage.NewStore(database)
	connHandler := connections.NewHandler(connStore, usageStore)

	if apiBase := os.Getenv("API_BASE_URL"); apiBase != "" {
		if err := connStore.Seed("Default", cfg.APIBaseURL, cfg.APIKey); err != nil {
			slog.Warn("seed warning", "err", err)
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

		r.Get("/api/connections", connHandler.List)
		r.Post("/api/connections", connHandler.Create)
		r.Get("/api/connections/{id}", connHandler.Get)
		r.Put("/api/connections/{id}", connHandler.Update)
		r.Delete("/api/connections/{id}", connHandler.Delete)
		r.Get("/api/connections/{id}/models", connHandler.Models)
		r.Get("/api/connections/{id}/stats", connHandler.GetStats)
		r.Delete("/api/connections/{id}/stats", connHandler.ResetStats)

		r.Handle("/api/*", proxy.New(cfg, connStore, usageStore))
	})

	slog.Info("relay backend listening", "port", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}
