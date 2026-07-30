# 概念：AI 專案職能（組員感）

| 欄位 | 值 |
|------|-----|
| **Document ID** | AI-ROLES-2026-07 |
| **Status** | Accepted for product direction（本 PR 僅文件） |
| **Date** | 2026-07-30 |
| **Related** | `docs/AI代理架構與維運.md`、`docs/product/creative-agent-evolution-roadmap.md`、`docs/product/fal-balance-and-personal-usage-plan.md`、`docs/product/mobile-project-page-declutter-plan.md` |

---

## 1. 一句定錨

> **人是專案成員；AI 是可啟用的職能席位。**  
> **LLM 負責想與拆；Fal 負責做媒體；ai_os 負責權限、點數與真相。**

「AI 代理組員／專案員」是**產品敘事與指派介面**，不是在 `memberships` 裡新增假 user，也不是再長一套 multi-agent runtime。

---

## 2. 為什麼要這個概念

非工程師使用專案頁時，心智模型是「誰負責分鏡／誰出圖／誰過片」，不是「開一個 agent run」。

若直接把產業 Multi-Agent（導演 agent ↔ 編劇 agent 互聊）搬進站內：

- 與既有 DAG／冪等／`generationCommand` 雙重 runtime
- 點數與 Fal 帳單真相分裂
- 專案 ACL 難對齊
- 手機版資訊量再爆（與減負方向衝突）

因此採用：**職能（role）+ playbook + 既有 agent run**，借 CrewAI「角色」心智，不引入 CrewAI／LangGraph／Temporal 依賴（與 CA 路線圖 KD-01 一致）。

---

## 3. 三種不可混淆的實體

| 實體 | 資料落點 | 是否「組員」 |
|------|----------|-------------|
| **真人成員** | 帳號、組角色、專案 role（editor／viewer） | 是 |
| **Agent run（創作代理）** | `agent_runs` + steps + events | 一次任務的執行體，不是長期員工 |
| **AI 職能席位（本文件）** | 產品設定／playbook id；執行時仍開 agent run | 對使用者像組員；對系統是可啟用的職能 |

### 明確禁止

- 在成員名單新增 `AI-某某` 假帳號（私訊、協作游標、權限稽核會壞）
- 讓外部 Fal Agent 成為權限或點數的真相來源
- 繞過 `executeGenerationCommand` 的第二條生成／扣點路徑（TD-02）
- 預設開啟高成本 VLM 對每鏡打分

---

## 4. 供應商分工

```text
使用者目標
    ↓
【LLM｜規劃腦】 既有助手／規劃模型（如 NVIDIA NIM）
    · 拆計畫、短代號、估點、缺資訊
    · 核准前零副作用
    ↓
【Runner｜執行骨】 agentRunner + DAG
    · 人類等待、筆記、排程、觸發生成
    ↓
【Fal.ai｜手與感官】 只經 generationCommand
    · 圖／影片／TTS 等媒體；扣點；入素材庫
    ↓
（可選）【VLM｜品管眼】 flag 預設 off、reroll cap
```

| 供應商 | 適合 | 不適合 |
|--------|------|--------|
| 既有 LLM | 導演式規劃、意圖路由、寫提示 | 無限人格常駐互聊 |
| Fal.ai 媒體 API | 真實出圖／出片／配音 | 專案 ACL、組隔離帳本 |
| Fal Agents／外部 workflow（若使用） | **工具後端**（一步 kind 或 tool） | 取代 `agent_runs`／核准／insights |

平台級 Fal USD 餘額僅超管可見（見 fal-balance 計畫）；個人只看站內點數用量。

---

## 5. 職能表（產品初稿）

| 職能 id（建議） | 使用者稱呼 | 主要由 | 典型步驟／能力 | 人必須保留 |
|-----------------|------------|--------|----------------|------------|
| `role.director` | 企劃／導演助理 | LLM | 澄清目標、補 missingInformation、產出 plan summary | 核准計畫、定調 |
| `role.storyboard` | 分鏡助理 | LLM + Runner + Fal | 拆腳本 → 分鏡 → generate（須帶定裝） | 選鏡、擋禁忌 |
| `role.generate` | 生成員 | Fal via Command | 單步／多步 generate、voiceover | 預算與重跑上限 |
| `role.continuity` | 定裝守門 | 規則 + 既有 cards | characterIds／presets／continuity snapshot | 升版 bible、改設定 |
| `role.voice` | 配音統籌 | Fal TTS | voiceover 步驟、模型白名單 | 選音色、過稿 |
| `role.qa` | 品管 | 人為主，VLM 可選 | quality_gate（CA-08 類） | 過片、上架 |
| — | 權限／金流 | **只准人** | — | 組長／超管 |

