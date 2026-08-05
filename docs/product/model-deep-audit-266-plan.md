# 計畫：266 模型深度研究與長時間實測

> 狀態：**待終端分批執行**（本 PR 僅計畫與報告模板）  
> 分支：`plan/model-deep-audit-266` → base `claude/healing-migration-ai-os-erewp2`  
> 觸發：使用者要求對模型指南**每一項**做數值、底層邏輯、站內點數、實際呼叫扣點、分詞／輸入組裝、推薦情境、MCP、API 文件與使用者可用性深度研究與測試（2026-08-05）  
> 單一真相：`shared/models.ts` → `MODELS`（**266** 筆）  
> 既有工具：`scripts/verify-models.ts`、`scripts/probe-fal-endpoints.ts`、`scripts/audit-model-pricing.ts`、`scripts/gen-model-docs.ts`、`scripts/e2e-models.py`、`scripts/e2e-mcp.py`、`docs/模型底層邏輯與運作流程.md`

---

## 1. 目標

對 **每一個** `MODELS[].id` 產出可勾選的研究＋測試紀錄，涵蓋：

| 維度 | 要回答的問題 |
|------|----------------|
| **數值** | points、cost 字串、與官方價／假設用量是否一致 |
| **底層邏輯** | category、needs、input() 組裝、negative／ratio／steps 等是否與 fal schema 對得上 |
| **站內點數** | UI 顯示點數 = `reserveQuota` 扣點 = 目錄 points；失敗是否退點 |
| **實際呼叫** | 端點是否存在；（可選）最小 live 生成是否成功 |
| **分詞／輸入** | LLM／TTS／圖模的 prompt 長度、必填欄、來源種類是否正確攔截 |
| **推薦情境** | strengths／bestFor／recommended 是否符合創作者真實用法 |
| **API 文件** | fal 模型頁／OpenAPI 是否仍指向有效 id |
| **MCP／使用者** | 是否出現在可選清單；MCP generate 是否同火力；檢視者／缺來源是否擋得住 |

**非目標（本計畫不一次做完）：** 對全部 266 個做高解析完整生成（成本不可控）；改計價公式大重構（僅標記需調點）。

---

## 2. 金錢與安全鐵律（終端必須遵守）

沿用既有腳本防呆，**不得放寬**：

1. **批次連通**只允許 `probe-fal-endpoints.ts` 空輸入 `{}`（422＝連通未生成）。  
2. **真實生成**只允許 `verify-models.ts --probe "<id>" --yes`，**一次一個**，且 `needs` 有值者拒探（改站內素材測）。  
3. 未帶 `--yes` 只印計畫／估點，不送請求。  
4. 禁止自寫「for 迴圈 live 生成全部模型」。  
5. Live 優先順序：推薦旗艦／經濟常用 → 類別代表 → 其餘 verified=false。  
6. 每日／每 PR 設定 **預算上限**（建議先 NT$ 或 fal 帳戶日限），超限停。  
7. `verified: true` **僅人工**在讀過 live 或連通＋文件後改，腳本不自動改。

---

## 3. 分層測試（每層全 266 可機械跑）

### L0 — 靜態契約（零成本，必先全綠）

```bash
npx tsx scripts/verify-models.ts          # 重生 docs/模型清查清單.md
# 另：既有 models 單元測試／styles 無關；檢查 MODELS 無重複 id、category∈CATEGORIES
```

每模檢查欄位：`id` `label` `category` `points` `cost` `tier` `verified` `needs` `recommended` `strengths` `bestFor`（以實際 `ModelEntry` 為準）。

**報告欄位：** 靜態契約 = ok / 落差（缺欄、重複 id、非法 category）。

### L1 — 端點連通（幾乎零算力費）

```bash
npx tsx scripts/probe-fal-endpoints.ts                 # 乾跑
FAL_KEY=… npx tsx scripts/probe-fal-endpoints.ts --yes
FAL_KEY=… npx tsx scripts/probe-fal-endpoints.ts --yes --only text-to-image
# NIM：scripts/check-nim.ts
```

**報告：** HTTP → OK_VALIDATED / NOT_FOUND / AUTH / FORBIDDEN / …  
nvidia-nim 與非 fal 端點分表。

### L2 — 點數校準（零 fal 生成費）

```bash
npx tsx scripts/audit-model-pricing.ts    # → docs/點數校準報告.md
```

對照：站內 points、目錄 cost、官方價（文件／公開 pricing）、估值 NT$、判定 ≈／偏貴／偏便宜、MP 進位風險。  
**結論：** 符合 / 需調點 / 需改 cost 字串 / 需人工（無法機械換算）。

### L3 — 底層 input 與 generation 契約

對每個 category 抽樣＋全部有自訂 `input` 者：

- 讀 `docs/模型底層邏輯與運作流程.md` 與 `generationCore`／`fal` submit 路徑  
- 確認 `needs` 與站內「缺來源攔截」一致（e2e-models 已有部分）  
- negative prompt／aspect 等旗標與模型能力一致  

