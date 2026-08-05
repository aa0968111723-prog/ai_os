# fal-ai/bytedance/seedance/v1.5/pro/text-to-video

> 審計：R3 · index **#110** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__bytedance__seedance__v1.5__pro__text-to-video`

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/bytedance/seedance/v1.5/pro/text-to-video`（`endpointOf` 同字串，無 alias） |
| label | Seedance 1.5 Pro(字節) |
| category / kind | **text-to-video** · video |
| tier | **flagship** |
| points | **8** |
| cost（目錄） | `$0.26/支(720p 5秒,含音)` |
| verified | **true**（既有；本回合**未**改碼、未觸 live） |
| needs | 無（純文生，無來源素材） |
| recommended | **false** |
| strengths | 寫實再進化、新增原生音訊;有聲寫實裡極具競爭力 |
| bestFor | 要寫實又一次帶環境音的成片 |
| 供應商 | ByteDance Seed **Seedance 1.5 Pro** · 聯合影音 DiT · fal 託管 queue |
| 姊妹 | **1.0 Pro** t2v（19 點／1080p **無音**）；Lite t2v（6 點／720p 無音）；**1.5 Pro i2v**（8 點／含音）；**2.0** t2v（47 點／按秒） |

**一句話**：字節 **原生有聲** 寫實文生影片的高 CP 旗艦——預設 720p／5s／含音 ≈$0.26（8 點）；要純視覺 1080p 無音可走 1.0 Pro，要更高規再升 2.0。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **8** |
| cost（目錄） | `$0.26/支(720p 5秒,含音)` |
| 官方價與單位（fal 公開摘要） | **≈$0.26／720p 5 秒（含音）**；其餘設定走 **video token**：**含音 $2.4 / 1M**、**無音 $1.2 / 1M**；`tokens(video)=(height×width×FPS×duration)/1024` |
| 解析／`parseRealCost` | `usdMid: 0.26` · `multiplier: ×1（每次一件）` · unitNote「每次一件」 |
| `realPricePoints`／覆寫 | `0.26 × 1 × 31 = 8.06` → **round 8**（與目錄一致） |
| `estimatePoints`（扁平） | **8**（與 prompt 長度無關；**不**隨 duration／resolution／generate_audio 變動） |
| 估值 NT$（假設 1 點≈NT$1） | **≈ NT$8.1**（校準報告 8.1） |
| 時長／解析／音訊假設（站內實際送出） | 站內 **不送** `duration`／`resolution`／`generate_audio` → 吃官方預設 **`5` 秒 + `720p` + `generate_audio=true`** → 恰對應 base ≈$0.26 |
| 校準判定 | **≈**（點數對齊 **預設 720p／5s／含音**；若未來 UI 開長秒／1080p／仍固定 8 點會**低估**） |

**階梯示意（官方 token 公式估算，假設 24fps · 16:9 像素；非站內扣點）**

| 設定 | 約 USD | 約 NT$（×31） | vs 固定 8 點 |
|------|--------|---------------|--------------|
| 5s · 720p · **含音**（預設／現況） | ~0.26 | ~8 | **≈** |
| 5s · 720p · **無音** | ~0.13 | ~4 | 平台高估（仍扣 8） |
| 5s · 480p · 含音 | ~0.12 | ~4 | 平台高估 |
| 5s · 1080p · 含音 | ~0.58 | ~18 | **低估 ~半** |
| 10s · 720p · 含音 | ~0.52 | ~16 | 低估 ~半 |
| 12s · 720p · 含音 | ~0.62 | ~19 | 嚴重低估 |

**對照**：1.0 Pro 無音 1080p 5s ≈$0.62 → 19 點；Lite 無音 720p 5s $0.18 → 6 點；本檔 **含音** 720p 5s $0.26 → 8 點——有聲寫實 CP 遠高於 Veo／多數 Kling 有聲檔（配方 `sc-t2v-sound` 目前未列本 id，見 §8）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — `MODELS` 唯一 id、category∈CATEGORIES、必填欄齊（label/points/cost/tier/verified/strengths/bestFor/input）；`endpointOf`＝id |
| OpenAPI（研究） | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/bytedance/seedance/v1.5/pro/text-to-video` · schema `BytedanceSeedanceV15ProTextToVideoInput`／`SeedanceProv15TextToVideoInput` |
| dry-run probe | 本環境 **無 FAL_KEY**；`verify-models.ts --probe` 僅能估點路徑，**未**送 queue |
| 歷史空輸入 probe 報告 | `docs/fal端點連通報告.md` **未列本 t2v 端點**（同族 1.5 **i2v** 為 cancel_unconfirmed；1.0 Pro t2v 歷史 ✅）——**不可**把 i2v 結果外推為本端點 L1 |
| live probe（L4） | **未跑**（R3 本回合 static+research；禁止 `--yes`） |
| playground／模型頁 | `https://fal.ai/models/fal-ai/bytedance/seedance/v1.5/pro/text-to-video`（本環境 HTML 429／checkpoint；OpenAPI 與公開定價摘要已交叉） |
| 結論 | **ready-static-only** — 契約與官方 schema／base 定價一致、`verified` 已 true；本回合無新 L1／live 出片 |

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| `modelMechanicsFor` | **family: `dit`** ·「時序 DiT（Diffusion Transformer）」— seedance 正則命中影片族 |
| 文字塔 | `textEncoderProfileFor` → **`seedream`**（id 含 `bytedance` 先於 `seedance→video-closed` 命中；閉源未公開窗口；不可量 token） |
| 條件／時間 | 潛空間 patch + 時序一致性；1.5 行銷為 **聯合影音**（dual-branch／同 latent 出畫面與音訊，對白／環境音／Foley） |
| 輸出 | OpenAPI：`video`（File）+ `seed`（integer，echo） |

