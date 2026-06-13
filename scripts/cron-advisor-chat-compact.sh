#!/bin/bash
# Invoked by launchd on Mondays at 08:50 Madrid. Compacts the week's chat transcripts.
set -eu

FINANCES_DIR="/Users/nyhzdev/devroom/battlefields/finances"
LOG_DIR="$HOME/.finances/logs"
mkdir -p "$LOG_DIR"

cd "$FINANCES_DIR"

set -a
# shellcheck disable=SC1091
source .env.local
set +a

curl -fsS --max-time 300 \
  -H "x-cron-secret: ${CRON_SECRET}" \
  http://localhost:3200/api/cron/advisor-chat-compact
