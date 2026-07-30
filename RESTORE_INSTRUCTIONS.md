# Hotfix: restore destroyed files

## Problem
PR #205/#206 replaced these with PLACEHOLDER:
- `server/services/mcp.ts` (was ~55KB)
- `scripts/e2e-mcp.py` (was ~25KB)
- `client/src/styles.css` (was 143KB)

Zeabur stuck at 啟動中 because mcp.ts is empty.

## Restore (run locally)

```bash
git fetch origin
git checkout claude/healing-migration-ai-os-erewp2
git checkout 27dcb4a21abcd95a87b3218b982109db74a0e209 -- server/services/mcp.ts scripts/e2e-mcp.py
git checkout 006fc30ae1c8f0799eb312da9196dd4449e3f654 -- client/src/styles.css
wc -c server/services/mcp.ts scripts/e2e-mcp.py client/src/styles.css
# expect ~55676 / ~25634 / 143309

git checkout -b hotfix/restore-destroyed-files
git add server/services/mcp.ts scripts/e2e-mcp.py client/src/styles.css
git commit -m "hotfix: restore mcp.ts + e2e-mcp.py + styles.css destroyed by #205/#206 placeholders"
git push -u origin HEAD
gh pr create --base claude/healing-migration-ai-os-erewp2 --title "hotfix: restore files destroyed by placeholder PRs" --body "Restores mcp.ts, e2e-mcp.py, styles.css so Zeabur can boot."
```

## Good commit SHAs
- mcp.ts + e2e-mcp.py: `27dcb4a21abcd95a87b3218b982109db74a0e209`
- styles.css: `006fc30ae1c8f0799eb312da9196dd4449e3f654`
