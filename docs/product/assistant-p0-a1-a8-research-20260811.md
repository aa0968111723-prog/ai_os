# P0 Assistant 語意／來源／執行缺陷 A1-A8 — 研究與修復方案

> **狀態：** 研究型文件（不改 runtime）｜**基準：** `claude/healing-migration-ai-os-erewp2` @ `7912a399`（2026-08-11）
> **性質：** HIGH／CRITICAL 缺陷的修復研究與方案提案，**需人工審查**後才進入實作。
> **上游：** PR #624（docs: 全專案缺陷盤點 2026-08-11）、`docs/product/assistant-brain-v2-repair.md`、`assistant-brain-v2-implementation-order.md`、`assistant-brain-v2-status.md`

---

## 0. 一句話

CURRENT HEAD 已落地 typed GoalFrame、證據範圍區分、驗證式執行、誠實能力缺口與 recent-result 綁定——A2/A3/A4/A5/A7/A8 屬**已實作、待全面收斂驗證**；A1 已收斂為 fast hint；A6（Continuation／Correction）**部分落地、缺 E2E**。本文件逐項對映 CURRENT HEAD 程式碼位置，列出剩餘工作與 Golden regression。

**產品標準：** `UNDERSTAND → GROUND → RESOLVE → ACT → VERIFY → CONTINUE`，而非 `keyword → 猜功能 → 回文字`。

---

## 1. A1-A8 逐項對映 CURRENT HEAD

| ID | 缺陷 | CURRENT HEAD 狀態 | 程式碼位置（已核對） | 剩餘工作 |
|----|------|------------------|---------------------|---------|
| **A1** | Regex 當最終語意 | 🟢 已收斂：Regex 僅作 immediate SSE routing hint；typed GoalFrame 才是執行權威 | `server/routers/globalAssistant.ts:611-613`（註解明示）、`shared/assistantSemanticResolution.ts`、`deriveDeterministicGoalFrame`（`server/routers/globalAssistant.ts:661`） | 補 golden：多輪「對／就是那個」接 Active Goal |
| **A2** | Source ≠ Asset 未嚴格區分 | 🟢 已實作：SOURCE_MENTION 來源辨識、`ASSISTANT_SOURCE_TYPES` 區分 GOOGLE_PHOTOS／GOOGLE_DRIVE／LOCAL／PROJECT_ASSETS／AIOS_LIBRARY | `shared/assistantGoalFrame.ts:57-70`、`shared/assistantSemanticResolution.ts` SOURCE_MENTION、`assistantGoalSourceSchema` | 補 golden：雲端 count ≠ project count |
| **A3** | Evidence scope 缺失 | 🟢 已實作：`AssistantEvidenceScope` 列舉 REMOTE_SOURCE／IMPORTED_PROVENANCE／AIOS_LIBRARY／PROJECT_ASSETS／PROJECT_USAGE；`canClaimRemoteSourceFact` 守衛防「Photos 有 64 張」 | `shared/assistantGoalFrame.ts:195-210`、`capabilityMatch.evidenceScope`（`globalAssistant.ts` semanticPayload） | 全面標註每筆數字的來源；remote 無 listing capability 時誠實回做不到（已有 unsupported fallback） |
| **A4** | Answer ≠ Success | 🟢 已實作：`goalRequiresVerifiedExecution` 守衛；attach 走 `attachAssetsToShotVerified` + verification 事件，未通過不標 completed | `shared/assistantGoalFrame.ts:160-174`、`server/routers/globalAssistant.ts:855-888`（verification.completed / action.completed / agent.completed 事件序列） | 掃描其餘 write capability 是否全走 verified path（建筆記／建專案／派工等） |
| **A5** | Capability gap 不誠實 | 🟢 已實作：`capabilityMatch.status === "unsupported"` 時回 waiting + 誠實原因，REMOTE_SOURCE 時改提供可驗證替代路徑 | `server/routers/globalAssistant.ts:849-854`、`matchAssistantCapabilityForGoal` | 補 golden：無 Photos listing 卻問 remote count → 誠實回做不到 |
| **A6** | Continuation／Correction 弱 | 🟡 部分：`ASSISTANT_CONTINUATION_TYPES`、`continuationHint`、`resolveWorkingProject` 已接 activeGoal／recentActionResults；但整條 continuation 流程缺 E2E | `shared/assistantGoalFrame.ts:86-93`、`shared/assistantSemanticResolution.ts` continuation、`globalAssistant.ts:668,676`（goalId 續用、recentActionResults 注入） | golden E2E：「補充事實／更正來源」resume 原 Goal |
| **A7** | 「這些」未綁 recent result | 🟢 已實作：`recentVerifiedAssetIds(input.recentActionResults)`、`resultRefIds`、`formatRecentActionResults` 進 prompt | `server/routers/globalAssistant.ts:855,882,1134`、`recentActionResultSchema`（1894） | 補 golden：「這些整理好」→ 直接用 previous result assetIds |
| **A8** | 無 GoalFrame 結構化層 | 🟢 已實作：typed GoalFrame + Zod（210 行）、intent／operation／object／source／desiredOutcome 全 typed | `shared/assistantGoalFrame.ts` 全文 | Active Goal **persistence**（跨 session resume）仍未接 DB |

