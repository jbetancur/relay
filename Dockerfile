# ── Stage 1: build frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: build Go backend ────────────────────────────────────────────────
FROM golang:1.26-alpine AS backend
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /server ./cmd/server

# ── Stage 3: final image ──────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=frontend /app/dist /usr/share/nginx/html
COPY --from=backend  /server   /server
COPY nginx/nginx.conf          /etc/nginx/nginx.conf
COPY docker/entrypoint.sh      /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["/entrypoint.sh"]
