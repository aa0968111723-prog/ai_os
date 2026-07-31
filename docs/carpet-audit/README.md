# 全站地毯式測試（Carpet Audit）

## 目標

- **不停機輪巡**：每 60 秒推進「下一個」功能／E2E 套件／資料夾區塊
- **實機大量驗證**：單元測試 + `scripts/e2e-*.py` + Playwright UI
- **可恢復**：狀態在 `.data/carpet-audit/state.json`；中斷後從 cursor 續跑
- **可上 PR 記錄**：累積報告 `docs/carpet-audit/FINDINGS.md` + Wave 確認稿

## 快速開始

```bash
# 1) 起 DB + 服務（E2E_MOCK=1 假生成）
# ⚠ 跑 e2e 隔離時「不要」設 AUTH_MODE=dev
#    （createContext 會永遠變成種子開發者，session cookie 無效 → 隔離全假紅）
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/aidirector
export E2E_MOCK=1 PORT=3000
unset AUTH_MODE
export SEED_ADMIN_EMAIL=admin@aidirector.local
export SEED_ADMIN_PASSWORD=test-admin-123
export RATE_LIMIT_SECRET=local-e2e-rate-limit-secret-000000000000000000000000000000
export MCP_API_KEY=test-mcp-key ALLOW_LEGACY_MCP_ADMIN_KEY=1 MOCK_BILLING=1
npx tsx server/index.ts

# 2) 跑下一格
node scripts/carpet-audit/run-next.mjs

# 3) 指定區塊 / 重設
node scripts/carpet-audit/run-next.mjs --force-id=static.agent-parallel
node scripts/carpet-audit/run-next.mjs --reset
```

區塊目錄：`scripts/carpet-audit/blocks.json`（28 格）。

## 與 PR 的配合

1. 功能 PR 進來 → 對應 `paths` 的 block 可 `--force-id` 優先重測  
2. 缺陷與證據 append 到 `FINDINGS.md` / `WAVE-*.md` → 開 **audit PR** 做記錄（可 draft）  
3. 修復 PR 合併後，把 state 該格改回 `pending` 或跑 `--force-id` 複驗  

## 排程

Grok Build scheduler 每 `60s` 觸發 agent 執行 `run-next.mjs` 並必要時深化靜態區塊。  
本機：

```bash
while true; do node scripts/carpet-audit/run-next.mjs; sleep 60; done
```

## 本波產物

- [WAVE-0-CONFIRMED.md](./WAVE-0-CONFIRMED.md) — 已確認 critical/high 缺陷清單  
- [FINDINGS.md](./FINDINGS.md) — 自動 append 日誌  