職能在 UI 可顯示狀態：待命／執行中／等你核准——資料來自既有 run／task／insights，不另建 presence 系統。

---

## 6. 與真人協作

- 人類步驟繼續：`wait_for_human`、`request_approval`、`project_tasks`。
- Insights／任務牆 chip 以 `source` 區分：生成、範本、AI 計畫、人員（CA-03 方向）。
- AI 職能**不能**：改成員 role、花超過職能／專案預算、在未核准 plan 上執行副作用。
- 安全規劃契約維持：LLM 只見 `member1`／`char1` 等短代號；伺服器解析；未知引用 → missingInformation。

---

## 7. 分層落地（執行順序）

### L0 — 敘事層（可先做，幾乎零後端）

- 文案／空狀態把「開代理」說成職能：「請分鏡助理先出草稿」。
- 不改 schema；不改 ACL。

### L1 — Playbook = 職能（對齊 CA，不新 runtime）

- 每個職能對應可版本化的步驟模板（playbook），執行時仍建立一筆 `agent_run`。
- **阻塞依賴**：代理 generate 須與手動台同火力（定裝／來源／needs 模型）——見 CA-01；否則職能敘事無法成立。
- 統一工具描述層（CA-07）讓助手／MCP／runner 同一套職能工具語言。

### L2 — 專案「席位」設定（產品味）

- 專案設定：啟用哪些職能、預設模型、每職能週點上限。
- 一鍵：「本週短片 → 分鏡助理」→ 帶 goal 開 run。
- UI 預設收合，遵守手機減負（主線仍是生成／分鏡）。

### L3 — 外部 Fal Agent 僅作 tool（可選）

- 若接入 Fal 側 agent／workflow：包成 runner step 或 tool catalog 項。
- 輸入為已核准上下文；輸出入素材庫並記站內點。
- 禁止外部 agent 改權限或未審 plan。

### L4 — 品管職能（可選滯後）

- VLM critic 預設 off、reroll cap；失敗轉人類任務（CA-08 方向）。

---

## 8. 非目標

- 不引入 LangGraph／CrewAI／Temporal／OpenAI Agents SDK 作為 runtime。
- 不做無限畫布 NLE。
- 不把 Fal USD 自動兌換成站內點。
- 不在本概念階段改 `memberships` 表或假登入。

---

## 9. 風險摘要

| 風險 | 緩解 |
|------|------|
| 使用者把 AI 當真人 | UI 固定「AI 職能」標示；禁假頭像裝人 |
| 職能繞過核准燒點 | 核准前零副作用；職能預算 cap |
| 幻覺外鍵寫入 generation | 短代號 + 專案歸屬 fail-closed（CA-01） |
| 雙帳本混亂 | 個人點數 vs 平台 Fal 餘額分離展示 |
| 手機過載 | 席位收合；遵循 mobile declutter |

---

## 10. 與既有路線圖對照

| 本概念需求 | 既有／建議承載 |
|------------|----------------|
| 組員出圖不比手動差 | **CA-01** generate parity |
| 任務牆分清人／AI／生成 | **CA-03** insights `source` |
| 跨模式同一組角色素材 | **CA-02** CreationDraft |
| 審片／回報像組員回報 | **CA-05** notify／checkpoint |
| 職能＝工具一致語言 | **CA-07** tool catalog |
| 品管眼 | **CA-08**（可選） |
| 平台 Fal 餘額 | fal-balance 計畫 |
| 手機不更亂 | mobile-project-page-declutter |

本文件**不**取代 CA 路線圖；只定「組員／職能」產品邊界，實作優先跟 CA-01 等既有 PR，避免平行 runtime。

---

## 11. 驗收（文件向）

- [x] 定錨句與禁止項寫清
- [x] LLM／Fal／ai_os 三層分工
- [x] 職能表初稿與 L0–L4
- [x] 與 CA／Fal 餘額／手機減負交叉引用
- [ ] 產品確認後：L0 文案可開小 PR；L2 席位另開設計再實作

---

*End — AI-ROLES-2026-07*
