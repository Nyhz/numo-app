#!/bin/bash
# finances-service.sh — launchd wrapper for Finances
# Reads ~/.finances/mode and starts in dev or prod accordingly.

set -euo pipefail

# launchd starts with a minimal environment — source Homebrew + node/pnpm
eval "$(/opt/homebrew/bin/brew shellenv)"
export PATH="/opt/homebrew/bin:$PATH"

FINANCES_DIR="/Users/nyhzdev/devroom/battlefields/finances"
MODE_FILE="$HOME/.finances/mode"
PORT=3200

cd "$FINANCES_DIR"

# Load .env.local
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

# Read mode (default: prod)
MODE="prod"
if [ -f "$MODE_FILE" ]; then
  MODE=$(cat "$MODE_FILE" | tr -d '[:space:]')
fi

# Back up + migrate the DB before (re)starting. `next start` never migrates on
# its own, so without this any feature shipping a new migration 500s in prod
# until migrated by hand. drizzle's migrate is idempotent (a no-op when nothing
# is pending), so this is safe on every restart; the backup is a single
# overwritten VACUUM INTO snapshot taken just before we touch the DB. A backup
# failure only warns; a migration failure aborts (set -e) so we never serve
# against a half-migrated DB.
echo "[FINANCES] Backing up DB before migrate..."
pnpm db:backup || echo "[FINANCES] WARN: pre-migrate backup failed — continuing"
echo "[FINANCES] Applying pending migrations..."
pnpm db:migrate

# Pre-start cleanup — kill any process still holding our port from a previous
# run. launchd's SIGKILL bypasses our SIGTERM trap, leaving orphan servers
# (and multi-GB of leaked turbopack cache) behind.
kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[FINANCES] Port ${port} held by PIDs: ${pids} — sending SIGTERM"
    kill $pids 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
      [ -z "$pids" ] && break
      sleep 1
    done
    if [ -n "$pids" ]; then
      echo "[FINANCES] Port ${port} still held — sending SIGKILL to ${pids}"
      kill -9 $pids 2>/dev/null || true
      sleep 1
    fi
  fi
}

kill_port "$PORT"

# Sweep stray finances servers rooted under our working directory.
pkill -f "next-server.*${FINANCES_DIR}" 2>/dev/null || true
pkill -f "next dev.*${FINANCES_DIR}" 2>/dev/null || true
sleep 1

echo "[FINANCES] Starting in ${MODE} mode on port ${PORT}..."

# Ensure ALL child processes die when this script is killed.
cleanup() {
  kill -- -$$ 2>/dev/null || true
}
trap cleanup SIGTERM SIGINT EXIT

if [ "$MODE" = "dev" ]; then
  pnpm dev --port "$PORT" &
else
  echo "[FINANCES] Building for production..."
  pnpm build
  pnpm start --port "$PORT" &
fi

# Catch-up post-caída (SPEC §6): si el último cierre almacenado es anterior a
# ayer (Madrid), el host se saltó al menos un cron de las 23:00 — gap-fill del
# hueco y sync del día en cuanto el server responda. Freshness-gated: en un
# restart normal (deploy/kickstart) es un no-op sin salir a red. En background
# para no retrasar el arranque; nunca tumba el servicio.
(pnpm exec tsx scripts/catchup-prices.ts >> "$HOME/.finances/logs/catchup.log" 2>&1 || true) &

# Wait for the background process — this keeps the script alive so launchd
# tracks this PID. The trap ensures children are killed on SIGTERM.
wait
