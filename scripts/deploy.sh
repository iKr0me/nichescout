#!/bin/zsh
#
# NicheScout — deploy status & helper.
#
# This script is deliberately NON-INTERACTIVE. It never asks you to "press
# Enter" and never waits on stdin, so it cannot hang. It checks each step,
# does the ones it can, and prints the exact command for the ones that need
# YOUR browser login.
#
# Run:  ./scripts/deploy.sh          (status + do what it can)
#       ./scripts/deploy.sh --help   (explain the steps)
#
set -uo pipefail

PROJECT_DIR=${0:A:h:h}
GH_BIN="$HOME/.local/bin/gh"
VERCEL_BIN="$PROJECT_DIR/node_modules/.bin/vercel"
REPO_NAME="nichescout"

bold()  { print -P "%B$1%b"; }
ok()    { print "  ✅ $1"; }
todo()  { print "  ⬜ $1"; }
warn()  { print "  ⚠️  $1"; }
err()   { print "  ❌ $1"; }
hr()    { print "──────────────────────────────────────────────────────────" }

cd "$PROJECT_DIR" 2>/dev/null || { err "Cannot enter $PROJECT_DIR"; exit 1; }

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
NicheScout deployment — what happens and why

  1. GitHub login   (needs your browser — you must run it)
  2. Create repo + push  (the script does this once you're logged in)
  3. Vercel login   (needs your browser — you must run it)
  4. Deploy + set env vars  (script deploys; you add the variables)

Steps 1 and 3 open a browser and authenticate as YOU. No script can do
that on your behalf, which is why they're left to you.

After logging in, re-run this script and it will continue automatically.
EOF
  exit 0
fi

print ""
bold "NicheScout — deployment status"
hr

# ── 1. Tooling ───────────────────────────────────────────────────────────────
bold "1. Tooling"

[[ -x "$GH_BIN" ]] || GH_BIN=$(command -v gh 2>/dev/null || true)
if [[ -n "${GH_BIN:-}" && -x "$GH_BIN" ]]; then
  ok "GitHub CLI: $("$GH_BIN" --version 2>/dev/null | head -1)"
else
  err "GitHub CLI not found at $HOME/.local/bin/gh"
  print "     Install: download from https://cli.github.com"
fi

if [[ -x "$VERCEL_BIN" ]]; then
  ok "Vercel CLI: $("$VERCEL_BIN" --version 2>/dev/null | tail -1)"
else
  err "Vercel CLI not found. Run: npm install --save-dev vercel"
fi

# ── 2. Secrets safety ────────────────────────────────────────────────────────
bold "2. Secrets safety"
if git log --all --name-only --pretty=format: 2>/dev/null | grep -qE '^\.env$|^\.env\.local$'; then
  err "ABORT: a real .env file is in git history. Do not push."
  exit 1
fi
ok "No .env files in git history"
[[ -f .env.local ]] && ok ".env.local present (gitignored — will not be uploaded)" \
                    || warn ".env.local missing — deployed site will fail until env vars are set"

# ── 3. GitHub ────────────────────────────────────────────────────────────────
bold "3. GitHub"

GH_READY=0
if [[ -n "${GH_BIN:-}" && -x "$GH_BIN" ]]; then
  if "$GH_BIN" auth status >/dev/null 2>&1; then
    ok "Logged in as $("$GH_BIN" api user --jq .login 2>/dev/null)"
    GH_READY=1
  else
    todo "Not logged in"
    print ""
    print "     Run this in your terminal (opens a browser):"
    bold "       gh auth login"
    print "     Choose: GitHub.com → HTTPS → Login with a web browser"
    print ""
  fi
fi

if [[ $GH_READY -eq 1 ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    ok "Remote: $(git remote get-url origin)"
  else
    print "     Creating '$REPO_NAME' and pushing…"
    if "$GH_BIN" repo create "$REPO_NAME" --private --source=. --push 2>&1 | tail -3; then
      ok "Pushed to $(git remote get-url origin)"
    else
      warn "Could not create '$REPO_NAME' (name may be taken)."
      print "     Try:  gh repo create nichescout-2 --private --source=. --push"
    fi
  fi
fi

# ── 4. Vercel ────────────────────────────────────────────────────────────────
bold "4. Vercel"

VERCEL_READY=0
if [[ -x "$VERCEL_BIN" ]]; then
  VERCEL_USER=$("$VERCEL_BIN" whoami 2>/dev/null | tail -1 | tr -d '\r')
  if [[ -n "$VERCEL_USER" && "$VERCEL_USER" != "Vercel CLI"* && "$VERCEL_USER" != *"not logged in"* && "$VERCEL_USER" != *"Error"* ]]; then
    ok "Logged in as $VERCEL_USER"
    VERCEL_READY=1
  else
    todo "Not logged in"
    print ""
    print "     Run this in your terminal (opens a browser):"
    bold "       ./node_modules/.bin/vercel login"
    print "     Choose: Continue with GitHub"
    print ""
  fi
fi

if [[ $VERCEL_READY -eq 1 ]]; then
  print "     Deploying to production…"
  "$VERCEL_BIN" --prod --yes 2>&1 | tail -6
fi

# ── 5. Environment variables ─────────────────────────────────────────────────
bold "5. Environment variables (REQUIRED for the live site)"
print ""
print "  Without these the site loads but every action fails."
print "  Add them at: vercel.com → your project → Settings → Environment Variables"
print "  For each, enable Production, Preview, AND Development."
print ""

if [[ -f .env.local ]]; then
  while IFS= read -r line; do
    case "$line" in
      CJ_API_KEY=*|SERPAPI_KEY=*|OPENAI_API_KEY=*|OPENAI_MODEL=*|APP_SIGNING_SECRET=*)
        key=${line%%=*}
        value=${line#*=}
        if [[ -n "$value" ]]; then
          print "    $key  (${#value} chars — copy the value from .env.local)"
        else
          err "$key is EMPTY in .env.local — set it before deploying"
        fi
        ;;
    esac
  done < .env.local
  print ""
  print "  Print the real values with:"
  bold "    grep -E '^(CJ_API_KEY|SERPAPI_KEY|OPENAI_API_KEY|OPENAI_MODEL|APP_SIGNING_SECRET)=' .env.local"
else
  warn "No .env.local found — create it with ./scripts/prepare-env.sh"
fi

print ""
print "  After adding them, redeploy so they take effect:"
bold "    ./node_modules/.bin/vercel --prod"

# ── 6. Cost warning ──────────────────────────────────────────────────────────
print ""
hr
bold "⚠️  Cost warning"
print "  NicheScout has no login and no rate limiting. Anyone with the URL"
print "  spends YOUR API credits. SerpApi's free tier is 250 searches/month"
print "  and one evaluation uses 4–7."
print ""
print "  Before sharing the link, set hard spend caps in your OpenAI,"
print "  SerpApi, and CJ dashboards."
hr
print ""
print "Re-run this script any time to see what's done and what's next."
print ""
