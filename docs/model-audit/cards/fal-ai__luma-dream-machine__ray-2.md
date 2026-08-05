# fal-ai/luma-dream-machine/ray-2

> 審計：R3 · index **#108** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__luma-dream-machine__ray-2`

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/luma-dream-machine/ray-2`（`endpointOf` 同字串，無 alias） |
| label | Luma Ray 2 |
| category / kind | **text-to-video** · video |
| tier | **flagship** |
| points | **16** |
| cost（目錄） | `$0.5/5秒` |
| verified | **true**（既有；本回合**未**改碼、未觸 live） |
| needs | 無（純文生，無來源素材） |
| recommended | **false** |
| strengths | 運鏡優雅、光影細膩、物理順;意境系旗艦 |
| bestFor | 莊嚴療癒的抽象空鏡、電影感慢運鏡 |
| 供應商 | Luma AI Dream Machine **Ray2** · fal 託管 queue |
| 姊妹 | Flash t2v `…/ray-2-flash`（6 點）；旗艦 **i2v** `…/ray-2/image-to-video`（16 點，配方 `sc-zen-broll` 首選）；Flash i2v；Modify／Flash Modify（v2v） |

**一句話**：Luma 意境／物理運鏡旗艦的 **文生影片**——無分鏡圖時的「唯美療癒空鏡」t2v 首選；有參考圖時站內療癒空景配方已改走 **同家族 i2v**。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **16** |
| cost（目錄） | `$0.5/5秒` |
| 官方價與單位（fal／OpenAPI 交叉） | **Base $0.50 / 5s @ 540p**；**9s 約 2×**（$1.00）；**720p 2×**、**1080p 4×**（相對同長 base） |
| 解析／`parseRealCost` | `usdMid: 0.5` · `multiplier: ×1（單支 5 秒固定價）` · unitNote 對齊 `/5秒` |
| `realPricePoints`／覆寫 | `0.5 × 1 × 31 = 15.5` → **round 16**（與目錄一致） |
| `estimatePoints`（扁平） | **16**（與 prompt 長度無關；**不**隨 duration／resolution 變動） |
| 估值 NT$（假設 1 點≈NT$1） | **≈ NT$15.5**（校準報告 15.5） |
| 時長／解析假設（站內實際送出） | 站內 **不送** `duration`／`resolution` → 吃官方預設 **`5s` + `540p`** → 恰對應 base $0.50 |
| 校準判定 | **≈**（點數對齊 **預設 540p／5s**；若未來 UI 開 720p／1080p／9s 而不調點會**嚴重低估**） |

**階梯示意（官方倍率，非站內扣點）**

| 設定 | 約 USD | 約 NT$（×31） | vs 固定 16 點 |
|------|--------|---------------|---------------|
| 5s · 540p（預設／現況） | 0.50 | 15.5 | **≈** |
| 5s · 720p | ~1.00 | 31 | 低估 ~半 |
| 5s · 1080p | ~2.00 | 62 | 嚴重低估 |
| 9s · 540p | ~1.00 | 31 | 低估 ~半 |
| 9s · 1080p | ~4.00 | 124 | 極嚴重低估 |

**對照**：Flash t2v `$0.2/支` → 6 點；本檔旗艦 base 16 點溢價合理。i2v 同家族同 16 點（$0.50/支敘事）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — `MODELS` 唯一 id、category∈CATEGORIES、必填欄齊（label/points/cost/tier/verified/strengths/bestFor/input） |
| OpenAPI（研究） | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/luma-dream-machine/ray-2` · schema `LumaDreamMachineRay2Input`／`Ray2TextToVideoRequest` |
| dry-run probe | 本環境 **無 FAL_KEY**；`verify-models.ts --probe` 僅能估點路徑，**未**送 queue |
| 歷史空輸入 probe 報告 | `docs/fal端點連通報告.md` 本端點列 **⏳ TRANSIENT**——但同檔多端點皆暫時性（環境性失效，**不可**當單模 404/連通結論） |
| live probe（L4） | **未跑**（R3 本回合 static+research；禁止 `--yes`） |
| playground／模型頁 | `https://fal.ai/models/fal-ai/luma-dream-machine/ray-2`（本環境 HTML 429／checkpoint；OpenAPI 與公開定價摘要已交叉） |
| 結論 | **ready-static-only** — 契約與官方 schema／base 定價一致、`verified` 已 true；本回合無有效 L1 HTTP 驗證與 live 出片 |

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| `modelMechanicsFor` | **family: `dit`** ·「時序 DiT（Diffusion Transformer）」— luma 正則命中影片族 |
| 文字塔 | `textEncoderProfileFor` → **`video-closed`**（閉源未公開窗口；不可量 token） |
| 條件／時間 | 潛空間 patch + 時序一致性；Luma 行銷強調自然物理與優雅運鏡 |
| 輸出 | OpenAPI：`video`（File，含 url） |

