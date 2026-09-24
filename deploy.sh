#!/usr/bin/env bash
# Deploys WeatherDash over ssh/scp to any host that serves PHP. Each
# environment is fully contained in its own folder beneath the web root:
#
#   production: $DEPLOY_WEB_ROOT/$PROD_FOLDER/
#   development: $DEPLOY_WEB_ROOT/$DEV_FOLDER/
#
# Within either folder:
#   /          built frontend
#   /api/      JSON endpoints
#   /private/  backend code, config.json, SQLite db, cache, sessions and cron log
#
# private/ ships an .htaccess that denies web requests, so only PHP reads it.
#
# Server details come from deploy.config (gitignored; copy deploy.config.example)
# or from environment variables of the same names, which win over the file.

set -euo pipefail

TARGET="${1:-}"

CONFIG_VARS="DEPLOY_HOST DEPLOY_USER DEPLOY_PORT DEPLOY_WEB_ROOT SITE_ORIGIN PROD_FOLDER DEV_FOLDER"
# Keep whatever the environment already set, so it overrides the file.
for var in $CONFIG_VARS; do
  if [ -n "${!var:-}" ]; then printf -v "ENV_$var" '%s' "${!var}"; fi
done
CONFIG_FILE="$(dirname "$0")/deploy.config"
if [ -f "$CONFIG_FILE" ]; then
  # Carriage returns stripped, in case a Windows editor saved it with CRLF endings.
  # shellcheck source=/dev/null
  . <(tr -d '\r' < "$CONFIG_FILE")
fi
for var in $CONFIG_VARS; do
  env_var="ENV_$var"
  if [ -n "${!env_var:-}" ]; then printf -v "$var" '%s' "${!env_var}"; fi
done
for var in DEPLOY_HOST DEPLOY_USER DEPLOY_WEB_ROOT SITE_ORIGIN; do
  if [ -z "${!var:-}" ]; then
    echo "$var is not set. Copy deploy.config.example to deploy.config and fill it in."
    exit 1
  fi
done
DEPLOY_PORT="${DEPLOY_PORT:-22}"
PROD_FOLDER="${PROD_FOLDER-weatherdash}"
DEV_FOLDER="${DEV_FOLDER-weatherdash-dev}"
SITE_ORIGIN="${SITE_ORIGIN%/}"
DEPLOY_WEB_ROOT="${DEPLOY_WEB_ROOT%/}"

case "$TARGET" in
  prod)
    EXPECTED_BRANCH="prod"
    SITE_FOLDER="$PROD_FOLDER"
    ;;
  dev)
    EXPECTED_BRANCH="dev"
    SITE_FOLDER="$DEV_FOLDER"
    ;;
  *)
    echo "Usage: ./deploy.sh dev|prod"
    exit 1
    ;;
esac

# An empty folder deploys to the web root itself.
BASE_PATH="/${SITE_FOLDER:+$SITE_FOLDER/}"
SITE_URL="$SITE_ORIGIN${SITE_FOLDER:+/$SITE_FOLDER}"

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]; then
  echo "Refusing to deploy $TARGET from branch '$CURRENT_BRANCH'."
  echo "Switch to the '$EXPECTED_BRANCH' branch first."
  exit 1
fi

HOST="$DEPLOY_HOST"
USER="$DEPLOY_USER"
PORT="$DEPLOY_PORT"
REMOTE="$DEPLOY_WEB_ROOT${SITE_FOLDER:+/$SITE_FOLDER}"

echo "=== 1. Building $TARGET frontend for $BASE_PATH ==="
# Git Bash on Windows rewrites arguments that look like Unix paths before
# handing them to Windows programs, which turned "/weatherdash-dev/" into
# "C:/Program Files/Git/weatherdash-dev/". Keep the base path literal.
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' npm run build -- --base "$BASE_PATH"

# Never ship a page that loads its scripts from anywhere but this environment.
if ! grep -q "src=\"$BASE_PATH" dist/index.html; then
  echo "FAILED: dist/index.html does not load its scripts from $BASE_PATH."
  grep -o 'src="[^"]*"' dist/index.html || true
  exit 1
fi

# The web-root .htaccess names the base path in its rewrite rules, so each
# environment gets its own copy; otherwise dev would fall back to prod's page.
# The build writes it with this environment's base path filled in.
HTACCESS="dist/.htaccess"
if ! grep -qxF "  RewriteBase $BASE_PATH" "$HTACCESS"; then
  echo "FAILED: $HTACCESS does not rewrite to $BASE_PATH."
  exit 1
fi

# The new build is uploaded beside the live one, into a staging folder inside
# the app folder, and swapped in by one ssh command once it is all there. The
# live site never has its assets missing while scp is still running.
STAGE="$REMOTE/.deploy-new"

echo "=== 2. Preparing $REMOTE ==="
ssh -p "$PORT" "$USER@$HOST" "mkdir -p '$REMOTE/api' '$REMOTE/private' && rm -rf '$STAGE' && mkdir -p '$STAGE'"

echo "=== 3. Uploading frontend to staging ==="
scp -P "$PORT" -r dist/* "$USER@$HOST:$STAGE/"

# Backend before endpoints: a new endpoint may call a helper only the new
# backend has, while the old endpoints still work against the new backend.
echo "=== 4. Uploading private backend ==="
# Only code: config.json and the runtime folders (db/, cache/, sessions/, logs/)
# live on the server and are created there as needed.
scp -P "$PORT" backend/*.php backend/config.json.example backend/.htaccess "$USER@$HOST:$REMOTE/private/"

echo "=== 5. Uploading API endpoints ==="
scp -P "$PORT" public_html/api/*.php "$USER@$HOST:$REMOTE/api/"

echo "=== 6. Swapping in the new frontend ==="
# New hashed assets are added next to the old ones rather than replacing the
# folder, so a visitor still on the previous index.html can load its chunks;
# assets not rewritten by this build or a later one are dropped after a week.
# index.html goes last, so it never points at files that are not there yet.
# api/ and private/ are never touched, whatever the build happens to contain.
ssh -p "$PORT" "$USER@$HOST" "REMOTE='$REMOTE' STAGE='$STAGE' bash -s" <<'SWAP'
set -e
cd "$REMOTE"
mkdir -p assets
if [ -d "$STAGE/assets" ]; then
    cp -R "$STAGE/assets/." assets/
fi
for entry in "$STAGE"/*; do
    name=$(basename "$entry")
    case "$name" in
        index.html|assets|api|private) ;;
        *) rm -rf "./$name" && mv "$entry" "./$name" ;;
    esac
done
mv -f "$STAGE/index.html" index.html
rm -rf "$STAGE"
find assets -type f -mtime +7 -delete
SWAP
scp -P "$PORT" "$HTACCESS" "$USER@$HOST:$REMOTE/.htaccess"

echo "=== 7. Checking that private/ is not served ==="
status="$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/private/config.json")"
if [ "$status" = "403" ] || [ "$status" = "404" ]; then
  echo "OK: private/ returns $status"
else
  echo "FAILED: private/config.json returned $status — the .htaccess is not taking effect."
  exit 1
fi

if ! ssh -p "$PORT" "$USER@$HOST" "test -f '$REMOTE/private/config.json'"; then
  echo "WARNING: $REMOTE/private/config.json is missing."
  echo "Create it from config.json.example (Google client ID)."
fi

echo "=== Done: $SITE_URL ==="
if [ "$TARGET" = "prod" ]; then
  echo "Cron (every 5 minutes): php $REMOTE/private/cron.php"
fi
