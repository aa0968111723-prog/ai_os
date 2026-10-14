# 全專案缺陷盤點（Aios / ai_os）

> **狀態：** 盤點文件（不改 runtime）  
> **基準日：** 2026-08-11  
> **Base 分支參考：** `claude/healing-migration-ai-os-erewp2`  
> **資料來源：** open GitHub issues、open fix PRs、`docs/優化評估報告.md` residual、Assistant GoalFrame 實作規格（2026-08-11）、模型／工作台歷史結論  
> **邊界：** 此為「已知／可追蹤缺口」總覽，**不是**全 codebase 靜態分析 100% 覆蓋；合併後需對 CURRENT HEAD 再驗證是否已修。

---

## 0. 一句話

Aios 已有大量 Capability、Intake、HITL、模型目錄與協作基建，但信任斷點集中在：

1. **Assistant 語意／來源／執行完成條件**（答錯、混來源、只回文字當完成）  
2. **資安與連線邊角**（憑證、cookie、grant、env 文件）  
3. **計價／BYOK／模型未驗證**  
4. **a11y／Session／品牌一致性**  
5. **產品 residual**（完整計畫層、工作台一體、RLS 等）

---

## 1. 優先級定義

| 等級 | 含義 |
|------|------|
| **P0** | 錯答案、錯來源、安全／資安、假完成 |
| **P1** | 明顯 UX／a11y／正確性 bug（多有 issue／修法 PR） |
| **P2** | 產品完整度、模型／計價、代理計畫 residual |
| **P3** | 治理、依賴、SEO、設計資產、文件 |

---

## 2. P0 — 核心正確性與信任

### 2.1 Assistant 語意／來源／執行（最高優先）

規格核心：**UNDERSTAND FIRST. THEN EXECUTE.**  
管線：**UNDERSTAND → GROUND → ACT → VERIFY → CONTINUE**

| ID | 缺陷 | 說明 |
|----|------|------|
| **A1** | Regex 當最終語意 | `classifyAssistantRequest` 等僅可作 fast hint；多輪「對／就是那個」無法接 Active Goal |
| **A2** | Source ≠ Asset 未嚴格區分 | 「雲端／Google Photos」常 silent substitute 成專案素材庫 count |
| **A3** | Evidence scope 缺失 | 數字未標證據來源；文案易寫成「Photos 有 64 張」 |
| **A4** | Answer ≠ Success | DesiredOutcome 需 WRITE／TOOL 時，純 LLM 文字不可標 Completed |
| **A5** | Capability gap 不誠實 | 無 Photos listing 仍用專案數量頂替 |
| **A6** | Continuation／Correction 弱 | 補充事實、更正來源不 resume 原 Goal |
| **A7** | 「這些」未綁 recent result | 應沿用 previous result assetIds，勿重搜全庫 |
| **A8** | 無 GoalFrame 結構化層 | 需 typed GoalFrame + Zod；Sol 只在 ambiguity 路徑 |

**概念必須分開：**

| 概念 | 例子 |
|------|------|
| SOURCE | Google Photos album、Drive folder |
| ASSET | 匯入後的 IMG_001.jpg |
| LIBRARY RESOURCE | Aios 素材庫 canonical |
| PROJECT USAGE | 專案／分鏡綁定 |

**禁止 silent substitution：** Photos remote count ≠ project asset count；指定 Firefly ≠ 默默改 fal；指定 Scene 03 ≠ 默默用 current scene。

**建議對照檔（CURRENT HEAD）：**

- `shared/assistantExecution.ts`
- `shared/assistantCapabilityRegistry.ts`
- `shared/agentQuestions.ts` / `shared/agentEvents.ts`
- `server/routers/globalAssistant.ts` / `assistant.ts`
- `server/services/assistantResourceResolver.ts`
- `server/services/agentQuestionResolver.ts`
- `server/services/universalIntake.ts` / `contextResolver.ts`
- `client/.../AICreativeCopilot.tsx` / `ProjectAssistant.tsx`
- 相關：PR #594、#596、#597、#608（以合併狀態為準）

**不要重做：** Human-in-the-loop、Universal Intake、Command Center、External Intake、Agent Event Stream、External Editing Bridge、Capability Registry 本體、Assistant Store。

**Golden regression（必寫測試）：**

1. 「雲端內有多少素材？」無 active source → 必須問來源；禁止直接 project count  
2. Google Photos URL + 無 listing capability → 理解 COUNT REMOTE，誠實做不到；禁止回 64  
3. 「對，這個資料夾已經匯入了」→ continuation；查 provenance  
4. 「北藝那個」→ entity resolve → same run resume  
5. 「把這些整理好」→ previous result → classify → job；非空口答應  
6. 「放到 Shot 3」→ resolve assets + shot → attach → read-back verify  