**報告：** input 組裝 ok / schema 可疑 / 需對官方 API 頁修正。

### L4 — Live probe（刻意慢、控費）

僅 `!needs` 且 L1 連通者：

```bash
npx tsx scripts/verify-models.ts --probe "<id>"         # 估點
npx tsx scripts/verify-models.ts --probe "<id>" --yes   # 真跑一次
```

有 `needs`：在測試專案上傳最小素材後走站內 generate（或專用 probe 擴充，仍單次確認）。

**報告：** 未跑／成功／失敗＋錯誤摘要；成功後可建議 `verified: true`（人工 PR）。

### L5 — 站內扣點正確性（抽樣＋代表模型）

每類別至少 1 個經濟檔＋1 個旗艦（若負擔得起）：

1. 記錄呼叫前 quota  
2. 成功生成 → 點數減少 = 目錄 points（或文件規定規則）  
3. 故意失敗／取消 → 退點  
4. BYOK／平台 key 路徑若分叉，分列（見 byok 計畫）  

可延伸 `e2e-models.py`（注意 mock 不扣點與真扣點測試路徑分離）。

### L6 — 推薦情境與使用者可用性

每模（可批次人工／代理研究）：

- bestFor／strengths 是否對應 category 真實能力  
- 是否應在「分鏡可填」「直接出圖」「需來源」清單出現  
- 弘法／短片／定裝等站內情境是否誤導  

### L7 — MCP 與 API 文件

- `e2e-mcp.py`：列出模型／觸發 generate 的權限與參數是否與手動台一致  
- 每模 `https://fal.ai/models/<endpoint>` 是否 200；文件必填欄 vs 我們 input()  
- OpenAPI／fal openapi 若有，對必填欄 diff  

---

## 4. 每模報告模板（終端填進 `docs/model-audit/<id-slug>.md` 或總表一列）

```markdown
# <model id>

## 1. 身分
- label / category / tier / verified / needs / recommended

## 2. 數值
| 項目 | 值 |
|------|-----|
| points | |
| cost | |
| 官方價與單位 | |
| 估值 NT$（假設） | |
| 校準判定 | ≈ / 偏貴 / 偏便宜 / 人工 |

## 3. 連通與生成
| 項目 | 結果 |
|------|------|
| 靜態契約 | ok / 落差 |
| dry-run probe | |
| live probe | 未跑 / 成功 / 失敗 |
| 結論 | ready / ready-static-only / broken |

## 4. 底層邏輯
- endpointOf / input 組裝 / 旗標
- 與官方 API 差異

## 5. 站內點數
- 扣點路徑 / 退點 / 與 UI 一致？

## 6. 情境與可用性
- bestFor 是否恰當 / 使用者能否選到 / 需來源是否提示

## 7. MCP / 文件
- MCP 可調？文件連結？

## 8. 建議動作
- [ ] 維持
- [ ] 調 points
- [ ] 修 input/id
- [ ] verified true
- [ ] 下架或隱藏
```

總表：`docs/model-audit/_index.md`（266 列狀態燈）。

---

## 5. 執行波次（長時間）

| 波次 | 範圍 | 層級 | 預估 |
|------|------|------|------|
| **B0** | 全 266 | L0＋重生清查清單 | 1 次 CI |
| **B1** | 全 fal 端點（去重） | L1 probe --yes | 數十分鐘級，幾乎不生成 |
| **B2** | 全 266 | L2 點數校準報告 | 1 次 |
| **B3** | 按 category 代表各 1～3 | L3＋L5 扣點 | 控費 |
| **B4** | verified=false 且可 probe | L4 每日 N 個（建議 5～15） | 數日～數週 |
| **B5** | 全 266 | L6 情境文案審 | 代理可批次草稿＋人工抽樣 |
| **B6** | MCP＋文件連結 | L7 | 與 B1 並行可 |

類別建議順序：`text-to-image` → `image-to-image`／edit → `text-to-video` → `image-to-video` → speech／audio → vision／LLM → trainer（trainer 最貴，最後、少 live）。

---

## 6. 終端機工作流（可複製）

```text
1. 讀 shared/models.ts 與本計畫
2. 跑 B0、B1、B2，把報告 commit 到 feat/model-audit-*（勿改 verified 除非人審）
3. 開 _index.md：266 列，填 L0–L2 結果
4. 依預算從 B4 佇列取下一個 id：
   - 估點 → --yes live → 填模板 → 若成功開小 PR 只改該模 verified/points/input
5. 發現 NOT_FOUND / 扣點不一致 → 優先 fix PR，標記 broken
6. 每週匯總：ready 數、broken 數、待 live 數、花費
```

子代理可按 **category** 或 **id 號段（1–50、51–100…）** 平行做 **L0–L2＋L6 文件研究**；**L4 live 必須單一寫者加鎖**（避免雙重扣費）。

