# Relay

A self-hosted AI chat and image-generation interface that proxies any OpenAI-compatible API — OpenAI, Anthropic, Ollama, or your own endpoint. Think open-webui or LibreChat, but lighter and easier to deploy.

---

## Features

- **Multi-connection routing** — add multiple API backends (OpenAI, Ollama, Anthropic, custom) and switch between them per chat
- **Chat** — streaming and non-streaming completions with full conversation history
- **Image generation** — supports `gpt-image-1`, `dall-e-3`, and `dall-e-2` with model-aware parameter controls
- **Usage tracking** — token usage recorded per connection in a local SQLite database
- **Prompt library** — save and reuse frequently used prompts
- **Single Docker image** — Go backend + React frontend served by nginx in one container

---

## Getting Started

### Option 1 — Docker (recommended)

**Prerequisites:** Docker

```bash
# Pull and run (replace values as needed)
docker run -d \
  -p 3000:80 \
  -e API_BASE_URL=https://api.openai.com \
  -e API_KEY=sk-... \
  -v relay_data:/data \
  --name relay \
  ghcr.io/johnbetancur/relay:latest
```

Then open [http://localhost:3000](http://localhost:3000).

### Option 2 — Docker Compose

```bash
git clone https://github.com/johnbetancur/relay.git
cd relay

# Copy and edit the env file
cp .env.example .env
# Set API_BASE_URL and API_KEY in .env

docker compose up -d
```

App is available at [http://localhost:3000](http://localhost:3000).

### Option 3 — Local development

**Prerequisites:** Go 1.26+, Node.js 22+

```bash
git clone https://github.com/johnbetancur/relay.git
cd relay

# Start backend
cd backend
API_BASE_URL=https://api.openai.com API_KEY=sk-... go run ./cmd/server

# In another terminal — start frontend
cd frontend
npm install
npm run dev
```

Frontend: [http://localhost:5173](http://localhost:5173)  
Backend: [http://localhost:8080](http://localhost:8080)

Or use Docker Compose with the `dev` profile for hot-reload on both:

```bash
API_BASE_URL=https://api.openai.com API_KEY=sk-... \
  docker compose --profile dev up
```

---

## Configuration

All configuration is via environment variables.

| Variable | Default | Description |
|---|---|---|
| `API_BASE_URL` | `https://api.openai.com` | Base URL of the upstream API |
| `API_KEY` | _(empty)_ | API key sent as `Authorization: Bearer` |
| `PORT` | `8080` | Port the Go backend listens on |
| `DB_PATH` | `./relay.db` | Path to the SQLite database file |

When running via Docker, persist the database by mounting a volume to `/data` and leaving `DB_PATH` at its default (`/data/vision.db` as set in `docker-compose.yml`).

---

## Connections

Relay supports multiple upstream API connections managed through the UI (Settings → Connections). Each connection has:

| Field | Description |
|---|---|
| **Name** | Display label |
| **Base URL** | Upstream API root, e.g. `https://api.openai.com` or `http://localhost:11434` |
| **API Key** | Optional; sent as `Authorization: Bearer <key>` |
| **Type** | Hint for the UI: `openai`, `anthropic`, `ollama`, `custom` |
| **Default** | Whether this connection is pre-selected in new chats |

The connection configured via `API_BASE_URL` / `API_KEY` environment variables acts as the built-in fallback when no connection is selected.

### Provider examples

**OpenAI**
```
Base URL: https://api.openai.com
API Key:  sk-...
Type:     openai
```

**Anthropic**
```
Base URL: https://api.anthropic.com
API Key:  sk-ant-...
Type:     anthropic
```

**Ollama (local)**
```
Base URL: http://localhost:11434
API Key:  (leave empty)
Type:     ollama
```

**Any OpenAI-compatible API**
```
Base URL: https://your-provider.com/v1
API Key:  your-key
Type:     custom
```

---

## Image Generation

The image page supports three model families with automatically adjusted controls:

| Model | Sizes | Quality options | Style | Multi-image |
|---|---|---|---|---|
| `gpt-image-1` | 1024×1024, 1536×1024, 1024×1536 | auto / high / medium / low | — | ✓ (up to 4) |
| `dall-e-3` | 1024×1024, 1792×1024, 1024×1792 | hd / standard | vivid / natural | — (n=1 only) |
| `dall-e-2` | 1024×1024, 512×512, 256×256 | standard | — | ✓ (up to 4) |

Switching models resets quality, size, and count to valid defaults for that model automatically.

---

## Architecture

```
Browser
  └── nginx :80
        ├── /          → React SPA (static files)
        └── /api/*     → Go backend :8080
                            ├── /api/connections  (CRUD)
                            ├── /api/usage
                            └── /api/v1/*         → reverse-proxied to upstream API
```

- **Frontend** — React 19, Vite, Mantine UI, Zustand
- **Backend** — Go, Chi router, SQLite (via modernc/sqlite — no CGO required)
- **Deployment** — single multi-stage Docker image; nginx serves the SPA and proxies `/api/*` to the Go process running in the same container

The backend is a thin reverse proxy. It rewrites the `Authorization` header using the selected connection's API key, strips the internal `X-Relay-Connection-ID` header, and records token usage from the response before forwarding it to the client.

---

## API

The backend exposes a small REST API for managing connections and querying usage.

### Connections

```
GET    /api/connections          List all connections
POST   /api/connections          Create a connection
GET    /api/connections/:id      Get a connection
PUT    /api/connections/:id      Update a connection
DELETE /api/connections/:id      Delete a connection
```

**Connection object**

```json
{
  "id": "01J...",
  "name": "OpenAI",
  "baseUrl": "https://api.openai.com",
  "typeHint": "openai",
  "enabled": true,
  "isDefault": true,
  "createdAt": 1716000000,
  "updatedAt": 1716000000
}
```

> `apiKey` is write-only — it is accepted on create/update but never returned.

### Usage

```
GET /api/usage/:connectionId     Token usage totals for a connection
```

### Proxy

All requests to `/api/v1/*` are forwarded to the upstream API with the path rewritten to `/v1/*`. Pass `X-Relay-Connection-ID: <id>` to route a request through a specific connection.

### Health

```
GET /healthz     Returns 200 OK when the backend is up
```

---

## Building from source

```bash
# Frontend
cd frontend && npm ci && npm run build

# Backend
cd backend && go build -o relay ./cmd/server

# Or build the Docker image
docker build -t relay .
```

---

## License

MIT