### 4.2 官方 OpenAPI 摘要（2026-08-05 拉取）

- **Queue**: `https://queue.fal.run`
- **required**: 僅 `prompt`（minLength **3**，maxLength **5000**）
- **properties**（`x-fal-order-properties`）:
  - `prompt` — string，文生影片提示
  - `aspect_ratio` — enum **`16:9`｜`9:16`｜`4:3`｜`3:4`｜`21:9`｜`9:21`**，default `16:9`
  - `loop` — boolean，default **false**（片尾與片首融合循環）
  - `resolution` — enum **`540p`｜`720p`｜`1080p`**，default **`540p`**（720p 2×、1080p 4× 費用）
  - `duration` — enum **`5s`｜`9s`**，default **`5s`**（9s 約 2× 費用）
- **Output**: `video`（required）
- **無**：`negative_prompt` / `seed` / `image_url` / `prompt_optimizer`

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
| `1:1` | `{ prompt, aspect_ratio: "1:1" }` | `prompt` ✅；**`1:1` 不在 enum** ⚠️ |

| 能力 | 站內 | 官方 | 備註 |
|------|------|------|------|
| `prompt` | ✅ 必送 | ✅ required 3–5000 | 過短（&lt;3）可能 422；站內未專屬 cap／min |
| `aspect_ratio` | ✅ 每請求送專案 format | ✅ 有 enum（**無 1:1**） | **16:9／9:16 健康**；**社群 1:1 為契約落差**（可能 422 或被拒） |
| `duration` | ❌ 不送 | 預設 `5s` | 吃官方預設 → 與 16 點校準一致 |
| `resolution` | ❌ 不送 | 預設 `540p` | 吃官方預設 → base 價；**非** 1080p 旗艦畫質 |
| `loop` | ❌ 不送 | 預設 false | 可選後製循環需求時可開 |
| `negative_prompt` | 不注入（不在 allowlist） | schema 無 | **正確不送** |
| `seed` | 不送（不在 SEED_SUPPORTED） | schema 無 | 消融無法鎖噪聲 |

**契約健康度**：必填 `prompt` 與 **16:9／9:16** 對齊良好；**1:1 非法 enum** 為中度風險（社群方形專案）。duration／resolution 刻意不暴露 → 點數與 base 價對齊，但使用者若以為「旗艦＝1080p」會誤判畫質（實際預設 540p）。`NEGATIVE_PROMPT_SUPPORTED`／`SEED_SUPPORTED` **刻意未收**本 id——與 OpenAPI 一致。

### 4.4 generationCore 路徑

- `model.input(positivePrompt, project.format, …)` → 上表 body  
- 世界觀禁忌：因 `supportsNegativePrompt===false`，**不會**附加 `negative_prompt`（禁忌僅能靠正向改寫／移出）  
- 扣點：`estimatePointsFor` → 扁平 16 → `reserveQuota`；失敗走退點交易路徑（全站共用）  
- endpoint：`endpointOf` = id → `falSubmit("fal-ai/luma-dream-machine/ray-2", …)`

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 points | **16**（亦由 `realPricePoints` 自 cost 覆寫一致） |
| 預估／扣點 | `estimatePoints` = 16；與 prompt 字數無關 |
| UI | 挑選器／配方／showdown 顯示與 `MODELS[].points` 同源 |
| 退點 | 生成失敗 terminal + 帳本退點；本回合**未**做 L5 真扣點 |
| BYOK | 若走使用者自備 key，點數實際可為 0（平台 key 才扣 est）— 通用規則 |
| 與官方 | base $0.5×31≈15.5 → **≈16**，**無需調點**（前提：維持預設 5s／540p） |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 莊嚴療癒空景（**有定裝／首格圖**） | △ 次選 | Recipe `sc-zen-broll` 首選是 **i2v** Ray-2，非本 t2v |
| 唯美療癒空鏡（**純文字、無圖**） | ✅ | showdown `sh-video` 軸「唯美療癒空鏡」**winner** 即本 id；bestFor 合理 |
| 電影感慢運鏡／抽象光影 | ✅ | strengths 對味；英文提示較穩（生態研究：英文主場） |
| 畫面內中文字 | ❌ | 影片族不渲染可靠中文字；字卡另做 |
| 要原生對白／BGM | ❌ | 本端點無原生音訊；需 MMAudio 等後製或改 Veo／有聲 t2v |
| 人物會演／情緒特寫 | △／❌ | 非 Luma 主場；見證請 Hailuo i2v |
| 社群 1:1 專案 | ⚠️ | 官方 **無 1:1**；可能失敗或需改 16:9／9:16 |
| 預算預覽 | 先 Flash 6 點 | 旗艦 16 點留給意境成片級（仍為 540p 預設） |
| 手動選模 | ✅ | category text-to-video，needs 無 |
| 助手／代理 | ✅ 可被選 | `verified:true` → operational ready；**recommended:false** 且 flagship 16 點，budget 偏好下分數低於經濟檔 |
| MCP | ✅ | `find_model` 可命中；`submit_generation` 帶 `modelId`+`prompt` 即可 |

