#!/bin/bash
# Invoked by launchd at 09:00 / 18:00 Madrid. Hits the advisor-scan route.
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

# Agent runs can take minutes — give curl a generous ceiling.
curl -fsS --max-time 600 \
  -H "x-cron-secret: ${CRON_SECRET}" \
  http://localhost:3200/api/cron/advisor-scan