---

## 2. 已落地里程碑（CURRENT HEAD 含）

- **PR #643**（feat/assistant-brain-v2-orchestrator）：typed GoalFrame contract、semantic goal resolution core、working project resolver、Regex 降級為 fast hint。
- **PR #644**（feat/aios-agent-brain-v3）：goal-based verified assistant runtime、recent assets attached verify、source correction by conversation order、Photos bare source correction。
- **PR #645**（feat/aios-agent-practical-autonomy-v4）：practical autonomy runtime。

上述三個 PR 均已合併進 base，A1-A8 的主體修復**已存在**於 CURRENT HEAD。

---

## 3. 剩餘工作（提案，依序）

1. **Write-capability verified path 全面掃描（A4）**：列出 globalAssistant／assistant 所有 desired outcome 需要 WRITE／TOOL 的 branch，逐一確認都走 verified execution（re-read-back 確認）而非純文字宣告。對照 `goalRequiresVerifiedExecution`。
2. **Evidence scope 全面標註（A3）**：所有 count／list 回覆在 prompt 與 answer 中都帶來源標籤（REMOTE_SOURCE vs IMPORTED_PROVENANCE vs AIOS_LIBRARY vs PROJECT_ASSETS）；禁止 silent substitution。
3. **Capability Registry 收斂（A5 佐證）**：`assistantCapabilityRegistry.ts` 已由 MCP 目錄投影，確認 Global Assistant executable action surface 與 registry 一致，不重複 site-action catalog。
4. **Continuation／Correction E2E（A6）**：實測「補充事實／更正來源／接著做」在單一 activeGoal 下 resume；補 `assistantSemanticResolution.test.ts` 案例。
5. **Active Goal persistence（A8 補強）**：評估 goalId 落地 DB 以跨 session resume；屬架構變更，需另行決策。
6. **Golden regression 全套**：見下節；mobile + desktop 各跑一遍。

---

## 4. Golden regression（必寫測試）

| # | 案例 | 通過條件 |
|---|------|---------|
| G1 | 「雲端內有多少素材？」無 active source | 必須問來源；禁止直接回 project count |
| G2 | Google Photos URL + 無 listing capability | 理解 COUNT REMOTE，誠實做不到；禁止回 64 |
| G3 | 「對，這個資料夾已經匯入了」 | continuation；查 provenance 接原 Goal |
| G4 | 「北藝那個」 | entity resolve → same run resume |
| G5 | 「把這些整理好」 | previous result → classify → job；非空口答應 |
| G6 | 「放到 Shot 3」 | resolve assets + shot → attach → read-back verify |

（以上六條已列於 PR #624 盤點；本文件將其綁定到 CURRENT HEAD 已實作／待補狀態。）

---

## 5. 驗收邊界

- **不重做：** Human-in-the-loop、Universal Intake、Command Center、External Intake、Agent Event Stream、External Editing Bridge、Capability Registry 本體、Assistant Store。
- **不做：** 本 PR 不改任何 runtime code；實作由專責工程師在審查通過後進行。
- **全站測試長：** 審查後請不同場景獨立複測 A6 continuation 與 A3 evidence scope。

---

## 6. 參考

- PR #624：docs: 全專案缺陷盤點（2026-08-11）
- `docs/product/assistant-brain-v2-repair.md`（修復契約）
- `docs/product/assistant-brain-v2-implementation-order.md`（實作順序）
- `docs/product/assistant-brain-v2-status.md`（狀態：主體已隨 #643/#644/#645 落地）
