#!/usr/bin/env bash
#
# Brings up Miniflux and Mattermost locally so Readermost has something real to
# talk to. Run dev/bootstrap.sh afterwards to register the OAuth app.

cd "$(dirname "$0")/.."
source dev/lib.sh

command -v podman >/dev/null || die "podman is not installed"

log "creating network ${NETWORK}"
podman network exists "$NETWORK" 2>/dev/null || podman network create "$NETWORK" >/dev/null

log "starting postgres"
if ! podman container exists "$PG_CONTAINER" 2>/dev/null; then
  podman run -d --name "$PG_CONTAINER" --network "$NETWORK" \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -e POSTGRES_DB=miniflux \
    -v readermost-pgdata:/var/lib/postgresql/data \
    "$PG_IMAGE" >/dev/null
else
  podman start "$PG_CONTAINER" >/dev/null
fi

log "waiting for postgres"
for i in {1..60}; do
  if podman exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  [[ $i -eq 60 ]] && die "postgres did not become ready"
  sleep 1
done

# Mattermost needs its own database alongside Miniflux's.
podman exec "$PG_CONTAINER" psql -U postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname='mattermost'" | grep -q 1 || \
  podman exec "$PG_CONTAINER" createdb -U postgres mattermost

log "starting miniflux on ${MINIFLUX_URL}"
if ! podman container exists "$MF_CONTAINER" 2>/dev/null; then
  podman run -d --name "$MF_CONTAINER" --network "$NETWORK" \
    -p "${MINIFLUX_PORT}:8080" \
    -e DATABASE_URL="postgres://postgres:${PG_PASSWORD}@${PG_CONTAINER}/miniflux?sslmode=disable" \
    -e RUN_MIGRATIONS=1 \
    -e CREATE_ADMIN=1 \
    -e ADMIN_USERNAME="$MINIFLUX_ADMIN_USER" \
    -e ADMIN_PASSWORD="$MINIFLUX_ADMIN_PASS" \
    -e LISTEN_ADDR=0.0.0.0:8080 \
    "$MF_IMAGE" >/dev/null
else
  podman start "$MF_CONTAINER" >/dev/null
fi

log "starting mattermost on ${MATTERMOST_URL}"
if ! podman container exists "$MM_CONTAINER" 2>/dev/null; then
  podman run -d --name "$MM_CONTAINER" --network "$NETWORK" \
    -p "${MATTERMOST_PORT}:8065" \
    -e MM_SQLSETTINGS_DRIVERNAME=postgres \
    -e MM_SQLSETTINGS_DATASOURCE="postgres://postgres:${PG_PASSWORD}@${PG_CONTAINER}:5432/mattermost?sslmode=disable&connect_timeout=10" \
    -e MM_SERVICESETTINGS_SITEURL="$MATTERMOST_URL" \
    -e MM_SERVICESETTINGS_ENABLEOAUTHSERVICEPROVIDER=true \
    -e MM_SERVICESETTINGS_ENABLELOCALMODE=true \
    -e MM_TEAMSETTINGS_ENABLEOPENSERVER=true \
    -e MM_PLUGINSETTINGS_ENABLE=false \
    -e MM_LOGSETTINGS_CONSOLELEVEL=WARN \
    -v readermost-mmdata:/mattermost/data \
    -v readermost-mmconfig:/mattermost/config \
    "$MM_IMAGE" >/dev/null
else
  podman start "$MM_CONTAINER" >/dev/null
fi

log "waiting for miniflux"
wait_for "${MINIFLUX_URL}/healthcheck" "miniflux"

log "waiting for mattermost (first boot runs migrations, this can take a minute)"
wait_for "${MATTERMOST_URL}/api/v4/system/ping" "mattermost" 120

log "up"
echo
echo "  miniflux    ${MINIFLUX_URL}   (${MINIFLUX_ADMIN_USER} / ${MINIFLUX_ADMIN_PASS})"
echo "  mattermost  ${MATTERMOST_URL}"
echo
echo "Next: dev/bootstrap.sh"
