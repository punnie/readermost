#!/usr/bin/env bash
#
# Stops the local stack. Pass --purge to delete its data volumes too.

cd "$(dirname "$0")/.."
source dev/lib.sh

log "stopping containers"
podman stop "$MM_CONTAINER" "$MF_CONTAINER" "$PG_CONTAINER" 2>/dev/null || true

if [[ "${1:-}" == "--purge" ]]; then
  log "removing containers and volumes"
  podman rm -f "$MM_CONTAINER" "$MF_CONTAINER" "$PG_CONTAINER" 2>/dev/null || true
  podman volume rm readermost-pgdata readermost-mmdata readermost-mmconfig 2>/dev/null || true
  podman network rm "$NETWORK" 2>/dev/null || true
  rm -f readermost.local.toml dev/readermost.dev.db*
  log "purged — the next dev/up.sh starts from scratch"
else
  log "stopped (data kept; use --purge to wipe)"
fi
