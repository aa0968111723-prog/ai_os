# 缺陷長跑報告 — 2026-08-05

> QA 代理長時間完整缺陷測試／修復  
> 基礎分支：`claude/healing-migration-ai-os-erewp2`  
> HEAD（開始）：`2739dd2de197ce954cff43f3689fcdbc50bb74d7`  
> Node：v24.14.0 · npm 11.9.0  
> 工作分支：`fix/qa-defect-longrun`

---

## 階段 0 — 環境

| 項目 | 值 |
|------|-----|
| HEAD | 2739dd2（含 #422 G2、#423 docs） |
| Node | v24.14.0 |
| 約束 | 不修新功能；不碰 LangGraph/InstantID/RAG；不合 #226 PLACEHOLDER |

---

## 階段 1 — 自動化回歸

| 指令 | 結果 | 備註 |
|------|------|------|
| `npm run typecheck` | ✅ EXIT 0 | |
| `npm test` | ⚠️ 1 flaky fail | `runnerMetrics` load1 在共載環境 skip=true（已改測） |
| `npm run test:client` | （長跑中） | |
| `npm run audit:high` | （待） | 預期綠（#418 sharp） |
| `npm run check:boundaries` | （待） | |

### 新發現缺陷
- **runnerMetrics flaky**：`shouldSkipHeavyBackgroundWork` 在高 load1 時 skip=true，原測試強制 false → 長測紅。已改為形狀斷言。

---

## 階段 2 — Issue 判定表

| Issue | 判定 | 證據 | 建議／本輪動作 |
|-------|------|------|----------------|
| **#268** | REPRODUCIBLE（ops+程式） | live `/api/health` build.sha/branch/builtAt 全 null；`server/index.ts` 僅讀 BUILD_* | 加 ZEABUR_GIT_COMMIT 等 fallback（本輪已改） |
| **#276** | FIXED_ON_DEFAULT | live HTTP 200 health + ready ok | **關閉**並附 curl |
| **#269** | REPRODUCIBLE | `clearSessionCookie` 無 Secure | **已修** 與 set 對稱 |
| **#275** | REPRODUCIBLE | changePassword／resetMemberPassword 只撤銷 MCP，無 upload grants | **已修** `revokeAllUserUploadGrants` |
| **#281** | REPRODUCIBLE | SessionGate `meError` 時非 `/` 一律錯誤頁，擋住 `/login` | **已修** `/login` 仍可進 LoginPage |
| **#274** | REPRODUCIBLE | `url.startsWith("/")` 接受 `//evil` | **已修** 排除 `//` |
| **#272** | REPRODUCIBLE | `pageForPath` 無 `/dashboard` | **已修** |
| **#279** | FIXED_ON_DEFAULT | 已用 `html2canvas-pro`；package 無舊 html2canvas；有契約測 | **關閉** |
| **#282** | REPRODUCIBLE | ReportForm dialog 無 aria-modal／focus trap | **已修** |
| **#273** | REPRODUCIBLE | LandingPage／pageTitle 仍「AI Director OS」 | **已修** → Aios |
| **#283** | REPRODUCIBLE | Login 無 main#main-content | **已修** main 地標 |
| **#277/#226** | STILL_DANGEROUS | PR #226 CLOSED+CONFLICTING；diff 仍含 PLACEHOLDER_* | **不合**；留言 do-not-merge |
| **#278** | FIXED_ON_DEFAULT | journal 有且僅 `0021_user_presence` idx 21 | 留言確認無撞車 |
| **#270** | meta | 本輪結束留言 | 本輪結束更新 |
| **#271** | （若開） | 同 #278 | 查 state |

---

## 階段 3 — Live

### GET https://ai-os-app.zeabur.app/api/health
```json
{"ok":true,"time":"2026-08-05T04:04:18.411Z","build":{"sha":null,"branch":null,"builtAt":null}}
HTTP 200
```
→ #276 **已非 502**。#268 build 仍 null（需部署含 fallback 或注入 build-arg）。

### GET https://ai-os-app.zeabur.app/api/ready
HTTP 200 · ok:true · processRole:all · runners 含 generation/agent/workflow/export/groupCampaign/**assetMaintenance**（#411 已上線）

---

## 階段 4 — 修復（本分支 commit 清單）

| 優先 | Issue | 變更檔 |
|------|-------|--------|
| 1 | #269 | `server/services/auth.ts` + `auth.cookie.test.ts` |
| 2 | #275 | `uploadGrants.ts` revokeAll；auth/admin routers；credentialRotation.test |
| 3 | #274 | `AppShell.tsx` navigate |
| 4 | #281 | `SessionGate.tsx` |
| 5 | #272 | `FeedbackWidget.tsx` pageForPath |
| 6 | #279 | 無需碼修（已 pro） |
| 7 | #282 | FeedbackWidget aria-modal + useFocusTrap |
| 8 | #283 | LoginPage `<main id="main-content">` |
| 9 | #273 | LandingPage + pageTitle |
| 10 | #268 | BUILD_INFO env fallback |
| — | flaky | runnerMetrics.test.ts |

---

## 階段 5 — 最終回歸

（commit 後重跑 typecheck / vitest 相關 + test:client 摘要）

---

## 未完成／阻因

- #268 正式站需重新部署後 ZEABUR_* 或 BUILD_* 才會非 null
- migration CI 全 repo 已知紅（legacy bridge）— 本輪不修
- #226 保持關閉／不合

---

## 交付

- PR：`fix/qa-defect-longrun`
- 報告：本檔
- #270 留言：本輪結論
