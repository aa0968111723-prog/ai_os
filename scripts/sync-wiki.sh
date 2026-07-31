#!/usr/bin/env bash
# 將 docs/wiki/*.md 同步到 GitHub Wiki（需已建立過至少一頁，且 git 可推送 wiki）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/wiki"
WIKI_DIR="${WIKI_DIR:-/tmp/ai_os.wiki-sync}"
REMOTE="${WIKI_REMOTE:-https://github.com/aa0968111723-prog/ai_os.wiki.git}"

if [[ ! -d "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi

rm -rf "$WIKI_DIR"
if ! git clone "$REMOTE" "$WIKI_DIR" 2>/tmp/wiki-clone.err; then
  echo "無法 clone Wiki 遠端。請先在瀏覽器建立第一頁：" >&2
  echo "  https://github.com/aa0968111723-prog/ai_os/wiki" >&2
  cat /tmp/wiki-clone.err >&2 || true
  exit 1
fi

find "$SRC" -maxdepth 1 -name '*.md' ! -name 'README.md' -exec cp {} "$WIKI_DIR/" \;

cd "$WIKI_DIR"
git add -A
if git diff --cached --quiet; then
  echo "Wiki 已是最新，無需推送。"
  exit 0
fi
git -c user.email="noreply@github.com" -c user.name="wiki-sync" commit -m "docs(wiki): sync from docs/wiki"
git push
echo "已推送到 $REMOTE"
echo "瀏覽：https://github.com/aa0968111723-prog/ai_os/wiki"
