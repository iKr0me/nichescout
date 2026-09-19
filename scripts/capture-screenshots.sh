#!/bin/zsh
#
# Capture real PNG screenshots of the NicheScout UI for the repo / judges.
#
# Uses headless Chrome against the offline fixtures in snapshots/ — no live
# API calls, no network, no API credits spent.
#
# Usage:  ./scripts/capture-screenshots.sh
#
set -uo pipefail

PROJECT_DIR=${0:A:h:h}
FIXTURES="$PROJECT_DIR/snapshots"
OUT="$PROJECT_DIR/docs/screenshots"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8899

if [[ ! -x "$CHROME" ]]; then
  print "Chrome not found at: $CHROME"
  print "Install Google Chrome, or edit CHROME= in this script."
  exit 1
fi

mkdir -p "$OUT"

# Serve the fixtures on a local port (fixtures are self-contained HTML).
cd "$FIXTURES" || exit 1
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 1.5

cleanup() { kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT

shoot() {
  local name=$1 width=$2 height=$3
  "$CHROME" \
    --headless \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=2 \
    --virtual-time-budget=2500 \
    --window-size="${width},${height}" \
    --screenshot="$OUT/${name}.png" \
    "http://localhost:${PORT}/${name}.html" >/dev/null 2>&1
  if [[ -f "$OUT/${name}.png" ]]; then
    print "  ✓ ${name}.png  (${width}×${height})"
  else
    print "  ✗ ${name}.png  FAILED"
  fi
}

print ""
print "Capturing NicheScout screenshots → docs/screenshots/"
print ""

# Desktop
shoot "intro-01-problem"            1440 900
shoot "intro-02-consequence"        1440 900
shoot "intro-03-solution"           1440 900
shoot "intro-04-invitation"         1440 900
shoot "01-initial"                  1440 1000
shoot "02-criteria"                 1440 1000
shoot "03-confirm"                  1440 1000
shoot "04-results-needs-more"       1440 1000
shoot "05-results-with-listing"     1440 1200

# Mobile
shoot "intro-mobile-390"            390  844

print ""
print "Done. $(( $(ls -1 "$OUT" | wc -l | tr -d ' ') )) PNG files in docs/screenshots/"
print ""