### 4.2 官方 OpenAPI 摘要（2026-08-05 拉取）

- **Queue**: `https://queue.fal.run`
- **required**: 僅 `prompt`
- **properties**（`x-fal-order-properties`）:
  - `prompt` — string，文生影片提示（example 含對白引號＋腳步／法庭環境音描述）
  - `aspect_ratio` — enum **`21:9`｜`16:9`｜`4:3`｜`1:1`｜`3:4`｜`9:16`｜`auto`**，default **`16:9`**
  - `resolution` — enum **`480p`｜`720p`｜`1080p`**，default **`720p`**（**異於 1.0 Pro 預設 1080p**）
  - `duration` — enum **`"4"`…`"12"`**（字串秒；**無 2、3**），default **`"5"`**
  - `camera_fixed` — boolean，default **false**
  - `seed` — integer｜null（`-1` 表隨機）
  - `enable_safety_checker` — boolean，default **true**
  - `generate_audio` — boolean，default **`true`**（**1.5 關鍵欄；1.0 無**）
- **Output**: `video` + `seed`（皆 required）
- **無**：`negative_prompt` / `image_url` / `prompt_optimizer` / `num_frames`（1.0 有 num_frames，1.5 **無**）

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
| `1:1` | `{ prompt, aspect_ratio: "1:1" }` | 同上 ✅ |

| 能力 | 站內 | 官方 | 備註 |
|------|------|------|------|
| `prompt` | ✅ 必送 | ✅ required | 站內未專屬 min/maxLength；可描述對白與環境音 |
| `aspect_ratio` | ✅ 每請求送專案 format | ✅ 含 16:9／9:16／**1:1**／`auto` | **三比例全健康**；`auto` 未暴露 |
| `duration` | ❌ 不送 | 預設 `"5"` | 與 8 點校準一致 |
| `resolution` | ❌ 不送 | 預設 **`720p`** | 與 cost「720p 含音」一致（**勿**誤當 1080p） |
| `generate_audio` | ❌ 不送 | 預設 **true** | 吃官方預設 → **有聲** 與目錄敘事一致；若產品要「關音省半價」須顯式送 false **且** 聯動估點 |
| `camera_fixed` | ❌ 不送 | 預設 false | 固定機位空鏡可選後開 |
| `seed` | 不送（**不在** `SEED_SUPPORTED`） | schema **有** | 消融無法鎖噪聲；P2 可選 allowlist |
| `enable_safety_checker` | ❌ 不送 | 預設 true | 合理預設 |
| `negative_prompt` | 不注入 | schema 無 | **正確不送** |

**契約健康度**：**優**——必填 `prompt` 與三站內比例皆在 enum；預設 720p／5s／含音與 cost／points 敘事一致。殘差在 **未暴露 seed／generate_audio／時長·解析階梯**（產品取捨，非契約破）。`NEGATIVE_PROMPT_SUPPORTED` **刻意未收**——與 OpenAPI 一致。

### 4.4 generationCore 路徑

