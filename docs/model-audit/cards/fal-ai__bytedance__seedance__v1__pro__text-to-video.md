# fal-ai/bytedance/seedance/v1/pro/text-to-video

> 審計：R3 · index **#109** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__bytedance__seedance__v1__pro__text-to-video`

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/bytedance/seedance/v1/pro/text-to-video`（`endpointOf` 同字串，無 alias） |
| label | Seedance 1.0 Pro(字節) |
| category / kind | **text-to-video** · video |
| tier | **flagship** |
| points | **19** |
| cost（目錄） | `≈$0.62/支(1080p 5秒)` |
| verified | **true**（既有；本回合**未**改碼、未觸 live） |
| needs | 無（純文生，無來源素材） |
| recommended | **false** |
| strengths | 寫實質感與運鏡一致性極佳、指令遵循準(1080p) |
| bestFor | 寫實空鏡與敘事鏡頭的成片首選 |
| 供應商 | ByteDance Seed **Seedance 1.0 Pro** · fal 託管 queue |
| 姊妹 | Lite t2v `…/v1/lite/text-to-video`（6 點／720p）；**1.5 Pro** t2v（8 點／720p **含音**）；**2.0** t2v（47 點／按秒）；Lite i2v；1.5 Pro i2v（無 1.0 Pro 獨立 i2v 於目錄） |

**一句話**：字節寫實／指令遵循旗艦的 **無音 1080p 文生影片**——空鏡與敘事成片的高質感選項；有聲請升 1.5／2.0，量產草稿先走 Lite 或 Wan。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **19** |
| cost（目錄） | `≈$0.62/支(1080p 5秒)` |
| 官方價與單位（fal 公開摘要） | **≈$0.62／1080p 5 秒**；其餘解析／時長走 **video token**：**$2.5 / 1M tokens**；`tokens(video)=(height×width×FPS×duration)/1024` |
| 解析／`parseRealCost` | `usdMid: 0.62` · `multiplier: ×1（每次一件）` · unitNote 對齊「/支」 |
| `realPricePoints`／覆寫 | `0.62 × 1 × 31 = 19.22` → **round 19**（與目錄一致） |
| `estimatePoints`（扁平） | **19**（與 prompt 長度無關；**不**隨 duration／resolution 變動） |
| 估值 NT$（假設 1 點≈NT$1） | **≈ NT$19.2**（校準報告 19.2） |
| 時長／解析假設（站內實際送出） | 站內 **不送** `duration`／`resolution` → 吃官方預設 **`5` 秒 + `1080p`** → 恰對應 base ≈$0.62 |
| 校準判定 | **≈**（點數對齊 **預設 1080p／5s**；若未來 UI 開長秒／不改點會**低估**） |

**階梯示意（官方 token 公式估算，假設 24fps · 16:9 像素；非站內扣點）**

| 設定 | 約 USD（$2.5/M tok） | 約 NT$（×31） | vs 固定 19 點 |
|------|----------------------|---------------|---------------|
| 5s · 1080p（預設／現況） | ~0.61–0.62 | ~19 | **≈** |
| 5s · 720p | ~0.27 | ~8 | 平台**高估**（仍扣 19） |
| 5s · 480p | ~0.12 | ~4 | 平台高估 |
| 10s · 1080p | ~1.22 | ~38 | 低估 ~半 |
| 12s · 1080p | ~1.46 | ~45 | 嚴重低估 |

**對照**：Lite `$0.18/720p 5s` → 6 點；1.5 Pro 含音 `$0.26/720p 5s` → 8 點；本檔無音 1080p 旗艦 19 點溢價合理。Fast 變體（站外）約 $0.245/1080p 5s——**未**收錄本目錄。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — `MODELS` 唯一 id、category∈CATEGORIES、必填欄齊（label/points/cost/tier/verified/strengths/bestFor/input） |
| OpenAPI（研究） | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/bytedance/seedance/v1/pro/text-to-video` · schema `BytedanceSeedanceV1ProTextToVideoInput`／`SeedanceProTextToVideoInput` |
| dry-run probe | 本環境 **無 FAL_KEY**；`verify-models.ts --probe` 僅能估點路徑，**未**送 queue |
| 歷史空輸入 probe 報告 | `docs/fal端點連通報告.md` 本端點列 **✅ 連通(誤排佇列已取消)** · HTTP 200——優於同批多檔 cancel_unconfirmed／TRANSIENT |
| live probe（L4） | **未跑**（R3 本回合 static+research；禁止 `--yes`） |
| playground／模型頁 | `https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/text-to-video`（本環境 HTML 429／checkpoint；OpenAPI 與公開定價摘要已交叉） |
| 結論 | **ready-static-only** — 契約與官方 schema／base 定價一致、`verified` 已 true、歷史 L1 連通綠；本回合無新 live 出片 |

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| `modelMechanicsFor` | **family: `dit`** ·「時序 DiT（Diffusion Transformer）」— seedance 正則命中影片族 |
| 文字塔 | `textEncoderProfileFor` → **`video-closed`**（閉源未公開窗口；不可量 token） |
| 條件／時間 | 潛空間 patch + 時序一致性；字節行銷強調多鏡頭敘事、寫實細節與運鏡一致（1080p） |
| 輸出 | OpenAPI：`video`（File）+ `seed`（integer，echo） |