---

## 7. 與現有文件關係

| 文件／腳本 | 用途 |
|------------|------|
| `docs/模型目錄.md` | 人讀目錄（gen-model-docs） |
| `docs/模型清查清單.md` | verified=false 清單 |
| `docs/點數校準報告.md` | L2 輸出 |
| `docs/fal端點連通報告.md` | L1 輸出 |
| `docs/模型底層邏輯與運作流程.md` | L3 背景 |
| `docs/模型指南研究補遺.md` | 既有研究補遺，本計畫續作 |
| `docs/model-audit/*` | **新建**每模深度檔與總表 |

---

## 8. 完成定義

- [ ] `_index.md` 266 列皆有 L0＋L1＋L2 結果  
- [ ] 無 NOT_FOUND 遺留（已修 id 或下架）  
- [ ] 點數「需調點」清單有對應 PR 或明示暫緩  
- [ ] 常用推薦模型（recommended 或工作台預設）完成 L4 或明示 risk  
- [ ] MCP／缺來源／扣點抽樣有紀錄  
- [ ] 不要求 266 全 live；但 **可 probe 且 unverified** 有佇列與截止日期  

---

## 9. 回滾與風險

- 審計 PR 與「調點／改 id」PR 分離  
- Live 失敗自動退點（站內既有）仍須在報告註明  
- 官方改價導致校準漂移：每月重跑 L2（維運手冊已有）  

---

## 10. 終端／子代理提示詞（可直接貼上）

> 使用方式：複製下方整段 → 貼給 Cursor／終端代理。  
> 指派處填：單一 id、號段（1–50）或 category。  
> 子代理可平行做 L0–L2＋文件；**`--yes` live 只准一個代理排隊執行**。

```text
你是 ai_os 模型審計代理。單一真相：shared/models.ts 的 MODELS（共 266 筆）。
計畫：docs/product/model-deep-audit-266-plan.md（PR #420）。

【任務】對指派的每一個模型 id 做深度研究與測試，不可略過任何欄位。產出寫入
docs/model-audit/<id-slug>.md，並更新 docs/model-audit/_index.md 對應列。

【指派】（由使用者填）
- 模式：單 id / 號段（如 1–20）/ category（如 text-to-image）
- 清單：…

【必須覆蓋的維度】
1. 數值：points、cost、與官方價／假設用量；判定 ≈／偏貴／偏便宜／需人工
2. 底層邏輯：category、needs、endpointOf、input() 組裝、negative／ratio 等是否與 fal schema 一致
3. 站內點數：UI 顯示是否＝目錄 points；成功是否走 reserveQuota；失敗是否退點（查 generationCore／quota）
4. 連通：優先用既有腳本，禁止自寫批次 live
5. 分詞／輸入：LLM／TTS／圖模必填、長度、缺來源是否正確攔截
6. 推薦情境：strengths、bestFor、recommended 是否符合真實使用（短片／定裝／分鏡等）
7. API 文件：https://fal.ai/models/<endpoint> 是否有效；必填欄 vs 我們 input
8. MCP／使用者：能否在站內選到；MCP 是否同火力；檢視者唯讀

【允許的指令（金錢安全）】
- 零成本：npx tsx scripts/verify-models.ts
- 連通（不生成）：npx tsx scripts/probe-fal-endpoints.ts
  真實：FAL_KEY=… npx tsx scripts/probe-fal-endpoints.ts --yes [--only <category>]
- 點數：npx tsx scripts/audit-model-pricing.ts
- Live 生成（一次只能一個，必須先估點）：
  npx tsx scripts/verify-models.ts --probe "<id>"
  npx tsx scripts/verify-models.ts --probe "<id>" --yes
- needs 有值：禁止 --probe；改記「需站內素材實測」
- NIM：scripts/check-nim.ts
- 禁止：for 迴圈對多個 id 下 --yes；禁止並行 live 同一批扣費

【每模報告模板】
## 1 身分（label/category/tier/verified/needs/recommended）
## 2 數值表（points/cost/官方價/估值/判定）
## 3 連通與生成（靜態／dry-run／live：未跑|成功|失敗／結論 ready|ready-static-only|broken）
## 4 底層邏輯與 API 差異
## 5 站內扣點／退點
## 6 情境與可用性
## 7 MCP／文件連結
## 8 建議動作：維持｜調 points｜修 input/id｜verified true（僅建議，勿擅自改 true）｜下架

【實作原則】
- 先 L0→L1→L2 全指派範圍做完，再對高優先（recommended 或工作台常用）做 L4
- 發現 NOT_FOUND 或扣點不一致：在報告標 broken，可另開最小 fix PR
- 不要改 verified:true，除非使用者明確要求且 live 或文件已確認
- 用繁體中文寫報告；id 保持原文

【完成】
回報：完成幾個、broken 列表、建議調點列表、實際是否有 live 及花費摘要。
```
