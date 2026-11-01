#!/usr/bin/env bash
# Curl-through-the-rollout: the gap measurement for CHROMA RUSH.
#
#   ./tools/rollout-watch.sh [timeout_seconds]
#
# Why: the release contract is a digest bump in home-ops' deployment.yaml, and the strategy is
# RollingUpdate with maxUnavailable:0 / maxSurge:1. "Gap-free" is a claim about the *client*, so it
# has to be measured from the client: keep one curl loop running across the swap and count non-200s.
# A connection refused / 502 / 503 in that stream is a user-visible outage, and the timestamp shows
# whether it lines up with the pod swap.
#
# It also detects the swap itself by watching the sha256 of the served /game.js, so the report says
# WHEN the bytes changed, not just whether requests failed.
#
# Exit: 0 if the new bytes arrived with zero non-200 responses, 1 if the timeout elapsed with the old
# bytes still served (rollout never happened in the window), 2 if the rollout happened AND the stream
# had non-200s (the gap is real — report it, do not "it works now").
set -euo pipefail

URL="${URL:-https://chroma-rush.dev.initialed85.cc}"
TIMEOUT="${1:-240}"
OLD_SHA="${OLD_SHA:-$(curl -s "$URL/game.js" | sha256sum | cut -d' ' -f1)}"

echo "watching $URL"
echo "pre-rollout game.js sha256: $OLD_SHA"
echo "budget: ${TIMEOUT}s, one request per second, /healthz plus a /game.js sha every 5th second"
echo

t0=$(date +%s)
total=0; bad=0; first_bad=""; last_bad=""; swap_at=""; codes=""; samples=0
while :; do
  now=$(date +%s); el=$((now - t0))
  [ "$el" -ge "$TIMEOUT" ] && break
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$URL/healthz" || echo "ERR")
  total=$((total + 1))
  if [ "$code" != "200" ]; then
    bad=$((bad + 1))
    [ -z "$first_bad" ] && first_bad="${el}s ($code)"
    last_bad="${el}s ($code)"
    codes="${codes}${el}s:${code} "
  fi
  if [ $((total % 5)) -eq 0 ]; then
    samples=$((samples + 1))
    cur=$(curl -s -m 10 "$URL/game.js" | sha256sum | cut -d' ' -f1)
    if [ "$cur" != "$OLD_SHA" ] && [ -z "$swap_at" ]; then
      swap_at="${el}s (sha ${cur:0:12})"
    fi
  fi
  sleep 1
done

echo
echo "requests        $total (one per second, ${TIMEOUT}s window)"
echo "non-200/failed  $bad"
[ -n "$first_bad" ] && echo "first bad       $first_bad · last $last_bad"
[ -n "$codes" ] && echo "bad sequence    $codes"
echo "sha samples     $samples"
if [ -n "$swap_at" ]; then
  echo "new bytes seen  at $swap_at"
  echo "verdict         $( [ "$bad" -eq 0 ] && echo 'ROLLOUT WAS GAP-FREE from the client (0 non-200 in the whole stream)' || echo 'ROLLOUT HAD A GAP ('"$bad"' non-200 responses) — the strategy needs a second look' )"
  [ "$bad" -eq 0 ] && exit 0 || exit 2
else
  echo "new bytes seen  never (timeout elapsed with the old bytes still served)"
  echo "verdict         no rollout happened in this window; ask the manifest owner / try again"
  exit 1
fi
