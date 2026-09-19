#!/bin/zsh
#
# Commerce-track — prepare .env.local for manual (editor) secret entry.
#
# Mel-compatible path: Mel has no interactive terminal, so hidden `read -s`
# entry cannot run there. Instead this script does the non-interactive,
# non-secret parts and leaves the three key fields blank for the user to
# paste into their own local editor. No secret is ever displayed or written
# by this script (the signing secret is generated, never printed).
#
# Usage:
#   ./scripts/prepare-env.sh                    create scaffolding + generate signing secret
#   ./scripts/setup-credentials.sh --check      verify presence only (never values)
#
set -euo pipefail

SCRIPT_DIR=${0:A:h}
PROJECT_DIR=${SCRIPT_DIR:h}
TEMPLATE="$PROJECT_DIR/.env.example"
ENV_FILE="$PROJECT_DIR/.env.local"

[[ -f "$TEMPLATE" ]] || { print -u2 "Missing template: $TEMPLATE"; exit 1; }

umask 077

# 1. Create .env.local from the template if it does not exist (never overwrite).
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$TEMPLATE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  print "Created $ENV_FILE from template."
else
  print "$ENV_FILE already exists — leaving existing values untouched."
fi

# 2. Generate APP_SIGNING_SECRET if a valid 64-hex value is not already set.
if ! grep -qE '^APP_SIGNING_SECRET=[0-9a-f]{64}$' "$ENV_FILE"; then
  if command -v openssl >/dev/null 2>&1; then
    secret=$(openssl rand -hex 32)
  else
    secret=$(LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 64)
  fi
  if grep -qE '^APP_SIGNING_SECRET=' "$ENV_FILE"; then
    tmp=$(mktemp "$PROJECT_DIR/.env.local.XXXXXX")
    chmod 600 "$tmp"
    sed "s|^APP_SIGNING_SECRET=.*|APP_SIGNING_SECRET=${secret}|" "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    print "APP_SIGNING_SECRET=${secret}" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
  unset secret
  print "Generated APP_SIGNING_SECRET locally (64 hex chars — not displayed)."
fi

chmod 600 "$ENV_FILE"

print ""
print "Next: open the file in YOUR OWN editor and paste the three keys."
print "  nano $ENV_FILE"
print "  # or: code $ENV_FILE   |   open -e $ENV_FILE"
print ""
print "Fill only these three (leave OPENAI_MODEL blank for now):"
print "  CJ_API_KEY=..."
print "  SERPAPI_KEY=..."
print "  OPENAI_API_KEY=..."
print ""
print "Then verify presence (never values) with:"
print "  ./scripts/setup-credentials.sh --check"
print ""
print "File permissions: $(stat -f '%Sp' "$ENV_FILE")"
