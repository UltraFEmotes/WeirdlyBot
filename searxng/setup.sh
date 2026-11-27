#!/bin/sh
# One-time setup: create a random secret, then start SearXNG.
set -e
cd "$(dirname "$0")"
[ -f .env ] || printf 'SEARXNG_SECRET=%s\n' "$(openssl rand -hex 32)" > .env
docker compose up -d
echo "SearXNG is running at http://127.0.0.1:8888"
