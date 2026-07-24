# UI 實測腳本（Playwright，真實瀏覽器操作）

與 `scripts/e2e-*.py`（API 層）互補：這裡用真實瀏覽器走完整使用者旅程。

| 腳本 | 覆蓋 |
|---|---|
| `golden-path.mjs` | 黃金路徑：登入→建案→世界觀→知識庫→拆分鏡→逐格生成/配音→送審→通過→粗剪預覽→下載交付→AI 代理 |
| `verify-workbench.mjs` | 工作台三幕結構、摘要條、選項就地新增、跨卡跳轉 |
| `verify-deep.mjs` | 世界觀進階編輯、導演存分鏡、勾選持久化、逐格模型、彈窗注入 |
| `verify-agent.mjs` | AI 代理全生命週期（規劃→核准→背景執行→放棄） |

跑法（需先起伺服器；E2E_MOCK=1 為假生成、帶真金鑰為真實生成）：
```
npm i -D playwright   # 或任何有 playwright 的目錄
E2E_UI_BASE=http://127.0.0.1:3210 node scripts/e2e-ui/golden-path.mjs
```
截圖與下載產物落在 `E2E_UI_OUT`（預設 ./e2e-ui-out）。
帳密沿用種子管理員（SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD）；腳本內建值對應本地測試環境，正式站請改環境變數與腳本頂部常數。
