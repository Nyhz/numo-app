#!/bin/bash
# Invoked by launchd on Sundays at 23:30 Madrid. Rebuilds (curates) the digest.
set -eu

FINANCES_DIR="/Users/nyhzdev/devroom/battlefields/finances"
LOG_DIR="$HOME/.finances/logs"
mkdir -p "$LOG_DIR"

cd "$FINANCES_DIR"

set -a
# shellcheck disable=SC1091
source .env.local
set +a

curl -fsS --max-time 600 \
  -H "x-cron-secret: ${CRON_SECRET}" \
  http://localhost:3200/api/cron/advisor-curate
