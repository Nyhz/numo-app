#!/bin/bash
# finances-ctl.sh — CLI control for Finances launchd service
#
# Usage:
#   finances start       Load and start the service
#   finances stop        Stop and unload the service
#   finances restart     Restart the service (same mode)
#   finances dev         Switch to dev mode and restart
#   finances prod        Switch to prod mode and restart
#   finances status      Show service status, mode, and uptime
#   finances logs        Tail the service log

set -euo pipefail

SERVICE_LABEL="com.finances.app"
TGBOT_LABEL="com.finances.tg-bot"
PLIST="$HOME/Library/LaunchAgents/${SERVICE_LABEL}.plist"
MODE_FILE="$HOME/.finances/mode"
LOG_FILE="$HOME/.finances/logs/finances.log"
GUI_DOMAIN="gui/$(id -u)"
PORT=3200

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
AMBER='\033[0;33m'
DIM='\033[0;90m'
RESET='\033[0m'

is_running() {
  launchctl print "${GUI_DOMAIN}/${SERVICE_LABEL}" &>/dev/null \
    || lsof -i :${PORT} -sTCP:LISTEN &>/dev/null
}

get_mode() {
  if [ -f "$MODE_FILE" ]; then
    cat "$MODE_FILE" | tr -d '[:space:]'
  else
    echo "prod"
  fi
}

get_pid() {
  local pid
  pid=$(launchctl print "${GUI_DOMAIN}/${SERVICE_LABEL}" 2>/dev/null \
    | grep -m1 "pid =" \
    | awk '{print $3}')
  if [ -z "$pid" ] || [ "$pid" = "0" ]; then
    pid=$(lsof -i :${PORT} -sTCP:LISTEN -t 2>/dev/null | head -1)
  fi
  echo "$pid"
}

get_uptime() {
  local pid
  pid=$(get_pid)
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    ps -p "$pid" -o etime= 2>/dev/null | tr -d ' '
  else
    echo "-"
  fi
}

cmd_start() {
  if is_running; then
    echo -e "${AMBER}Finances is already running.${RESET}"
    return
  fi
  if [ ! -f "$PLIST" ]; then
    echo -e "${RED}Plist not found at ${PLIST}${RESET}"
    exit 1
  fi
  echo "Starting Finances..."
  launchctl bootstrap "${GUI_DOMAIN}" "$PLIST"
  echo -e "${GREEN}Finances started in $(get_mode) mode.${RESET}"
}

cmd_stop() {
  if ! is_running; then
    echo -e "${DIM}Finances is not running.${RESET}"
    return
  fi
  echo "Stopping Finances..."
  if ! launchctl bootout "${GUI_DOMAIN}/${SERVICE_LABEL}" 2>/dev/null; then
    local pid
    pid=$(get_pid)
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
      kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      sleep 1
    fi
  fi
  echo -e "${DIM}Finances stopped.${RESET}"
}

# The Telegram bot is a long-running daemon (tsx long-polling) that caches the
# compiled module graph at boot. After a code change it keeps serving stale
# schema/advisor code — e.g. a drizzle "undefined table" crash on /ask when the
# real-estate exports were added after the bot last started. Reload it whenever
# the app is rebuilt so both share the same source.
restart_tgbot() {
  if launchctl print "${GUI_DOMAIN}/${TGBOT_LABEL}" &>/dev/null; then
    echo "Restarting Telegram bot..."
    launchctl kickstart -k "${GUI_DOMAIN}/${TGBOT_LABEL}" 2>/dev/null || true
  fi
}

cmd_restart() {
  if ! is_running; then
    echo -e "${AMBER}Finances is not running. Starting...${RESET}"
    cmd_start
    restart_tgbot
    return
  fi
  echo "Restarting Finances..."
  if ! launchctl kickstart -k "${GUI_DOMAIN}/${SERVICE_LABEL}" 2>/dev/null; then
    cmd_stop
    sleep 1
    cmd_start
  fi
  restart_tgbot
  echo -e "${GREEN}Finances restarted in $(get_mode) mode.${RESET}"
}

cmd_dev() {
  echo "dev" > "$MODE_FILE"
  echo -e "Mode set to ${GREEN}dev${RESET}."
  cmd_restart
}

cmd_prod() {
  echo "prod" > "$MODE_FILE"
  echo -e "Mode set to ${AMBER}prod${RESET} (will build on start)."
  cmd_restart
}

cmd_status() {
  local mode
  mode=$(get_mode)

  echo ""
  echo "═══════════════════════════════════════════"
  echo "  FINANCES — STATUS"
  echo "═══════════════════════════════════════════"

  if is_running; then
    local pid uptime
    pid=$(get_pid)
    uptime=$(get_uptime)
    echo -e "  Service: ${GREEN}RUNNING${RESET}"
    echo -e "  Mode:    ${mode}"
    echo -e "  PID:     ${pid}"
    echo -e "  Uptime:  ${uptime}"
  else
    echo -e "  Service: ${RED}STOPPED${RESET}"
    echo -e "  Mode:    ${mode} (will use on next start)"
  fi

  echo -e "  Port:    ${PORT}"
  echo ""

  # Caddy status
  if brew services info caddy 2>/dev/null | grep -qi "running"; then
    echo -e "  Caddy:   ${GREEN}RUNNING${RESET}"
  else
    echo -e "  Caddy:   ${RED}STOPPED${RESET}"
  fi

  echo "═══════════════════════════════════════════"
  echo ""
}

cmd_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    echo "No log file found at ${LOG_FILE}"
    exit 1
  fi
  tail -f "$LOG_FILE"
}

# --- Main ---
case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  dev)     cmd_dev ;;
  prod)    cmd_prod ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  *)
    echo "Usage: finances {start|stop|restart|dev|prod|status|logs}"
    exit 1
    ;;
esac
