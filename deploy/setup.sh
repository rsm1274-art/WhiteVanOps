#!/bin/bash
# White Van Ops — First-time setup script
# Run this once on a fresh Linux server (Ubuntu 22.04 recommended)
set -e

echo "=============================================="
echo "  White Van Ops — Initial Setup"
echo "=============================================="

# 1. Install Docker if missing
if ! command -v docker &> /dev/null; then
  echo "[setup] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "$USER"
  echo "[setup] Docker installed. You may need to log out and back in."
fi

# 2. Install Docker Compose plugin if missing
if ! docker compose version &> /dev/null; then
  echo "[setup] Installing Docker Compose plugin..."
  apt-get install -y docker-compose-plugin
fi

# 3. Generate .env if it doesn't exist
if [ ! -f .env ]; then
  echo "[setup] Creating .env file..."

  read -rp "Enter admin username: " APP_USERNAME
  read -rsp "Enter admin password: " APP_PASSWORD
  echo
  read -rsp "Enter a strong database password: " POSTGRES_PASSWORD
  echo

  SESSION_SECRET=$(openssl rand -hex 32)

  cat > .env <<EOF
APP_USERNAME=${APP_USERNAME}
APP_PASSWORD=${APP_PASSWORD}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
SESSION_SECRET=${SESSION_SECRET}
EOF

  echo "[setup] .env created."
else
  echo "[setup] .env already exists — skipping credential setup."
fi

# 4. Generate initial Prisma migration if none exists
if [ ! -d "prisma/migrations" ]; then
  echo "[setup] Creating initial database migration..."
  # Temporarily start just the DB to run the migration
  docker compose up -d db
  sleep 5
  export $(grep -v '^#' .env | xargs)
  DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/whitevanops" \
    npx prisma migrate dev --name init
  docker compose down
fi

# 5. Build and start
echo "[setup] Building and starting services..."
docker compose up -d --build

echo ""
echo "=============================================="
echo "  Setup complete!"
echo "  App is running at http://localhost:3000"
echo ""
echo "  For remote field access, set up Cloudflare Tunnel:"
echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/"
echo "=============================================="
