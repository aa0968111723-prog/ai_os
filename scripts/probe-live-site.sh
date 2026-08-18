#!/usr/bin/env bash
# Structural probe of the official live site. No login, no writes, no FAL.
set -euo pipefail
BASE="${LIVE_SITE_URL:-https://ai-os-ten.vercel.app}"
OUT="${1:-/tmp/live-site-probe.json}"

probe() {
  local path="$1"
  local code ctype
  code=$(curl -sS -D /tmp/live-probe-headers.txt -o /tmp/live-probe-body.txt -w "%{http_code}" --max-time 20 "${BASE}${path}" || echo "000")
  ctype=$(grep -i '^content-type:' /tmp/live-probe-headers.txt | head -n1 | tr -d '\r')
  local bytes
  bytes=$(wc -c < /tmp/live-probe-body.txt | tr -d ' ')
  local hint
  hint=$(head -c 80 /tmp/live-probe-body.txt | tr '\n' ' ')
  python3 -c 'import json,sys; print(json.dumps({"path":sys.argv[1],"status":int(sys.argv[2]) if sys.argv[2].isdigit() else sys.argv[2],"bytes":int(sys.argv[3]),"contentType":sys.argv[4],"hint":sys.argv[5]}, ensure_ascii=False))' \
    "$path" "$code" "$bytes" "$ctype" "$hint"
}

{
  echo "{"
  echo "  \"base\": \"${BASE}\","
  echo "  \"probedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"note\": \"VM cannot log in. Grok Bot operator drives live UI. Disposable projects must use overnight-test- prefix in 動畫組.\","
  echo "  \"routes\": ["
  first=1
  for p in / /login /auth /projects /api/ready /api/health /api/trpc /favicon.ico; do
    if [[ $first -eq 1 ]]; then first=0; else echo ","; fi
    echo -n "    $(probe "$p")"
  done
  echo
  echo "  ]"
  echo "}"
} | tee "$OUT"
