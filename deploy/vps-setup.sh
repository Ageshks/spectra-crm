#!/bin/sh
# First-time Ubuntu 24.04 VPS provisioning: Docker, firewall, app directory.
# Run as root on a fresh VPS, then deploy the app as the created user.
set -eu

APP_USER="${APP_USER:-spectra}"
APP_DIR="${APP_DIR:-/opt/spectra}"
API_PORT="${API_PORT:-3000}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo ./deploy/vps-setup.sh)" >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx

install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
fi
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$APP_USER"
  usermod -aG docker "$APP_USER"
fi
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR"

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "VPS ready. Next:"
echo "  1. Copy this project to $APP_DIR (as $APP_USER)"
echo "  2. Create $APP_DIR/.env from .env.example with real secrets (chmod 600)"
echo "  3. docker compose up -d --build"
echo "  4. Point DNS to this server, then: sudo certbot --nginx -d <api-domain>"