### 4.2 官方 OpenAPI 摘要（2026-08-05 拉取）

- **Queue**: `https://queue.fal.run`
- **required**: 僅 `prompt`
- **properties**（`x-fal-order-properties`）:
  - `prompt` — string，文生影片提示（example 含多鏡頭 bracket 運鏡描述）
  - `aspect_ratio` — enum **`21:9`｜`16:9`｜`4:3`｜`1:1`｜`3:4`｜`9:16`**，default **`16:9`**
  - `resolution` — enum **`480p`｜`720p`｜`1080p`**，default **`1080p`**
  - `duration` — enum **`"2"`…`"12"`**（字串秒），default **`"5"`**
  - `camera_fixed` — boolean，default **false**（固定機位）
  - `seed` — integer｜null（`-1` 表隨機）
  - `enable_safety_checker` — boolean，default **true**
  - `num_frames` — integer 29–289｜null（**覆蓋** duration）
- **Output**: `video` + `seed`（皆 required）
- **無**：`negative_prompt` / `image_url` / `prompt_optimizer` / 原生音訊欄

### 4.3 站內 `input()` vs 官方

站內（`shared/models.ts`）：

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) })
// aspect = (f) => f  → 送出 "16:9" | "9:16" | "1:1"
```

三比例快照：

| format | 站內 body | OpenAPI |
|--------|-----------|---------|
| `16:9` | `{ prompt, aspect_ratio: "16:9" }` | `prompt` ✅；`aspect_ratio` ✅ enum |
| `9:16` | `{ prompt, aspect_ratio: "9:16" }` | 同上 ✅ |
| `1:1` | `{ prompt, aspect_ratio: "1:1" }` | 同上 ✅（**有 1:1**，優於 Luma Ray-2） |

| 能力 | 站內 | 官方 | 備註 |
|------|------|------|------|
| `prompt` | ✅ 必送 | ✅ required | 站內未專屬 min/maxLength；過短／極長風險低於 schema 硬限 |
| `aspect_ratio` | ✅ 每請求送專案 format | ✅ 含 16:9／9:16／**1:1** | **三比例全健康** |
| `duration` | ❌ 不送 | 預設 `"5"` | 吃官方預設 → 與 19 點校準一致 |
| `resolution` | ❌ 不送 | 預設 **`1080p`** | 吃官方預設 → base 價；旗艦畫質敘事成立 |
| `camera_fixed` | ❌ 不送 | 預設 false | 固定機位空鏡可選後開 |
| `seed` | 不送（**不在** `SEED_SUPPORTED`） | schema **有** | 消融無法鎖噪聲；保守 allowlist 未收 |
| `enable_safety_checker` | ❌ 不送 | 預設 true | 合理預設 |
| `num_frames` | ❌ 不送 | 可覆蓋 duration | 進階；勿在未估點前暴露 |
| `negative_prompt` | 不注入 | schema 無 | **正確不送** |

**契約健康度**：**優**——必填 `prompt` 與三站內比例皆在 enum；預設 1080p／5s 與 cost／points 敘事一致。殘差在 **未暴露 seed／camera_fixed／時長階梯**（產品取捨，非契約破）。`NEGATIVE_PROMPT_SUPPORTED` **刻意未收**——與 OpenAPI 一致。`SEED_SUPPORTED` 未收本 id——與「schema 有 seed」形成 **P2 可選缺口**（非錯誤，屬保守）。

### 4.4 generationCore 路徑

- `model.input(positivePrompt, project.format, …)` → 上表 body  
- 世界觀禁忌：因 `supportsNegativePrompt===false`，**不會**附加 `negative_prompt`（禁忌僅能靠正向改寫／移出）  
- seed：即使消融帶 `seed`，`supportsSeed===false` → **不會**寫入 providerInput  
- 扣點：`estimatePointsFor` → 扁平 19 → `reserveQuota`；失敗走退點交易路徑（全站共用）  
- endpoint：`endpointOf` = id → `falSubmit("fal-ai/bytedance/seedance/v1/pro/text-to-video", …)`

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 points | **19**（亦由 `realPricePoints` 自 cost 覆寫一致） |
| 預估／扣點 | `estimatePoints` = 19；與 prompt 字數無關 |
| UI | 挑選器／配方／showdown 顯示與 `MODELS[].points` 同源 |
| 退點 | 生成失敗 terminal + 帳本退點；本回合**未**做 L5 真扣點 |
| BYOK | 若走使用者自備 key，點數實際可為 0（平台 key 才扣 est）— 通用規則 |
| 與官方 | base ≈$0.62×31≈19.2 → **≈19**，**無需調點**（前提：維持預設 5s／1080p） |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 寫實空鏡／敘事鏡頭成片（**純文字**） | ✅ | bestFor／strengths 對味；生態研究列「質感檔：Seedance 1.0 Pro 或 Luma Ray 2」 |
| 莊嚴療癒空景（**有首格圖**） | △ | Recipe `sc-zen-broll` 首選 **Luma Ray-2 i2v**，非本 t2v |
| 唯美療癒空鏡 showdown | △ | `sh-video`「唯美療癒空鏡」winner 是 **Luma Ray-2 t2v**；本檔偏**寫實乾淨**非意境唯美 |
| 要原生對白／BGM | ❌ | **1.0 Pro 無原生音訊**；有聲改 **1.5 Pro**（8 點）／Veo／Kling 有聲檔 |
| 畫面內中文字 | ❌ | 影片族不渲染可靠中文字；字卡另做 |
| 人物會演／情緒特寫 | △ | 非主場（Hailuo 更會演）；寫實空鏡／運鏡敘事較穩 |
| 社群 1:1 專案 | ✅ | 官方 **有 1:1**（對比 Luma 缺 1:1） |
| 中文提示理解 | ✅ | 字節系；生態研究：華語情境詞較懂 |
| 預算預覽 | 先 Lite 6 點／Wan | 旗艦 19 點留給 1080p 成片級 |
| 手動選模 | ✅ | category text-to-video，needs 無 |
| 助手／代理 | ✅ 可被選 | `verified:true` → operational ready；**recommended:false** 且 flagship 19 點，budget 偏好下分數低於經濟檔 |
| MCP | ✅ | `find_model` 可命中；`submit_generation` 帶 `modelId`+`prompt` 即可 |

**文案一致性**：strengths／bestFor 與目錄／生態研究「寫實空鏡成片」一致；與 Luma 的產品區分應是「**寫實乾淨敘事** vs **意境療癒運鏡**」。cost 以 1080p 5s 錨定——與 OpenAPI 預設一致（優於 Luma 預設 540p 易誤判畫質）。

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| MCP `find_model` | category=`text-to-video`、keyword「Seedance／字節／寫實／空鏡」、tier=flagship、points=19 |
| MCP `submit_generation` | 建議 body：`projectId` + `modelId` + `prompt`；**勿**自拼 duration／resolution／num_frames 除非同步改點數；aspect 由專案 format 注入即可 |
| 文件 | [fal 模型頁](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/text-to-video) |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/bytedance/seedance/v1/pro/text-to-video` |
| 定價摘要 | **≈$0.62／1080p 5s**；其他設定 **$2.5／1M video tokens** |

