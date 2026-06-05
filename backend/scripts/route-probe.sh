#!/usr/bin/env bash
#
# route-probe.sh — fire a batch of tasks at a running /api/route and print the
# model/tier/reason it picks for each. Use this after changing routing thresholds
# to sanity-check the *live* endpoint end-to-end (candidate building, real
# modelmeta pricing, classifier) — the unit/corpus tests only cover the pure
# heuristic.
#
# Usage:
#   ./scripts/route-probe.sh                 # probes http://localhost:8080
#   RELAY_URL=http://localhost:8099 ./scripts/route-probe.sh
#   ./scripts/route-probe.sh path/to/tasks.txt   # one task per line, overrides defaults
#
# Requires: curl, jq.

set -euo pipefail

RELAY_URL="${RELAY_URL:-http://localhost:8080}"
ENDPOINT="$RELAY_URL/api/route"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq)" >&2
  exit 1
fi

# Tasks: from a file argument (one per line), else a built-in spread across tiers.
if [[ $# -ge 1 && -f "$1" ]]; then
  TASKS=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    TASKS+=("$line")
  done < "$1"
else
  TASKS=(
    "fix this typo in the comment"
    "explain what this regex does"
    "rename this variable everywhere"
    "add a null check before this dereference"
    "write a unit test for the parseDate function"
    "add pagination to the users endpoint"
    "fix the race condition in the connection pool"
    "design a distributed rate limiter that handles clock skew"
    "audit this auth flow for security vulnerabilities"
  )
fi

# Quick liveness check so a down server gives a clear message, not curl spew.
if ! curl -fsS "$RELAY_URL/healthz" -o /dev/null 2>/dev/null; then
  echo "error: no server at $RELAY_URL (set RELAY_URL or start the backend)" >&2
  exit 1
fi

printf '%-55s | %-9s | %-22s | %s\n' "TASK" "TIER" "MODEL" "REASON"
printf '%0.s-' $(seq 1 130); echo

for task in "${TASKS[@]}"; do
  [[ -z "$task" ]] && continue
  body=$(jq -n --arg t "$task" '{task:$t, hints:{fileCount:1}}')
  resp=$(curl -fsS "$ENDPOINT" -H 'Content-Type: application/json' -d "$body" 2>/dev/null) || {
    printf '%-55s | %-9s | %-22s | %s\n' "${task:0:55}" "ERR" "-" "request failed"
    continue
  }
  if echo "$resp" | jq -e 'has("error")' >/dev/null 2>&1; then
    err=$(echo "$resp" | jq -r '.error')
    printf '%-55s | %-9s | %-22s | %s\n' "${task:0:55}" "-" "-" "$err"
    continue
  fi
  tier=$(echo "$resp"  | jq -r '.tier')
  model=$(echo "$resp" | jq -r '.model')
  reason=$(echo "$resp" | jq -r '.reason')
  used=$(echo "$resp"  | jq -r 'if .classifierUsed then " [classifier]" else "" end')
  printf '%-55s | %-9s | %-22s | %s%s\n' "${task:0:55}" "$tier" "${model:0:22}" "$reason" "$used"
done