- `model.input(positivePrompt, project.format, …)` → 上表 body  
- 世界觀禁忌：因 `supportsNegativePrompt===false`，**不會**附加 `negative_prompt`  
- seed：即使消融帶 `seed`，`supportsSeed===false` → **不會**寫入 providerInput  
- 扣點：`estimatePoints` → 扁平 8 → `reserveQuota`；失敗走退點交易路徑（全站共用）  
- endpoint：`endpointOf` = id → `falSubmit("fal-ai/bytedance/seedance/v1.5/pro/text-to-video", …)`  
- **音訊**：站內不送 `generate_audio` → 供應商預設 true → 產出應含原生音軌（live 未驗證）

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 points | **8**（亦由 `realPricePoints` 自 cost 覆寫一致） |
| 預估／扣點 | `estimatePoints` = 8；與 prompt 字數無關 |
| UI | 挑選器／配方／showdown 顯示與 `MODELS[].points` 同源 |
| 退點 | 生成失敗 terminal + 帳本退點；本回合**未**做 L5 真扣點 |
| BYOK | 若走使用者自備 key，點數實際可為 0（平台 key 才扣 est）— 通用規則 |
| 與官方 | base ≈$0.26×31≈8.06 → **≈8**，**無需調點**（前提：維持預設 5s／720p／含音） |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 寫實敘事成片＋**一次帶環境音／對白** | ✅ | bestFor／strengths 對味；生態研究「有聲寫實 CP 極佳」 |
| 打字直接生成有聲短片 | ✅ | 比 Veo 3.1 便宜一個數量級；**但**配方 `sc-t2v-sound` 目前列 Veo／Kling／Wan，**未**列本 id |
| 純視覺 1080p 空鏡（不要音） | △ | 預設 720p＋含音；無音 1080p 可關 `generate_audio`（站內未暴露）或改走 **1.0 Pro**（19 點／1080p 無音） |
| 莊嚴療癒空景（**有首格圖**） | △ | Recipe `sc-zen-broll` 首選 Luma i2v；有圖請走 **1.5 Pro i2v**（#135） |
| 畫面內中文字 | ❌ | 影片族不渲染可靠中文字；字卡另做 |
| 人物會演／情緒特寫 | △ | 寫實運鏡強；「會演」主場仍偏 Hailuo |
| 社群 1:1 專案 | ✅ | 官方 **有 1:1** |
| 中文提示／中文語音傾向 | ✅ | 字節系；生態：華語情境詞較懂；音訊敘事支援中文對白 |
| 預算預覽／草稿 | Lite 6 點或 Wan | 本檔 8 點已屬有聲旗艦甜區，可當成片主力而非只草稿 |
| 手動選模 | ✅ | category text-to-video，needs 無 |
| 助手／代理 | ✅ 可被選 | `verified:true` → operational ready；**recommended:false**，budget 下仍優於 19 點無音 1.0 Pro |
| MCP | ✅ | `find_model` 可命中；`submit_generation` 帶 `modelId`+`prompt` 即可 |