**建議 MCP 形狀**：

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/bytedance/seedance/v1/pro/text-to-video",
  "prompt": "清晨山寺石階，薄霧緩移，低角度慢推至殿門，陽光穿過松枝形成丁達爾光柱，寫實電影感，運鏡平穩，無人無字幕"
}
```

## 8. 建議動作

- [x] **維持** points=19、cost 字串、verified=true、recommended=false（本回合不改碼）
- [ ] 調 points — **不需要**（base 5s／1080p 校準 ≈）
- [ ] 修 input/id — **不需要**（aspect 三比例皆在官方 enum；優於 #108 Luma 1:1 問題）
- [ ] verified true — **已是 true**；本回合**禁止**改動 verified
- [ ] 下架或隱藏 — **否**
- [ ] seed allowlist — **可選 P2**：將本 id 納入 `SEED_SUPPORTED`（OpenAPI 有 `seed`，便於消融重現）；需再確認 generationCore 只送整數、勿送 -1 以外魔法值
- [ ] 進階參數 — **P3**：`camera_fixed` 適合「固定機位空鏡」；若產品要開 duration／resolution，**必須**連動 token 估點，否則長秒嚴重倒貼
- [ ] cost 文案 — **P3**：可補「token 計價；$2.5/M；預設 1080p 5s」以免以為任意時長固定 $0.62
- [ ] L1 有效 probe — 有 FAL_KEY 時對本 endpoint 空輸入 `{}` 應期望 **422 OK_VALIDATED**（勿 --yes 生成）；歷史已 ✅ 連通
- [ ] L4 live — 控費單次：`npx tsx scripts/verify-models.ts --probe "fal-ai/bytedance/seedance/v1/pro/text-to-video"` 估點後再人工 `--yes`（約 19 點／~$0.62 @ 預設）

**優先級（僅建議）**

| 級 | 項 |
|----|-----|
| P2 | 可選：`SEED_SUPPORTED` 收錄本 id（schema 有 seed） |
| P3 | cost／UI 註明 token 階梯與預設 1080p／5s；`camera_fixed` 產品可選 |
| P3 | 若開 2–12s 或 480/720p：必須動態 `estimatePoints`，否則平台倒貼或高估 |
| — | **不**納入 `NEGATIVE_PROMPT_SUPPORTED`（schema 無） |
| — | **不**與 1.5 Pro 混淆：本檔**無音**；有聲用 v1.5 |

## 9. 來源

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/bytedance/seedance/v1/pro/text-to-video` → `BytedanceSeedanceV1ProTextToVideoInput`／Output 全表（含 duration 2–12、resolution、seed、camera_fixed）  
2. fal 公開定價摘要：**≈$0.62／1080p 5s**；$2.5／1M video tokens；`tokens=(h×w×FPS×duration)/1024`（[模型頁](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/text-to-video)；本環境頁面 429，與搜尋快照／生態研究交叉）  
3. 站內：`shared/models.ts`（entry、`input`、SEED／NEGATIVE allowlist、`sc-zen-broll`、`sh-video`）  
4. `shared/models.ts` `parseRealCost`／`realPricePoints`、`docs/點數校準報告.md`（Seedance 1.0 Pro 列 ≈19.2）  
5. `shared/modelMechanics.ts`、`shared/textEncoders.ts`  
6. `server/services/generationCore.ts`（input／negative／seed／quota）、`server/services/aiModelPolicy.ts`（operational ready）  
7. MCP：`server/services/mcp.ts`、`shared/mcpCatalog.ts`  
8. `docs/fal生態研究.md`（Seedance 1.0 Pro 列 ✅已查證）、`docs/模型目錄.md`、`docs/fal端點連通報告.md`（本端點 ✅ 連通）  
9. 姊妹對照：Lite t2v／1.5 Pro t2v（含音）／2.0 t2v；站外 Fast 約 $0.245/1080p 5s（未收錄）  

---

**R3 checklist（#109）**

- [x] L0 靜態契約  
- [x] OpenAPI／定價研究（無 `--yes` live）  
- [x] 點數校準對照（含 token／長秒低估風險註記）  
- [x] input vs schema 差異（三比例健康；seed 未 allowlist）  
- [x] MCP／助手／情境交叉  
- [x] 九章卡 + `_index` #109 + heartbeat  
- [x] **未**改 verified／points；**未** live 扣費  
