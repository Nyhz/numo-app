#!/bin/bash
# tg-bot-service.sh — launchd wrapper para el bot de Telegram autónomo.
# Mantiene vivo el long-polling de /net y /ask. KeepAlive lo resucita si cae.

set -euo pipefail

# launchd arranca con un entorno mínimo — carga Homebrew + node/pnpm.
eval "$(/opt/homebrew/bin/brew shellenv)"
export PATH="/opt/homebrew/bin:$PATH"

FINANCES_DIR="/Users/nyhzdev/devroom/battlefields/finances"
cd "$FINANCES_DIR"

# Carga .env.local (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CLAUDE_CODE_OAUTH_TOKEN…).
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

# /ask importa el cliente del asesor, que usa "server-only" — requiere la
# condición react-server (igual que el script pnpm tg:ask).
export NODE_OPTIONS='--conditions=react-server'

# Mata cualquier instancia previa del bot para no duplicar el poller (dos
# getUpdates sobre el mismo token = 409).
pkill -f "tsx scripts/tg-bot.ts" 2>/dev/null || true
sleep 1

echo "[TG-BOT] Arrancando long-polling…"
exec pnpm tsx scripts/tg-bot.ts
