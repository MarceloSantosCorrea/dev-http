#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/dev-http/app}"
ENV_FILE="${ENV_FILE:-/etc/devhttp/devhttp.env}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
REPO_URL="${REPO_URL:-}"
SEED_IF_EMPTY="${SEED_IF_EMPTY:-0}"
NPM_BIN="${NPM_BIN:-$(command -v npm)}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "$REPO_URL" && ! -d "$APP_DIR/.git" ]]; then
  echo "REPO_URL é obrigatório no primeiro deploy."
  exit 1
fi

mkdir -p "$(dirname "$APP_DIR")"

if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone --branch "$DEPLOY_BRANCH" "$REPO_URL" "$APP_DIR"
fi

git config --global --add safe.directory "$APP_DIR"

cd "$APP_DIR"

current_branch="$(git branch --show-current 2>/dev/null || true)"
if [[ "$current_branch" != "$DEPLOY_BRANCH" ]]; then
  if git show-ref --verify --quiet "refs/heads/$DEPLOY_BRANCH"; then
    git checkout "$DEPLOY_BRANCH"
  else
    git fetch origin "$DEPLOY_BRANCH"
    git checkout -b "$DEPLOY_BRANCH" "origin/$DEPLOY_BRANCH"
  fi
fi

git pull --ff-only origin "$DEPLOY_BRANCH"

"$NPM_BIN" ci --include=dev
"$NPM_BIN" run db:generate
"$NPM_BIN" run build
"$NPM_BIN" run db:deploy

if [[ "$SEED_IF_EMPTY" == "1" && -n "${MYSQL_DATABASE:-}" ]]; then
  user_count="$(mysql "$MYSQL_DATABASE" -Nse 'SELECT COUNT(*) FROM `User`;' 2>/dev/null || echo 0)"
  if [[ "$user_count" == "0" ]]; then
    "$NPM_BIN" run db:seed
  fi
fi

sudo systemctl restart devhttp-api.service
sudo systemctl restart devhttp-web.service
sudo systemctl is-active --quiet devhttp-api.service
sudo systemctl is-active --quiet devhttp-web.service

curl --fail --silent --show-error http://127.0.0.1:4000/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3000 >/dev/null

echo "Deploy concluído com sucesso."
