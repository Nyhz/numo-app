#!/bin/bash
# Invoked by cron on Sundays at 00:00 Madrid. Hits the backup route.
set -eu

FINANCES_DIR="/Users/nyhzdev/devroom/battlefields/finances"
LOG_DIR="$HOME/.finances/logs"
mkdir -p "$LOG_DIR"

cd "$FINANCES_DIR"

# Load CRON_SECRET from .env.local.
set -a
# shellcheck disable=SC1091
source .env.local
set +a

curl -fsS \
  -H "x-cron-secret: ${CRON_SECRET}" \
  http://localhost:3200/api/cron/backup