### 2.2 資安／連線

| ID | 缺陷 | 追蹤 |
|----|------|------|
| **S1** | 瀏覽器驗證腳本硬編碼登入憑證 | Open PR **#603** |
| **S2** | `.env.example` 缺 ALLOWED_ORIGINS／MCP_ALLOWED_ORIGINS／Adobe OAuth | Open PR **#604** |
| **S3** | HSTS preload／health 暴露 branch 等 | Open PR **#580** |
| **S4** | 改密碼未撤銷 upload grants | Issue **#275** |
| **S5** | clearSessionCookie 缺 Secure（歷史 QA） | Issue **#269** |
| **S6** | CSP `unsafe-inline`（React inline style；nonce 需大重構） | 已知妥協（#580 註） |

### 2.3 計價／BYOK／模型驗證

| ID | 缺陷 | 追蹤 |
|----|------|------|
| **B1** | BYOK Phase 2：`decideCost` 雙計費 wiring 未完整 | Issue **#366**（#365 foundation） |
| **B2** | 使用者「實際點數 vs 花費點數」體感不一致（平台 key／個人 fal／文案） | 產品＋#366 |
| **B3** | 大量模型 `verified=false`；真跑可能失敗 | `verify-models`／模型審計計畫 |

### 2.4 部署可觀測性

| ID | 缺陷 | 追蹤 |
|----|------|------|
| **D1** | 正式站 `/api/health` build.sha 曾全 null | Issue **#268** |
| **D2** | 歷史短暫全面 502 | Issue **#276**（維運風險） |

---

## 3. P1 — 已開 Issue／明顯 Bug

### 3.1 前端／Session／無障礙

| Issue | 缺陷 |
|------|------|
| **#281** | `SessionGate`：`auth.me` 失敗擋住 `/login`，無法進登入表單 |
| **#282** | `FeedbackWidget` 缺 `aria-modal`／焦點陷阱 |
| **#283** | 未登入 Login 無 `main`／skip-link |
| **#272** | `pageForPath` 未對 `/dashboard` → 回饋無法預勾作業台 |
| **#273** | `document.title`／Landing 仍「AI Director OS」，與 **Aios** 不一致 |
| **#274** | `aios:navigate` 未擋 `//` 類路徑 |
| **#279** | 回饋截圖 html2canvas + `color-mix` 必敗 |

### 3.2 資料／遷移

| Issue | 缺陷 |
|------|------|
| **#278** | migration **0021 撞車**（user_presence vs device_trust） |

### 3.3 合併風險（歷史）

| Issue | 說明 |
|------|------|
| **#277** | 曾有 PR 風險「PLACEHOLDER 清空核心檔」— 嚴禁誤合 |

### 3.4 已有修法、尚未合併的 P1 向 PR

| PR | 內容 |
|----|------|
| **#610** | 巢狀互動元素（a 包 button）a11y |
| **#607** | 焦點對比 3:1、觸控 44px、圖示對比 |
| **#609** | 導航同頁兩名、icon 去重、`/logs` 命名 |
| **#612** | robots 收緊登入後 SPA 路由（SEO 重複內容） |

---

## 4. P2 — 產品與架構 Residual

### 4.1 AI 完整計畫層（Issue **#133**）

已有 notes／schedule／task／runner 骨架；仍缺例如：

- 公開決策軌跡（禁止 raw CoT）schema／UI  
- 創作代理短版 playbook＋工作台入口  
- 規劃上下文對齊專案全貌  
- schedule／task 重啟冪等測試  

### 4.2 創作工作台／上下文

| 缺口 | 說明 |
|------|------|
| 工作台資訊過載 | DirectGenerate 等一次堆太多 |
| 定裝／工作台／分鏡不一體 | 上下文連結不紮實 |
| 陪做／反固著引導 | 有設計計畫，實作深度視合併狀態 |
| 圖／影片完整入知識庫 | 部分 vision 描述；多模態仍弱 |
| RAG／Notion OAuth | 評估報告列延後 |

### 4.3 模型目錄

| 缺口 | 說明 |
|------|------|
| 大量未 live 驗證 | `verified=false` |
| 端點／slug 可能過時 | 補遺／審計 |
| 點數 vs 官方價 | 需定期 `audit-model-pricing` |
| 回寫指南／代理 | 審計後須改 MODELS＋`gen-model-docs`＋playbook |

相關計畫文件（若已合入）：

- `docs/product/model-deep-audit-266-plan.md`  
- `docs/product/llm-as-judge-model-audit-plan.md`  

