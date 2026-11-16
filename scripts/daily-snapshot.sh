#!/usr/bin/env bash
# Daily RWA monitor run (DPO2U VPS). Builds a fresh snapshot against the
# previous one (for alerts) and publishes it where the site serves it.
#
# Env (from a 600 env file, never from the repo):
#   CMC_API_KEY        CoinMarketCap key
#   SANCTIONS_FILE     OFAC list built by scripts/fetch-ofac.ts (refreshed here)
#   RWA_DATA_DIR       working dir, keeps history (default /root/dpo2u-rwa-data)
#   RWA_PUBLISH_PATH   file the site serves as /rwa/data/snapshot.json
set -euo pipefail
cd "$(dirname "$0")/.."

DATA="${RWA_DATA_DIR:-/root/dpo2u-rwa-data}"
mkdir -p "$DATA/history"
: "${CMC_API_KEY:?CMC_API_KEY missing}"
: "${RWA_PUBLISH_PATH:?RWA_PUBLISH_PATH missing}"
export SANCTIONS_FILE="${SANCTIONS_FILE:-$DATA/ofac-sdn.txt}"

# Refresh the OFAC list; keep yesterday's if the download fails.
if npx tsx scripts/fetch-ofac.ts > "$DATA/ofac-sdn.txt.new" && [ "$(wc -l < "$DATA/ofac-sdn.txt.new")" -gt 1000 ]; then
  mv "$DATA/ofac-sdn.txt.new" "$SANCTIONS_FILE"
else
  echo "warn: OFAC refresh failed, keeping previous list" >&2
  rm -f "$DATA/ofac-sdn.txt.new"
fi

npx tsx src/cli.ts snapshot --out "$DATA/latest.json"

# Never publish a file that carries the key.
if grep -q "$CMC_API_KEY" "$DATA/latest.json"; then echo "abort: key found in snapshot" >&2; exit 1; fi

cp "$DATA/latest.json" "$DATA/history/$(date -u +%F).json"
install -m 644 "$DATA/latest.json" "$RWA_PUBLISH_PATH.tmp" && mv "$RWA_PUBLISH_PATH.tmp" "$RWA_PUBLISH_PATH"
# The page also reads the policy and the issuer registry next to the snapshot;
# publish them from the repo so they never drift from the code that ran.
PUB_DIR="$(dirname "$RWA_PUBLISH_PATH")"
install -m 644 policy/reference-v0.json "$PUB_DIR/policy.json.tmp" && mv "$PUB_DIR/policy.json.tmp" "$PUB_DIR/policy.json"
install -m 644 registry/issuers.json "$PUB_DIR/issuers.json.tmp" && mv "$PUB_DIR/issuers.json.tmp" "$PUB_DIR/issuers.json"
echo "published $(date -u +%FT%TZ)"
