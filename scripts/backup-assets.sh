#!/usr/bin/env bash
# 素材 Volume 備份（與 DB dump 成對保存）
#
# 用法：
#   bash scripts/backup-assets.sh
#   ASSET_DIR=/data bash scripts/backup-assets.sh
#   OUT_DIR=/mnt/backups bash scripts/backup-assets.sh
#   bash scripts/backup-assets.sh --with-db   # 同目錄再做一份 pg_dump（需 DATABASE_URL）
#
# 產出（預設 ./backups/）：
#   aios_assets_YYYYMMDD_HHMMSS.tar.gz
#   aios_assets_YYYYMMDD_HHMMSS.sha256
#   aios_assets_YYYYMMDD_HHMMSS.manifest.txt   # 檔名清單＋大小，方便抽查
#   aios_db_YYYYMMDD_HHMMSS.dump               # 僅 --with-db
#
# 還原（本機演練）：
#   mkdir -p .data && tar xzf aios_assets_....tar.gz -C .data
#   # tar 內頂層是 assets/，對應 ASSET_DIR 下的 assets/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WITH_DB=0
for arg in "$@"; do
  case "$arg" in
    --with-db) WITH_DB=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
  esac
done

if [[ -n "${ASSET_DIR:-}" ]]; then
  STORAGE_ROOT="$ASSET_DIR"
elif [[ -d /data/assets ]]; then
  STORAGE_ROOT="/data"
else
  STORAGE_ROOT="$ROOT/.data"
fi

ASSETS_SRC="$STORAGE_ROOT/assets"
OUT_DIR="${OUT_DIR:-$ROOT/backups}"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d_%H%M%S)"
BASE="aios_assets_${STAMP}"
TAR="$OUT_DIR/${BASE}.tar.gz"
SHA="$OUT_DIR/${BASE}.sha256"
MANIFEST="$OUT_DIR/${BASE}.manifest.txt"

if [[ ! -d "$ASSETS_SRC" ]]; then
  echo "[backup-assets] ERROR: 找不到素材目錄：$ASSETS_SRC" >&2
  echo "  請掛 Volume 到 /data、設 ASSET_DIR，或確認本機 .data/assets 存在" >&2
  exit 1
fi

FILE_COUNT="$(find "$ASSETS_SRC" -type f | wc -l | tr -d ' ')"
BYTE_COUNT="$(du -sb "$ASSETS_SRC" 2>/dev/null | awk '{print $1}')"
echo "[backup-assets] source=$ASSETS_SRC files=$FILE_COUNT bytes=${BYTE_COUNT:-?}"
echo "[backup-assets] writing $TAR"

# 從 STORAGE_ROOT 打包，tar 內路徑為 assets/...
tar czf "$TAR" -C "$STORAGE_ROOT" assets

# 清單：相對路徑 + 位元組（不 checksum 每個檔以免超大 Volume 過慢；整體 tar 有 sha256）
(
  echo "# aios assets manifest"
  echo "# stamp=$STAMP"
  echo "# storage_root=$STORAGE_ROOT"
  echo "# file_count=$FILE_COUNT"
  echo "# byte_count=${BYTE_COUNT:-unknown}"
  echo "# format: size_bytes<TAB>relpath"
  find "$ASSETS_SRC" -type f -printf '%s\t%P\n' 2>/dev/null || find "$ASSETS_SRC" -type f | while read -r f; do
    sz=$(wc -c <"$f" | tr -d ' ')
    rel="${f#"$ASSETS_SRC"/}"
    printf '%s\t%s\n' "$sz" "$rel"
  done
) > "$MANIFEST"

# 整體校驗和
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum "$(basename "$TAR")" > "$(basename "$SHA")")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && shasum -a 256 "$(basename "$TAR")" > "$(basename "$SHA")")
else
  echo "[backup-assets] WARN: 無 sha256sum/shasum，略過校驗檔" >&2
fi

echo "[backup-assets] ok tar=$(du -h "$TAR" | awk '{print $1}')"
echo "[backup-assets] manifest=$MANIFEST"
[[ -f "$SHA" ]] && echo "[backup-assets] checksum=$SHA"

if [[ "$WITH_DB" -eq 1 ]]; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "[backup-assets] ERROR: --with-db 需要 DATABASE_URL" >&2
    exit 1
  fi
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "[backup-assets] ERROR: 需要 postgresql-client（pg_dump）" >&2
    exit 1
  fi
  DB_OUT="$OUT_DIR/aios_db_${STAMP}.dump"
  echo "[backup-assets] pg_dump → $DB_OUT"
  pg_dump "$DATABASE_URL" -Fc -f "$DB_OUT"
  echo "[backup-assets] db ok size=$(du -h "$DB_OUT" | awk '{print $1}')"
  echo "[backup-assets] 提醒：DB 與 Volume 必須成對還原（只還 DB → 破圖；只還 Volume → 孤兒）"
fi

echo "[backup-assets] done. 請把 $OUT_DIR/${BASE}.* 與當日 DB dump 一起異地保存。"
