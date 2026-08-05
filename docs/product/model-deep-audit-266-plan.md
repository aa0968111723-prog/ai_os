# 計畫：266 模型深度研究與長時間實測（大更新）

> 狀態：**待終端分批／多代理執行**（本 PR 為計畫＋操作契約）  
> 分支：`plan/model-deep-audit-266` → base `claude/healing-migration-ai-os-erewp2`  
> 版本：**v2 大更新**（2026-08-05）— 併入 Fal **台幣 NT$1,000** 預算、多代理租約鎖、黃金題組、LLM-as-Judge（#421）、60s 循環  
> 單一真相：`shared/models.ts` → `MODELS`（**266**）  
> 工具：`verify-models.ts`、`probe-fal-endpoints.ts`、`audit-model-pricing.ts`、`gen-model-docs.ts`、`e2e-models.py`、`e2e-mcp.py`  
> 配套：#421 `llm-as-judge-model-audit-plan.md`、`docs/模型底層邏輯與運作流程.md`、`docs/模型指南研究補遺.md`

---

## 0. v2 大更新摘要

| 新增／加深 | 內容 |
|------------|------|
| **Fal 預算** | 僅計 fal.ai 帳單，**NT$1,000**；softStop **NT$900** |
| **深度方法** | 暴露面矩陣、黃金題組跨模對照、帳單級抽樣、情境一致性 |
| **多代理** | 號段並行；`locks/*.json` **租約**；全域唯一 live-worker |
| **Judge** | 成功 artifact → #421 LLM-as-Judge（預設 NIM 0 點） |
| **循環** | 可 60s loop；無使用者「停止」不主動結束 |

**完成心智：** 266 全做 L0–L2＋研究；live 只做代表性 **數十次**，不追求 266 全生成。

---

## 1. 目標（每模必答）

| 維度 | 問題 |
|------|------|
| 數值 | points、cost vs 官方價／估值 |
| 底層 | needs、input()、旗標 vs fal schema |
| 站內點數 | UI = reserveQuota = 目錄；失敗退點 |
| 實際呼叫 | 端點存在；可選最小 live |
| 輸入 | 必填、長度、缺來源攔截 |
| 情境 | strengths／bestFor／recommended 是否合理 |
| API／MCP | 文件有效；MCP 同火力；使用者能否選到 |
| **品質（有 artifact 時）** | Judge 分數（#421） |

**非目標：** 266 高清全生成；自動改 `verified`／points；用 Judge 取代連通測試。

---

## 2. Fal.ai 台幣預算（硬契約）

```json
{
  "provider": "fal.ai",
  "currency": "TWD",
  "budgetTotal": 1000,
  "spentTwd": 0,
  "softStop": 900,
  "usdToTwd": 32,
  "entries": []
}
```

路徑：`docs/model-audit/budget.json`

| 用途 | NT$ |
|------|-----|
| L1 空輸入連通 | ≈0 |
| Live 最小生成 | **750** |
| 失敗／重試緩衝 | 150 |
| 保留 | 100（觸 softStop 後禁止 `--yes`） |

規則：

1. 只計 **fal 實收**（USD×匯率≈TWD）；NIM／靜態不佔。  
2. `--yes` 前：`spentTwd + estTwd > 900` → **禁止生成**。  
3. 單次估點 **≥80（約 NT$80）** → 預設跳過或全庫極少次。  
4. 僅 **live-worker** 可寫 `spentTwd`。  
5. 禁止多代理並行 `--yes`、禁止 for 多 id live。

---

## 3. 金錢與腳本鐵律

1. 批次連通只許 `probe-fal-endpoints.ts` 空 `{}`。  
2. Live 只許 `verify-models.ts --probe "<id>" [--yes]`，一次一個；`needs` 有值拒 probe。  
3. 無 `--yes` 不送付費請求。  
4. `verified: true` 僅人工 PR。  
5. Live 優先：recommended／工作台常用 → 類別經濟代表 → 其餘 unverified。

---

## 4. 分層測試

### L0 靜態（0 元）
`npx tsx scripts/verify-models.ts` → 清查清單；檢查重複 id、category。

### L1 連通（≈0 元）
`probe-fal-endpoints.ts --yes`；NIM → `check-nim.ts`。

### L2 點數校準（0 元 fal）
`audit-model-pricing.ts` → `docs/點數校準報告.md`。

### L3 input／generation 契約
對照 `模型底層邏輯…`、generationCore；needs 攔截與 e2e-models。

### L4 Live（吃 Fal 預算）
估點 → 檢查 budget → `--yes`；最短中性 prompt。

### L5 站內扣點抽樣
每類經濟＋可選旗艦；成功扣點／失敗退點；BYOK 分列。

### L6 情境與暴露面

**暴露面矩陣（機械，0 元）：** 直接出圖？分鏡可填？需來源？助手／MCP？verified 風險提示？

**情境：** bestFor vs 能力；與 `模型指南研究補遺` sc-* 一致性。

### L7 MCP／API 文件
e2e-mcp；fal 模型頁 200；必填欄 diff。

### L8 品質 Judge（#421，裁判預設 0 點）
僅黃金題組成功 artifact → `judge-model-output`（實作後）；分數入 `judgements/`，不改 MODELS。

---

## 5. 黃金題組（深度比較）

`docs/research/model-golden-set.md`（實作時建立），最少：

