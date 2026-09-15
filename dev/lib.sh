# Shared settings and helpers for the local development stack.
# shellcheck shell=bash

set -euo pipefail

NETWORK="readermost-dev"

PG_CONTAINER="readermost-postgres"
MF_CONTAINER="readermost-miniflux"
MM_CONTAINER="readermost-mattermost"

PG_IMAGE="docker.io/library/postgres:16-alpine"
MF_IMAGE="docker.io/miniflux/miniflux:latest"
MM_IMAGE="docker.io/mattermost/mattermost-team-edition:latest"

# Local-only credentials. These are development throwaways and are deliberately
# committed: nothing here should ever be reachable from outside your machine.
PG_PASSWORD="devpassword"

MINIFLUX_PORT=8081
MINIFLUX_URL="http://localhost:${MINIFLUX_PORT}"
MINIFLUX_ADMIN_USER="admin"
MINIFLUX_ADMIN_PASS="miniflux-dev-password"

MATTERMOST_PORT=8065
MATTERMOST_URL="http://localhost:${MATTERMOST_PORT}"

READERMOST_PORT=8080
READERMOST_URL="http://localhost:${READERMOST_PORT}"

# The two accounts the bootstrap creates, so you can test a conversation with
# yourself across two browsers.
MM_ADMIN_EMAIL="admin@readermost.test"
MM_ADMIN_USER="admin"
MM_ADMIN_PASS="Readermost-dev-1"

MM_FRIEND_EMAIL="friend@readermost.test"
MM_FRIEND_USER="friend"
MM_FRIEND_PASS="Readermost-dev-1"

MM_TEAM="readermost"
MM_CHANNEL="reader-shared"

CONFIG_FILE="readermost.local.toml"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

# wait_for URL DESCRIPTION [ATTEMPTS]
wait_for() {
  local url="$1" what="$2" attempts="${3:-60}" i
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  die "$what did not come up at $url after $((attempts * 2))s. Try: podman logs ${MM_CONTAINER}"
}
