#!/bin/zsh
#
# Commerce-track — secure credential setup
#
# Collects the five environment variables into .env.local using hidden input.
# Nothing is echoed: not to the terminal, not to the shell history, not to argv.
#
# Usage:
#   ./scripts/setup-credentials.sh          interactive entry
#   ./scripts/setup-credentials.sh --check  report which variables are set
#
set -euo pipefail

SCRIPT_DIR=${0:A:h}
PROJECT_DIR=${SCRIPT_DIR:h}
ENV_FILE="$PROJECT_DIR/.env.local"

# ---- check mode: report presence only, never values -------------------------
if [[ "${1:-}" == "--check" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    print ".env.local does not exist — nothing configured yet."
    exit 1
  fi
  # Read only the variable names, never the values.
  for name in CJ_API_KEY SERPAPI_KEY OPENAI_API_KEY OPENAI_MODEL APP_SIGNING_SECRET; do
    line=$(grep -E "^${name}=" "$ENV_FILE" || true)
    value=${line#*=}
    if [[ -n "$value" ]]; then
      print "${name}: set (${#value} chars)"
    else
      print "${name}: NOT SET"
    fi
  done
  print ""
  print "File permissions: $(stat -f '%Sp' "$ENV_FILE" 2>/dev/null || echo unknown)"
  exit 0
fi

# ---- interactive mode ------------------------------------------------------
if [[ ! -t 0 ]]; then
  print -u2 "This script needs an interactive terminal for hidden input."
  print -u2 "Run it directly from your own terminal, not through a pipe or an agent."
  exit 1
fi

umask 077

# Preserve any values already present so re-running does not wipe them.
existing_value() {
  [[ -f "$ENV_FILE" ]] || return 0
  local line
  line=$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 || true)
  print -rn -- "${line#*=}"
}

# Read one secret with echo off. Blank input keeps the existing value.
# Rejects whitespace, quotes and backslashes, which would corrupt the env file.
read_secret() {
  local name=$1 hint=$2
  local current
  current=$(existing_value "$name")

  local prompt="  ${name}"
  [[ -n "$current" ]] && prompt+=" [Enter keeps existing]"
  prompt+=": "

  local value=""
  while true; do
    print -n -- "$prompt" >&2
    value=""
    read -rs value || true
    print "" >&2

    if [[ -z "$value" ]]; then
      if [[ -n "$current" ]]; then
        REPLY="$current"
        return 0
      fi
      print -u2 "    ${name} cannot be empty. ${hint}"
      continue
    fi

    if [[ "$value" == *[[:space:]]* || "$value" == *'"'* || "$value" == *"'"* || "$value" == *'\'* ]]; then
      print -u2 "    Rejected: value contains whitespace, quotes or backslashes."
      value=""
      continue
    fi

    REPLY="$value"
    return 0
  done
}

print ""
print "Commerce-track credential setup"
print "==============================="
print "Input is hidden. Nothing is displayed or written to shell history."
print "Keys stay in $ENV_FILE (mode 0600), which .gitignore excludes."
print ""

# --- the three API keys (secrets) ---
read_secret CJ_API_KEY        "Copy it from cjdropshipping.com developer settings."
CJ_API_KEY_VALUE="$REPLY"

read_secret SERPAPI_KEY       "Copy it from your serpapi.com dashboard."
SERPAPI_KEY_VALUE="$REPLY"

read_secret OPENAI_API_KEY    "Copy it from platform.openai.com. A ChatGPT plan does not include this."
OPENAI_API_KEY_VALUE="$REPLY"

# --- runtime model (not a secret; shown as you type) ---
existing_model=$(existing_value OPENAI_MODEL)
print -n -- "  OPENAI_MODEL [${existing_model:-leave blank for now}]: " >&2
OPENAI_MODEL_VALUE=""
read -r OPENAI_MODEL_VALUE || true
if [[ -z "$OPENAI_MODEL_VALUE" ]]; then
  OPENAI_MODEL_VALUE="$existing_model"
fi

# --- signing secret: generated locally, never displayed ---
existing_secret=$(existing_value APP_SIGNING_SECRET)
if [[ -n "$existing_secret" ]]; then
  APP_SIGNING_SECRET_VALUE="$existing_secret"
  print "  APP_SIGNING_SECRET: keeping existing value" >&2
elif command -v openssl >/dev/null 2>&1; then
  APP_SIGNING_SECRET_VALUE=$(openssl rand -hex 32)
  print "  APP_SIGNING_SECRET: generated locally with openssl (64 hex chars)" >&2
else
  APP_SIGNING_SECRET_VALUE=$(LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 64)
  print "  APP_SIGNING_SECRET: generated locally from /dev/urandom" >&2
fi

# --- write atomically ---
tmp=$(mktemp "$PROJECT_DIR/.env.local.XXXXXX")
chmod 600 "$tmp"
{
  print "# Commerce-track — local secrets. Never commit this file."
  print "# Generated $(date -u '+%Y-%m-%dT%H:%M:%SZ') by scripts/setup-credentials.sh"
  print ""
  print "CJ_API_KEY=${CJ_API_KEY_VALUE}"
  print "SERPAPI_KEY=${SERPAPI_KEY_VALUE}"
  print "OPENAI_API_KEY=${OPENAI_API_KEY_VALUE}"
  print "OPENAI_MODEL=${OPENAI_MODEL_VALUE}"
  print "APP_SIGNING_SECRET=${APP_SIGNING_SECRET_VALUE}"
} > "$tmp"
mv "$tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Drop the secrets from this process before it exits.
unset CJ_API_KEY_VALUE SERPAPI_KEY_VALUE OPENAI_API_KEY_VALUE APP_SIGNING_SECRET_VALUE
unset existing_model existing_secret REPLY value

print ""
print "Wrote $ENV_FILE (mode $(stat -f '%Sp' "$ENV_FILE"))"
print ""
print "Verify with:  ./scripts/setup-credentials.sh --check"
print "Do not paste these values into any chat, issue, or commit."