### 4.4 權限與隔離

| 缺口 | 說明 |
|------|------|
| **DB RLS** | 長期註記：隔離偏應用層，漏寫即跨組風險 |
| 專案級成員權限 | 完整度需對 CURRENT HEAD 再確認 |

### 4.5 優化評估報告仍列「需外部／延後」

- Sentry 類外接監控（有 PR #581 待合＋DSN）  
- Email 忘記密碼  
- Notion MCP／OAuth、RAG  
- 可拖時間軸  
- gemini／ANY_LLM 實測切換驗證  

---

## 5. P3 — 工程治理與週邊

| 類型 | 內容 | 追蹤 |
|------|------|------|
| 程式品質 | 曾缺 ESLint 防線 | Open PR **#577** |
| Git 工作流 | husky／PR／Issue 範本 | Open PR **#578** |
| 監控 | Sentry 前端 | Open PR **#581** |
| CHANGELOG | standard-version | Open PR **#582** |
| Dependabot | tsx、ws、TS 大版本、express 5… | #598 #599 #114 #115 #116 #109 #110… |
| 設計資產 | Adobe→Figma→code | #409／#426 系 |
| 使用者說明 | 維基／help | Open PR **#316** |
| SEO | robots 登入後路由 | Open PR **#612** |

---

## 6. 使用者感受 Top 10（建議收斂順序）

1. **Assistant GoalFrame／來源證據／禁止 silent substitute**（§2.1）  
2. **SessionGate meError 仍可登入**（#281）  
3. **BYOK／扣點顯示與真實路徑一致**（#366）  
4. **改密碼撤銷 upload grant、cookie Secure**（#275／#269）  
5. **腳本與 env 憑證修法合併**（#603／#604）  
6. **品牌／title 統一 Aios**（#273）  
7. **Feedback a11y + pageForPath**（#282／#272）  
8. **health build sha 注入**（#268）  
9. **模型 verified／404 清查與回寫目錄**  
10. **工作台減噪 + 定裝／分鏡上下文一體**  

---

## 7. 建議執行波次

| 波次 | 內容 | 產出 |
|------|------|------|
| **W0** | 合併已就緒 fix PR（#603 #604 #607 #609 #610 #612 等，依 CI） | 降 P1 噪音 |
| **W1** | Assistant GoalFrame + Evidence + Continuation + Golden 1–6 | 信任核心 |
| **W2** | #281 #272 #273 #282 #283 + 資安 issue | 登入與 a11y |
| **W3** | BYOK #366 + 扣點文案 | 計價可信 |
| **W4** | 模型 L0–L2 全量 + 代表 live + 回寫 MODELS／指南 | 生成可靠 |
| **W5** | 工作台減噪／上下文一體／#133 residual | 創作體驗 |
| **W6** | RLS 評估、監控 DSN、Dependabot 大版本 | 長期健康 |

---

## 8. 已有修法 PR 速查（合併後改狀態）

| PR | 主題 |
|----|------|
| #603 | 移除驗證腳本硬編碼憑證 |
| #604 | .env.example 安全相關變數 |
| #580 | HSTS + health 去敏感 |
| #581 | Sentry |
| #577–#582 | ESLint／husky／CHANGELOG 等 |
| #607 #609 #610 | UI a11y／導航 |
| #612 | robots SEO |

合併後請在本文件或後續 revision 將對應 ID 標為 **fixed@sha**。

---

## 9. 驗證建議（任一修復波次後）

```bash
npm run typecheck
npm test
npm run test:client
npm run build
npm run check:boundaries
npm run check:ui-primitives
npm run check:hooks
```

Assistant 波次另加：semantic goal／continuation／source grounding regression；並用真實 UI 走：

1. 雲端內有多少素材  
2. Google Photos URL  
3. 已經匯入專案了  
4. 把那些素材做下一步  

確認：不混淆來源、不假裝讀過 Photos、不重問已答、能接續同一目標、有能力就真執行。

---

## 10. 盤點邊界（再聲明）

| 有納入 | 未等同 |
|--------|--------|
| Open issues／多數 open fix PR | 全 repo 逐行靜態分析 |
| 優化評估 residual | 每支 Dependabot 的 runtime 影響已驗證 |
| Assistant 規格（產品 P0） | 線上當下某 issue 是否已修（需 diff CURRENT HEAD） |
| 模型／工作台歷史結論 | 逐一重跑全部 e2e／手動 UI |

---

## 11. 修訂紀錄

| 日期 | 說明 |
|------|------|
| 2026-08-11 | 初版全專案缺陷盤點 PR |