**文案一致性**：strengths／bestFor 與目錄／生態研究「原生有聲寫實」一致；與 1.0 Pro 的產品區分應是「**含音 720p CP** vs **無音 1080p 畫質**」。cost 以 720p 5s 含音錨定——與 OpenAPI 預設一致。

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| MCP `find_model` | category=`text-to-video`、keyword「Seedance／1.5／有聲／環境音／字節」、tier=flagship、points=8 |
| MCP `submit_generation` | 建議 body：`projectId` + `modelId` + `prompt`（可寫對白與環境音）；**勿**自拼 duration／resolution／generate_audio 除非同步改點數；aspect 由專案 format 注入即可 |
| 文件 | [fal 模型頁](https://fal.ai/models/fal-ai/bytedance/seedance/v1.5/pro/text-to-video) |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/bytedance/seedance/v1.5/pro/text-to-video` |
| 定價摘要 | **≈$0.26／720p 5s 含音**；含音 **$2.4／1M video tokens**；無音 **$1.2／1M** |

**建議 MCP 形狀**：

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/bytedance/seedance/v1.5/pro/text-to-video",
  "prompt": "清晨山寺石階，薄霧緩移，低角度慢推至殿門，遠處鐘聲與鳥鳴，松枝沙沙，寫實電影感，無人無字幕"
}
```

## 8. 建議動作

- [x] **維持** points=8、cost 字串、verified=true、recommended=false（本回合不改碼）
- [ ] 調 points — **不需要**（base 5s／720p／含音校準 ≈）
- [ ] 修 input/id — **不需要**（aspect 三比例皆在官方 enum；`generate_audio` 預設 true 對齊「含音」敘事）
- [ ] verified true — **已是 true**；本回合**禁止**改動 verified
- [ ] 下架或隱藏 — **否**
- [ ] seed allowlist — **可選 P2**：將本 id 納入 `SEED_SUPPORTED`（OpenAPI 有 `seed`）
- [ ] 配方 — **可選 P2**：`sc-t2v-sound` 可將本 id 列為「有聲寫實經濟旗艦」備選（現列 Veo／Kling／Wan，漏掉 8 點含音甜區）
- [ ] 進階參數 — **P3**：暴露 `generate_audio`／duration／resolution 時 **必須** 聯動 token 估點（關音≈半價；1080p／長秒低估嚴重）
- [ ] cost 文案 — **P3**：可補「token 計價；含音 $2.4/M、無音 $1.2/M；預設 720p 5s 含音」
- [ ] L1 有效 probe — 有 FAL_KEY 時對本 endpoint 空輸入 `{}` 應期望 **422 OK_VALIDATED**（勿 --yes 生成）
- [ ] L4 live — 控費單次：`npx tsx scripts/verify-models.ts --probe "fal-ai/bytedance/seedance/v1.5/pro/text-to-video"` 估點後再人工 `--yes`（約 8 點／~$0.26 @ 預設；確認有聲軌）

**優先級（僅建議）**

| 級 | 項 |
|----|-----|
| P2 | 可選：`SEED_SUPPORTED` 收錄本 id |
| P2 | 可選：`sc-t2v-sound` 納入本 id（有聲 CP） |
| P3 | cost／UI 註明 token 階梯與預設 720p／5s／含音；`generate_audio`／`camera_fixed` 產品可選 |
| P3 | 若開 4–12s 或 480/1080p 或關音：必須動態 `estimatePoints` |
| — | **不**納入 `NEGATIVE_PROMPT_SUPPORTED`（schema 無） |
| — | **不**與 1.0 Pro 混淆：本檔**預設含音 720p**；1.0 為**無音 1080p** |

## 9. 來源

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/bytedance/seedance/v1.5/pro/text-to-video` → `BytedanceSeedanceV15ProTextToVideoInput`／Output 全表（含 duration 4–12、resolution、seed、camera_fixed、**generate_audio**）  
2. fal 公開定價摘要：**≈$0.26／720p 5s 含音**；含音 $2.4／1M、無音 $1.2／1M video tokens；`tokens=(h×w×FPS×duration)/1024`（[模型頁](https://fal.ai/models/fal-ai/bytedance/seedance/v1.5/pro/text-to-video)；本環境頁面 429，與搜尋快照／生態研究交叉）  
3. 站內：`shared/models.ts`（entry、`input`、SEED／NEGATIVE allowlist、`sc-t2v-sound`、`sc-zen-broll`）  
4. `shared/models.ts` `parseRealCost`／`realPricePoints`、`docs/點數校準報告.md`（Seedance 1.5 Pro 列 ≈8.1）  
5. `shared/modelMechanics.ts`、`shared/textEncoders.ts`（bytedance → seedream 文字塔）  
6. `server/services/generationCore.ts`（input／negative／seed／quota）、`server/services/aiModelPolicy.ts`（operational ready）  
7. MCP：`server/services/mcp.ts`、`shared/mcpCatalog.ts`  
8. `docs/fal生態研究.md`（Seedance 1.5 Pro 含音列 ✅已查證）、`docs/模型目錄.md`、`docs/fal端點連通報告.md`（**無**本 t2v 列；同族 i2v 另案）  
9. 姊妹對照：#109 1.0 Pro t2v（無音 1080p）；#135 1.5 Pro i2v；Lite t2v／2.0 t2v  

---

**R3 checklist（#110）**

- [x] L0 靜態契約  
- [x] OpenAPI／定價研究（無 `--yes` live）  
- [x] 點數校準對照（含 token／長秒／1080p 低估風險註記）  
- [x] input vs schema 差異（三比例健康；generate_audio 預設 true；seed 未 allowlist）  
- [x] MCP／助手／情境交叉  
- [x] 九章卡 + `_index` #110 + heartbeat  
- [x] **未**改 verified／points；**未** live 扣費  
