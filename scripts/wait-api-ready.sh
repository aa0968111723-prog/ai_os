#!/usr/bin/env bash
# 等待 GET /api/ready 真正就緒（HTTP 200 + ok:true + boot 以 ready 開頭）。
#
# 為何不用 `curl -sf | grep '"boot":"ready'`：
# 1. 初始化中 ready 回 503 時 -f 直接失敗，看不到 body。
# 2. 並行壓力下可能短暫 000/Bad Gateway，需要重試與診斷輸出。
# 3. 整體就緒以 ok:true 為準（runner/provider/storage 也算），不只看 boot 字串。
#
# 用法：
#   bash scripts/wait-api-ready.sh [base_url] [max_seconds]
# 預設 base_url=http://127.0.0.1:${PORT:-3199}、max=90
set -u

BASE_URL="${1:-http://127.0.0.1:${PORT:-3199}}"
MAX_SEC="${2:-90}"
READY_URL="${BASE_URL%/}/api/ready"
TMP_BODY="${TMPDIR:-/tmp}/wait-api-ready-$$.json"

cleanup() { rm -f "$TMP_BODY" 2>/dev/null || true; }
trap cleanup EXIT

is_ready_body() {
  # 容忍空白；boot 值為「ready（初始化完成）」等以 ready 開頭的字串
  echo "$1" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true' \
    && echo "$1" | grep -qE '"boot"[[:space:]]*:[[:space:]]*"ready'
}

for i in $(seq 1 "$MAX_SEC"); do
  code=$(curl -sS -o "$TMP_BODY" -w '%{http_code}' --max-time 3 "$READY_URL" 2>/dev/null || echo 000)
  body=$(cat "$TMP_BODY" 2>/dev/null || true)
  if [ "$code" = "200" ] && is_ready_body "$body"; then
    echo "[wait-api-ready] ready after ${i}s ($READY_URL)"
    exit 0
  fi
  sleep 1
done

echo "[wait-api-ready] TIMEOUT after ${MAX_SEC}s — $READY_URL" >&2
echo "[wait-api-ready] last HTTP code: ${code:-unknown}" >&2
echo "[wait-api-ready] last body: ${body:-<empty>}" >&2
exit 1