**文案一致性**：strengths／bestFor 與 i2v 姊妹同調（唯美／療癒）——產品區分應是「有參考圖走 i2v 配方、無圖走本 t2v／showdown 軸」。cost 字串未寫 540p 預設與解析階梯——文件可補，非契約破。

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| MCP `find_model` | category=`text-to-video`、keyword「Luma／Ray／療癒／空鏡／運鏡」、tier=flagship、points=16 |
| MCP `submit_generation` | 建議 body：`projectId` + `modelId` + `prompt`；**勿**自拼 duration／resolution 除非同步改點數；**避免** project format=1:1 硬打本模 |
| 文件 | [fal 模型頁](https://fal.ai/models/fal-ai/luma-dream-machine/ray-2) |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/luma-dream-machine/ray-2` |
| 定價摘要 | base **$0.50 / 5s @ 540p**；9s 2×；720p 2×、1080p 4× |

**建議 MCP 形狀**：

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/luma-dream-machine/ray-2",
  "prompt": "Slow cinematic drone over a still lotus pond at golden hour, soft mist, gentle light rays through haze, serene temple silhouette in distance, elegant camera drift, natural physics, no text, no people"
}
```

## 8. 建議動作

- [x] **維持** points=16、cost 字串、verified=true、recommended=false（本回合不改碼）
- [ ] 調 points — **不需要**（base 5s／540p 校準 ≈）
- [ ] 修 input/id — **可選 P2**：`format===1:1` 時映射為官方允許比例（如 `16:9` 或拒絕並提示），避免非法 enum；**勿**在未動態估點前預設送 `1080p`／`9s`
- [ ] verified true — **已是 true**；本回合**禁止**改動 verified
- [ ] 下架或隱藏 — **否**
- [ ] cost 文案 — **P3**：補「540p 5s 基準；720p／1080p／9s 倍率更高」以免誤以為固定 $0.5 任意解析
- [ ] L1 有效 probe — 有 FAL_KEY 時對本 endpoint 空輸入 `{}` 應期望 **422 OK_VALIDATED**（勿 --yes 生成）
- [ ] L4 live — 控費單次：`npx tsx scripts/verify-models.ts --probe "fal-ai/luma-dream-machine/ray-2"` 估點後再人工 `--yes`（約 16 點／~$0.50 @ 預設）

**優先級（僅建議）**

| 級 | 項 |
|----|-----|
| P2 | 處理 `aspect_ratio: "1:1"` 非法 enum（映射或擋下） |
| P3 | cost／UI 註明預設 **540p／5s** 與解析／時長倍率；bestFor 可補「無參考圖時；有首格請用 i2v」 |
| P3 | 若產品要開 720p／1080p／9s：必須連動 `estimatePoints` 倍率，否則平台倒貼 |
| — | **不**納入 `NEGATIVE_PROMPT_SUPPORTED`／`SEED_SUPPORTED`（schema 無） |

## 9. 來源

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/luma-dream-machine/ray-2` → `LumaDreamMachineRay2Input`／Output 全表（含 duration／resolution 倍率說明）  
2. fal 公開定價摘要：base **$0.50／5s @ 540p**；9s 2×；720p 2×、1080p 4×（[模型頁](https://fal.ai/models/fal-ai/luma-dream-machine/ray-2)；本環境頁面 429，與 OpenAPI description 交叉）  
3. 站內：`shared/models.ts`（entry、`sc-zen-broll`、`sh-video` 唯美療癒空鏡 winner）  
4. `shared/models.ts` `parseRealCost`／`realPricePoints`、`docs/點數校準報告.md`（Luma Ray 2 列 ≈15.5）  
5. `shared/modelMechanics.ts`、`shared/textEncoders.ts`  
6. `server/services/generationCore.ts`（input／negative／quota）、`server/services/aiModelPolicy.ts`（operational ready）  
7. MCP：`server/services/mcp.ts`、`shared/mcpCatalog.ts`  
8. `docs/fal生態研究.md`、`docs/模型目錄.md`、`docs/fal端點連通報告.md`（環境性 TRANSIENT，僅作反證參考）  
9. 姊妹對照：`…/ray-2-flash`、`…/ray-2/image-to-video`、`…/ray-2/modify`（同家族定價／用途分化）  

---

**R3 checklist（#108）**

- [x] L0 靜態契約  
- [x] OpenAPI／定價研究（無 `--yes` live）  
- [x] 點數校準對照（含 720p／1080p／9s 低估風險註記）  
- [x] input vs schema 差異（1:1 非法；duration／resolution 預設）  
- [x] MCP／助手／情境交叉  
- [x] 九章卡 + `_index` #108 + heartbeat  
- [x] **未**改 verified／points；**未** live 扣費  
