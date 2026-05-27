#!/bin/sh
set -e

# Start the Go backend in the background.
/server &

# Hand off to nginx in the foreground.
exec nginx -g "daemon off;"
