#!/bin/bash
# White Van Ops — Update script
# Pulls latest code, runs any new migrations, and restarts with zero data loss.
set -e

echo "=============================================="
echo "  White Van Ops — Applying Update"
echo "=============================================="

# 1. Pull latest code
echo "[update] Pulling latest changes..."
git pull

# 2. Build new image (app stays running during build)
echo "[update] Building new image..."
docker compose build app

# 3. Restart app container (DB stays up — no data loss)
echo "[update] Restarting app (migrations run automatically on start)..."
docker compose up -d --no-deps app

echo ""
echo "[update] Done. App is back up at http://localhost:3000"
