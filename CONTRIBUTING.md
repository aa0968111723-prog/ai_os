# Aios 貢獻指南

歡迎貢獻 Aios（AI 創作作業系統）。以下是開發流程規範。

## 開發環境

- **Node.js**：>= 22（見 `.nvmrc`）
- **套件管理**：npm（`npm ci` 安裝依賴）
- **資料庫**：PostgreSQL 16

## 開始開發

```bash
npm ci              # 安裝依賴
cp .env.example .env  # 設定環境變數（參考 .env.example）
npm run dev           # 啟動開發伺服器（前端 Vite + 後端 tsx）
```

## 程式碼風格

- **TypeScript** strict mode，禁止 `any`（除非有明確理由）
- **格式化**：Prettier（`npm run format:fix`）
- **Lint**：ESLint（`npm run lint:fix`）
- **Commit 前**：Pre-commit hook 會自動跑 lint-staged

## 提交前檢查

```bash
npm run typecheck   # 型別檢查
npm run lint        # ESLint
npm test            # 單元測試
npm run build       # 確認能建置
```

## Pull Request 流程

1. 從預設分支開 feature branch：`git checkout -b feature/my-change`
2. 修改 → commit → push
3. 開 PR 並填寫 PR 範本
4. CI 必須全綠（lint-gates、test、build、e2e、migration）
5. 至少一人 review 後合併

## Commit 慣例

使用語意化 commit：

- `feat:` 新功能
- `fix:` Bug 修復
- `refactor:` 重構
- `docs:` 文件
- `style:` 格式化
- `test:` 測試
- `chore:` 雜項（依賴更新、CI 設定）

## 模組邊界

- `shared/` — 前後端共用（**不得**反向依賴 `client/` 或 `server/`）
- `client/` — React 前端
- `server/` — Express 後端

CI 會自動檢查邊界（`check:boundaries`）。

## 需要幫助？

開 Issue 標 `question` 標籤，或在 Discussion 提問。
