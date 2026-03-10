#!/usr/bin/env bash

set -euo pipefail

SERVER_NAME="${SERVER_NAME:-devhttp.marcelocorrea.com.br}"
APP_ROOT="${APP_ROOT:-/var/www/dev-http}"
APP_DIR="${APP_DIR:-$APP_ROOT/app}"
ENV_DIR="${ENV_DIR:-/etc/devhttp}"
ENV_FILE="${ENV_FILE:-$ENV_DIR/devhttp.env}"
SITE_NAME="${SITE_NAME:-devhttp.conf}"
REPO_URL="${REPO_URL:-https://github.com/MarceloSantosCorrea/dev-http.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
DB_NAME="${DB_NAME:-devhttp_prod}"
DB_USER="${DB_USER:-devhttp}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 18)}"
SEED_ADMIN_NAME="${SEED_ADMIN_NAME:-Marcelo Correa}"
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@devhttp.local}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-$(openssl rand -hex 12)}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-/api}"
CORS_ORIGIN="${CORS_ORIGIN:-https://$SERVER_NAME}"
COOKIE_SECURE="${COOKIE_SECURE:-true}"
NPM_BIN="${NPM_BIN:-$(command -v npm)}"

render_template() {
  local source_file="$1"
  local target_file="$2"

  sed \
    -e "s#__SERVER_NAME__#${SERVER_NAME}#g" \
    -e "s#__APP_DIR__#${APP_DIR}#g" \
    -e "s#__ENV_FILE__#${ENV_FILE}#g" \
    -e "s#__NPM_BIN__#${NPM_BIN}#g" \
    "$source_file" | sudo tee "$target_file" >/dev/null
}

sudo install -d -m 0755 "$APP_ROOT"
sudo chown ubuntu:ubuntu "$APP_ROOT"
sudo install -d -m 0755 "$ENV_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  sudo tee "$ENV_FILE" >/dev/null <<EOF
NODE_ENV=production
PORT=4000
CORS_ORIGIN=${CORS_ORIGIN}
COOKIE_SECURE=${COOKIE_SECURE}
NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
MYSQL_DATABASE=${DB_NAME}
MYSQL_USER=${DB_USER}
MYSQL_PASSWORD=${DB_PASSWORD}
DATABASE_URL=mysql://${DB_USER}:${DB_PASSWORD}@${MYSQL_HOST}:3306/${DB_NAME}
SEED_ADMIN_NAME=${SEED_ADMIN_NAME}
SEED_ADMIN_EMAIL=${SEED_ADMIN_EMAIL}
SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD}
EOF
  sudo chown root:ubuntu "$ENV_FILE"
  sudo chmod 0640 "$ENV_FILE"
fi

sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

render_template "deploy/apache/devhttp.conf" "/etc/apache2/sites-available/${SITE_NAME}"
sudo a2ensite "${SITE_NAME}" >/dev/null
sudo apache2ctl configtest
sudo systemctl reload apache2

render_template "deploy/systemd/devhttp-api.service" "/etc/systemd/system/devhttp-api.service"
render_template "deploy/systemd/devhttp-web.service" "/etc/systemd/system/devhttp-web.service"
sudo systemctl daemon-reload
sudo systemctl enable devhttp-api.service devhttp-web.service >/dev/null

if git ls-remote "$REPO_URL" >/dev/null 2>&1; then
  if [[ ! -d "$APP_DIR/.git" ]]; then
    git clone --branch "$DEPLOY_BRANCH" "$REPO_URL" "$APP_DIR"
  fi

  APP_DIR="$APP_DIR" \
  ENV_FILE="$ENV_FILE" \
  DEPLOY_BRANCH="$DEPLOY_BRANCH" \
  REPO_URL="$REPO_URL" \
  NPM_BIN="$NPM_BIN" \
  SEED_IF_EMPTY=1 \
  /bin/bash "$APP_DIR/scripts/deploy-remote.sh"
else
  echo "Repositório ainda não disponível em $REPO_URL. Bootstrap básico concluído."
fi

if [[ -n "$LETSENCRYPT_EMAIL" ]] && [[ ! -f "/etc/letsencrypt/renewal/${SERVER_NAME}.conf" ]]; then
  sudo certbot --apache \
    --non-interactive \
    --agree-tos \
    --redirect \
    --email "$LETSENCRYPT_EMAIL" \
    -d "$SERVER_NAME"
fi

echo "Bootstrap concluído."
echo "Arquivo de ambiente: $ENV_FILE"
echo "Domínio configurado: $SERVER_NAME"