| goldenId | 模態 | 用途 |
|----------|------|------|
| zh-poster-01 | image | 繁中海報 |
| portrait-solemn-01 | image | 莊嚴人像 |
| ink-scene-01 | image | 水墨 |
| i2v-still-01 | video | 定裝微動（需圖） |
| tts-sutra-01 | audio | 短旁白 |
| ocr-zh-01 | vision | 繁中 OCR |

同題同參數換模型 → 才評 recommended 是否站得住。

---

## 6. 多代理與租約鎖

### 6.1 資源

`docs/model-audit/locks/`：

| 檔 | 互斥 | TTL 建議 |
|----|------|----------|
| `range-{a}-{b}.json` | 同段 | 2h + heartbeat |
| `probe-coord.json` | 全域 1 | 30min |
| `live-probe.json` | 全域 1 | 5–10min |
| `judge.json` | 可 1～2 | 5min |

租約欄位：`holder, resource, acquiredAt, expiresAt, heartbeatAt, token`。  
過期可 steal；heartbeat 每輪更新。

### 6.2 產物分片（避 _index 熱點）

- 每模：`docs/model-audit/cards/<slug>.md`  
- 列資料：可選 `rows/<slug>.json`  
- `_index.md` 由彙總腳本或分片合併，禁止整表盲目覆寫  

### 6.3 角色

| 角色 | 可並行 | 可 --yes live |
|------|--------|----------------|
| static+research | 多（號段不重疊） | 否 |
| probe-coord | 1 | 否（僅空輸入 probe） |
| live-worker | **1** | **是**（查 budget） |
| judge | 1～2 | 否（NIM） |

### 6.4 可選 CLI

`scripts/audit-lock.ts`：`acquire | heartbeat | release | status`

---

## 7. 每模報告模板

```markdown
# <model id>
## 1 身分 / 2 數值 / 3 連通與生成 / 4 底層
## 5 站內點數 / 6 暴露面與情境 / 7 MCP／文件
## 8 Judge（若有）overall + 維度
## 9 建議：維持｜調點｜修 id｜verified true（僅建議）｜下架
```

---

## 8. 波次（長時間）

| 波 | 內容 | 費用 |
|----|------|------|
| B0 | L0 全 266 + _index／cards 骨架 | 0 |
| B1 | L1 全端點 | ≈0 |
| B2 | L2 校準 | 0 |
| B3 | 暴露面矩陣 + L6 草稿 | 0 |
| B4 | 代表模 L4 live（budget 內） | ≤750 |
| B5 | 黃金題 + Judge | live 已含；裁判≈0 |
| B6 | L5 扣點抽樣 + L7 MCP | 少量 |

類別順序：t2i → edit → t2v → i2v → speech/audio → vision/LLM → trainer（少 live）。

---

## 9. 完成定義

- [ ] 266 × L0＋L1＋L2 有結果  
- [ ] budget.json 存在且 spentTwd ≤ 1000  
- [ ] NOT_FOUND 已修或標記下架  
- [ ] 暴露面矩陣完成  
- [ ] 代表性 live 有紀錄；高價未測有明示  
- [ ] 有 artifact 的黃金題可有 Judge  
- [ ] 不要求 266 live  

---

## 10. 多代理 60s 循環提示詞（可直接貼）

```text
你是 ai_os 模型審計代理之一。使用者沒說「停止」就持續循環，不要自行結束。

【預算】Fal.ai 台幣 1000，softStop=900，docs/model-audit/budget.json。
【計畫】docs/product/model-deep-audit-266-plan.md（#420）+ llm-as-judge（#421）。
【真相】shared/models.ts MODELS 266。

【啟動】登記 docs/model-audit/locks/：agentId、號段或 category、角色。
範圍不可重疊。live-worker 全庫只能 1 個（持有 live-probe 租約）。

【本代理設定】
agentId：
號段或 category：
角色：static+research | probe-coord | live-worker | judge

【每輪】做 1 個最小單元 → 更新自己的 card/row 與 heartbeat → sleep 60 → 下一輪。
禁止整檔覆寫別人的 _index 列；只改自己範圍。

【優先（角色內）】
static+research：P0 骨架 → P1 靜態 → P2 暴露面/情境/文件研究（0 元）
probe-coord：每輪最多 1 個 category 的 probe-fal-endpoints（可 --yes 空輸入）
live-worker：讀 budget；估點；spent+est≤900 才 --yes；每輪最多 1 次 live；記 entries
judge：每輪最多 1 個 artifact（NIM）；寫 judgements/

【禁止】並行 live、for 多 id --yes、自動 verified true、超 softStop 仍生成。

【輸出】agentId|#N|本輪|檔案|spentTwd|下一輪 → sleep 60。
立刻開始 #1，不要問是否開始。
```

零費用長跑：全員 `static+research`，並加一句「禁止任何 --yes」。

---

## 11. 單代理提示詞（短）

見歷史 §10 單代理版；務必加上 budget softStop=900 與 Fal 台幣 1000。

---

## 12. 文件與腳本對照

| 路徑 | 用途 |
|------|------|
| docs/model-audit/budget.json | Fal TWD 預算 |
| docs/model-audit/locks/* | 租約 |
| docs/model-audit/cards/* | 每模深卡 |
| docs/model-audit/judgements/* | Judge JSON（#421） |
| docs/research/model-golden-set.md | 黃金題 |
| docs/fal端點連通報告.md | L1 |
| docs/點數校準報告.md | L2 |

---

## 13. 回滾與風險

- 審計與「調點／改 id」PR 分離  
- 匯率波動：保守取高 spent  
- 官方改價：每月重跑 L2  
- 鎖死：租約過期可 steal  
