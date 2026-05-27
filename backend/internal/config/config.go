package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	APIBaseURL string
	APIKey     string
	Port       string
	DBPath     string
}

func Load() (*Config, error) {
	base := strings.TrimRight(os.Getenv("API_BASE_URL"), "/")
	if base == "" {
		base = "https://api.openai.com"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./relay.db"
	}

	if !strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://") {
		return nil, fmt.Errorf("API_BASE_URL must start with http:// or https://")
	}

	return &Config{
		APIBaseURL: base,
		APIKey:     os.Getenv("API_KEY"),
		Port:       port,
		DBPath:     dbPath,
	}, nil
}
