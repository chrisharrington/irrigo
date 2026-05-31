#!/usr/bin/env bash
#
# Apply pending Drizzle migrations against the stack's Postgres in a one-off
# api container. `docker compose run --rm` spins up a throwaway container
# from the api image, runs the migrate script, and removes the container on
# exit — the long-running api service is left alone. Once migrations finish
# we restart the api container so it picks up the new schema.

set -euo pipefail

cd "$(dirname "$0")"

docker compose run --rm api bun run db:migrate
docker compose restart api
