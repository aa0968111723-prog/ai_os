# 地毯測試 Wave 0 · 已確認缺陷（2026-07-31）

> 來源：靜態對抗審查（雙 explore 子代理）+ carpet-audit 自動掃描 + 單元測試（server 869 / client 254 全綠）  
> 分支背景：`feat/agent-skills-composer`（並行多支線 generate + 技能選單）  
> 自動輪巡：每 60s `node scripts/carpet-audit/run-next.mjs`（狀態 `.data/carpet-audit/state.json`）

## 總覽

| 嚴重度 | 數量 | 主題 |
|--------|------|------|
| 🔴 Critical | 2 | 幽靈 generationId 永久掛死；並行支線 fail 後兄弟 in-flight 被放棄 |
| 🟠 High | 5 | 並行 cap 可被突破；authz soft-return；UI 停輪詢；viewer 改筆記/行程；upload grant 非原子 |
| 🟡 Medium | 6 | 停鍵競態、錯誤文案覆寫、同 sceneNo 覆寫、依賴被剝成根、幽靈佔 budget、回收桶語音來源 |
| 🟢 Low | 若干 | ACL heuristic 提示（需人工確認） |

---

## 🔴 Critical

### C1. 幽靈 `generationId` + 心跳 → 代理永遠 `running`（永不陳屍）

- **位置**: `server/services/agentRunner.ts` ≈795–838、897–899、310–311；`generationCore.ts` 失敗刪列後丟 `INTERNAL_SERVER_ERROR`
- **觸發**: 並行/單步寫入 `step.generationId` → `executeGenerationCommand` 中途失敗（例如 reserveQuota 後刪列）→ catch 當「下輪重試」但**不清 generationId** → 下輪 settle 得 NOT_FOUND 被吞 → 心跳每 tick 刷新 `updatedAt` → `sweepZombies` 永遠認為未逾時
- **後果**: 計畫永久卡在 running；註解承諾重試但實作不會；並行放大
- **修法**: NOT_FOUND 時清 generationId 回 pending（或計次 fail）；INTERNAL 重試前確認列仍在；幽靈步勿 heartbeat

### C2. 一支線失敗後，兄弟 in-flight 生成不再被 runner 結算

- **位置**: `agentRunner.ts` 853–864、212–225；`agentDag.ts` 113–117
- **觸發**: 多支線 generate 同時 in-flight → 其一 settle failed → `failRun` 把 run 標 failed → tick **只撈 running/stopped**，不撈 failed → 其餘 running+generationId 永不 settle
- **後果**: UI 步驟卡 spinner；供應商可能仍完成並寫分鏡，計畫狀態不一致
- **修法**: 對 `failed`/`stopped` 且仍有 in-flight 的 run 繼續 drain settle（比照 stop 路徑）

---

## 🟠 High

### H1. `MAX_PARALLEL_GEN_STARTS=3` 可被同 tick 序列路徑突破

- **位置**: `agentRunner.ts` 735–739 vs 884–900、1477+
- **後果**: 實際可同時送出 >3 筆；供應商/額度壓力
- **修法**: 序列 generate 也守 cap，或 DAG 模式關閉序列 generate

### H2. 並行路徑 `checkRunAuthority` 失敗只 `return` 不 `failRun`

- **位置**: `agentRunner.ts` 741–742 vs 922–923
- **後果**: 與序列不一致；僅 generate 剩餘時可能空轉或仍靠 settle 完成已送出任務

### H3. `AgentCard` `isActive` 不含 `failed`+仍 running 步驟

- **位置**: `client/src/components/AgentCard.tsx` 107–114
- **後果**: 發生 C2 時前端停輪詢，畫面永遠不更新

### H4. 專案 viewer 仍可改/刪自己建立的專案綁定筆記與行程

- **位置**: `notesCore` update/remove；`scheduleCore` update；router remove — 無 `assertProjectEditable`
- **後果**: 違反 2.3 檢視者唯讀（建立路徑有擋，更新/刪漏）

### H5. Upload grant 非原子單次使用

- **位置**: `uploadGrants.ts` findValid + markUsed；`index.ts` upload
- **後發**: 並發同一 `aidup_` token 可多次上傳
- **修法**: CAS `UPDATE … WHERE used_at IS NULL RETURNING` 先佔用再收檔

---

## 🟡 Medium（摘要）

| ID | 摘要 |
|----|------|
| M1 | 並行多窗 stop 競態：寫 generationId 後仍送出 |
| M2 | `failRun` 不更新記憶體 `run.status` → 後續 `saveDagProgress` 可能覆寫 error 文案 |
| M3 | 多 generate 同 `sceneNo` 並行 → 最後寫入覆蓋分鏡 |
| M4 | 規劃剝離未解析 dependsOn → 步驟變獨立可並行根 |
| M5 | 幽靈 generationId 永久佔用並行 budget |
| M6 | 軟刪素材仍可當語音訊息/上傳 lineage 來源（生成來源已濾） |

---

## 實機測試狀態

| 套件 | 狀態 |
|------|------|
| `npm test`（server+shared） | ✅ 869 pass / 16 skip |
| `npm run test:client` | ✅ 254 pass |
| `e2e-auth.py`（**必須未設 AUTH_MODE=dev**） | ✅ **43/43**（clean DB + session 模式）；`AUTH_MODE=dev` 下隔離必假紅 |
| 其餘 e2e-py / Playwright | 由 60s carpet loop 推進 |

### 運維／測試陷阱（已確認）

#### O1. `AUTH_MODE=dev` 會讓全站 tRPC 一律以種子開發者身分執行，session cookie 被忽略

- **位置**: `server/trpc.ts` `createContext` 21–27
- **觸發**: `.env` 設 `AUTH_MODE=dev`（本機常見）後跑 `e2e-auth.py` 多使用者隔離斷言
- **後果**: 組員 session 的 `auth.me` 仍回開發者；跨組建案成功 → **隔離 e2e 全面紅燈（假陰性缺陷報告）**；反之若只在 dev 下測，**真隔離回歸不會被抓到**
- **正式站**: production 會忽略此旗標（有安全鎖）
- **地毯測試強制**: e2e 區塊啟動伺服器時 **不得** 帶 `AUTH_MODE=dev`；`scripts/run-e2e-local.sh` 亦然

## 基建

- `scripts/carpet-audit/blocks.json` — 28 區塊目錄  
- `scripts/carpet-audit/run-next.mjs` — 單格推進 + 自動 pattern 掃  
- `docs/carpet-audit/FINDINGS.md` — 自動 append 日誌  
- 排程：Grok scheduler 60s 續跑  

## 建議修復 PR 順序

1. C1 幽靈 generationId（正確性／維運）  
2. C2 failed drain in-flight  
3. H5 upload grant CAS  
4. H4 notes/schedule viewer ACL  
5. H1–H3 並行 cap／authz／UI  
6. Medium 批次  

---

*Wave 0 由 Grok 地毯測試於 2026-07-31 產出；後續 wave 由 60s loop 與 PR 觸發續寫。*
