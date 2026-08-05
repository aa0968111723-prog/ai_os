# fal-ai/minimax/hailuo-2.3/pro/text-to-video

> 審計：R3 · index **#107** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__minimax__hailuo-2.3__pro__text-to-video`

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/minimax/hailuo-2.3/pro/text-to-video`（`endpointOf` 同字串，無 alias） |
| label | Hailuo 2.3 Pro |
| category / kind | **text-to-video** · video |
| tier | **flagship** |
| points | **15** |
| cost（目錄） | `$0.49/支(1080p)` |
| verified | **true**（既有；本回合**未**改碼、未觸 live） |
| needs | 無（純文生，無來源素材） |
| recommended | **false** |
| strengths | 人物表演與情緒張力最強;比 Veo/Kling 更會演 |
| bestFor | 見證故事人物特寫、情緒鏡頭 |
| 供應商 | MiniMax Hailuo-2.3 **Pro**（1080p）· fal 託管 queue |
| 姊妹 | Standard t2v `…/standard/text-to-video`（9 點／768p）；Pro **i2v** `…/pro/image-to-video`（同價 15 點，見證配方首選） |

**一句話**：MiniMax 人物表演旗艦的 **文生影片** 1080p 固定價檔——無分鏡圖時的情緒特寫備援；站內「見證會演」主路徑已改走 **同家族 i2v**。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **15** |
| cost（目錄） | `$0.49/支(1080p)` |
| 官方價與單位（fal／第三方交叉） | **$0.49 per video generation**（1080p；按**次**計費，非 /秒） |
| 解析／`parseRealCost` | `usdMid: 0.49` · `multiplier: ×1（每次一件）` |
| `usdUnitToPoints(0.49)` · `USD_TO_TWD=31` | `0.49 × 31 ≈ 15.19` → **round 15** |
| `estimatePoints`（扁平） | **15**（與 prompt 長度無關） |
| 估值 NT$（假設 1 點≈NT$1） | **≈ NT$15.2**（校準報告 15.2） |
| 時長假設 | OpenAPI **無** `duration`；外部敘事多指約 **6s** 級固定支；Pro 頁未像 Standard 寫 6/10 秒雙檔 |
| 校準判定 | **≈**（點數與官方單次價對齊） |

**對照**：Standard t2v `$0.28/6秒(768p)` → 9 點；本檔 Pro 1080p 固定 $0.49 → 15 點，旗艦溢價合理。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — `MODELS` 唯一 id、category∈CATEGORIES、必填欄齊（label/points/cost/tier/verified/strengths/bestFor/input） |
| OpenAPI（研究） | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/minimax/hailuo-2.3/pro/text-to-video` · schema `MinimaxHailuo23ProTextToVideoInput` |
| dry-run probe | 本環境 **無 FAL_KEY**；`verify-models.ts --probe` 僅能估點路徑，**未**送 queue |
| 歷史空輸入 probe 報告 | `docs/fal端點連通報告.md` 本端點列 **⏳ TRANSIENT**——但同檔 **252/252 皆暫時性**（環境性失效，**不可**當單模 404/連通結論） |
| live probe（L4） | **未跑**（R3 本回合 static+research；禁止 `--yes`） |
| playground／模型頁 | `https://fal.ai/models/fal-ai/minimax/hailuo-2.3/pro/text-to-video`（本環境 HTML 429；OpenAPI 與公開摘要已交叉） |
| 結論 | **ready-static-only** — 契約與官方 schema／定價一致、`verified` 已 true；本回合無有效 L1 HTTP 驗證與 live 出片 |

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| `modelMechanicsFor` | **family: `dit`** ·「時序 DiT（Diffusion Transformer）」— minimax 正則命中影片族 |
| 文字塔 | `textEncoderProfileFor` → **`video-closed`**（閉源未公開窗口；不可量 token） |
| 條件／時間 | 潛空間 patch + 時序一致性；人物微表情／情緒為家族行銷強項（FAC-Net 等公開敘事） |
| 輸出 | OpenAPI：`video`（File，含 url） |

### 4.2 官方 OpenAPI 摘要（2026-08-05 拉取）

- **Queue**: `https://queue.fal.run`
- **required**: 僅 `prompt`（minLength 1，**maxLength 2000**）
- **properties**:
  - `prompt` — string，文生影片提示
  - `prompt_optimizer` — boolean，**default true**（模型側提示優化）
- **x-fal-order-properties**: `prompt`, `prompt_optimizer`
- **Output**: `video`（required）
- **無**：`aspect_ratio` / `duration` / `resolution` / `seed` / `negative_prompt` / `image_url`

### 4.3 站內 `input()` vs 官方

站內（`shared/models.ts`）：

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) })
// aspect = (f) => f  → 送出 "16:9" | "9:16" | "1:1"
```

三比例快照：

| format | 站內 body | OpenAPI |
|--------|-----------|---------|
| `16:9` | `{ prompt, aspect_ratio: "16:9" }` | `prompt` ✅；**`aspect_ratio` 不在 schema** |
| `9:16` | `{ prompt, aspect_ratio: "9:16" }` | 同上 |
| `1:1` | `{ prompt, aspect_ratio: "1:1" }` | 同上 |

| 能力 | 站內 | 官方 | 備註 |
|------|------|------|------|
| `prompt` | ✅ 必送 | ✅ required ≤2000 | 過長應在 UI／注入前截斷（站內未專屬 cap） |
| `aspect_ratio` | ✅ 每請求送 | ❌ 無此欄 | **死欄／被忽略風險**；外部文稱 T2V 常預設 16:9 |
| `prompt_optimizer` | ❌ 不送 | 預設 true | 吃官方預設 |
| `duration` | ❌ | ❌（本 Pro 端點） | 與 hailuo-02 standard 有 `6`/`10` 不同 |
| `negative_prompt` | 不注入（不在 allowlist） | schema 無 | **正確不送**（誤送恐 422） |
| `seed` | 不送（不在 SEED_SUPPORTED） | schema 無 | 消融無法鎖噪聲 |

**契約健康度**：必填 `prompt` 對齊；多送 `aspect_ratio` 為**輕度落差**（多數 fal 端點忽略未知欄，但專案格式無法保證影響出片畫幅）。`NEGATIVE_PROMPT_SUPPORTED` / `SEED_SUPPORTED` **刻意未收**本 id——與 OpenAPI 一致，屬正確保守。

### 4.4 generationCore 路徑

- `model.input(positivePrompt, project.format, …)` → 上表 body  
- 世界觀禁忌：因 `supportsNegativePrompt===false`，**不會**附加 `negative_prompt`（禁忌僅能靠正向改寫／移出）  
- 扣點：`estimatePointsFor` → 扁平 15 → `reserveQuota`；失敗走退點交易路徑（全站共用）

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 points | **15** |
| 預估／扣點 | `estimatePoints` = 15；與 prompt 字數無關（非 /秒、非 /token） |
| UI | 挑選器／配方顯示與 `MODELS[].points` 同源 |
| 退點 | 生成失敗 terminal + 帳本退點（generationCore 交易路徑）；本回合**未**做 L5 真扣點 |
| BYOK | 若走使用者自備 key，點數實際可為 0（平台 key 才扣 est）— 通用規則，非本模特例 |
| 與官方 | $0.49×31≈15.2 → **≈**，**無需調點** |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 見證人物情緒特寫（**有定裝／分鏡圖**） | △ 次選 | Recipe `sc-witness-emotion` / showdown「人物會演」winner 是 **i2v** Pro，非本 t2v |
| 見證／情緒（**純文字、無圖**） | ✅ | bestFor 合理；中文提示理解佳（MiniMax 華語系） |
| 畫面內中文字 | ❌ | 影片族不渲染可靠中文字；字卡另做 |
| 要原生對白／BGM | ❌ | 本端點無原生音訊敘事；需 MMAudio 等後製 |
| 運鏡精確導演指令 | △ | 前代 Video-01 Director 更偏運鏡指令；本檔偏表演 |
| 預算預覽 | 先 Standard 9 點 | Pro 15 點留給成片級 1080p |
| 手動選模 | ✅ | category text-to-video，needs 無 |
| 助手／代理 | ✅ 可被選 | `verified:true` → `modelIsOperationallyReady`；但 **recommended:false** 且 flagship 15 點，在 budget／balanced 偏好下分數低於經濟檔（如 Wan） |
| MCP | ✅ | `find_model` 可命中；`submit_generation` 帶 `modelId`+`prompt` 即可 |

**文案一致性**：strengths／bestFor 與 i2v 姊妹高度同文——產品上正確區分應是「有參考圖走 i2v、無圖走 t2v」；指南補遺已把見證配方第 2 替代從本 t2v 改為 Kling i2v，避免冗餘。

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| MCP `find_model` | category=`text-to-video`、keyword「Hailuo／人物／情緒」、tier=flagship、points=15 |
| MCP `submit_generation` | 建議 body 僅 `projectId` + `modelId` + `prompt`；**勿**自拼 `aspect_ratio` 當硬規格、勿送 negative/seed/duration |
| 文件 | [fal 模型頁](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/pro/text-to-video) |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/minimax/hailuo-2.3/pro/text-to-video` |
| 定價摘要 | fal 公開文案：**$0.49 per video generation**（1080p） |

**建議 MCP 形狀**：

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/minimax/hailuo-2.3/pro/text-to-video",
  "prompt": "中年女性特寫，眼眶微紅卻帶微笑，慢速推近，柔光，莊重見證感，無字幕"
}
```

## 8. 建議動作

- [x] **維持** points=15、cost 字串、verified=true、recommended=false（本回合不改碼）
- [ ] 調 points — **不需要**（校準 ≈）
- [ ] 修 input/id — **可選 P2**：`input()` 停止送 `aspect_ratio`（OpenAPI 無此欄），改只送 `{ prompt }`；或 live 確認未知欄被忽略後維持現狀並在 UI 註「本模畫幅固定」
- [ ] verified true — **已是 true**；本回合**禁止**改動 verified
- [ ] 下架或隱藏 — **否**
- [ ] L1 有效 probe — 有 FAL_KEY 時對本 endpoint 空輸入 `{}` 應期望 **422 OK_VALIDATED**（勿 --yes 生成）
- [ ] L4 live — 控費單次：`npx tsx scripts/verify-models.ts --probe "fal-ai/minimax/hailuo-2.3/pro/text-to-video"` 估點後再人工 `--yes`（約 15 點／~$0.49）

**優先級（僅建議）**

| 級 | 項 |
|----|-----|
| P2 | 移除或條件化 `aspect_ratio` 死欄；文件註明固定 1080p／預設橫幅 |
| P3 | bestFor 補一句「無參考圖時；有分鏡圖請用 Pro 圖生」以免與 i2v 配方混淆 |
| — | **不**納入 `NEGATIVE_PROMPT_SUPPORTED`／`SEED_SUPPORTED`（schema 無） |

## 9. 來源

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/minimax/hailuo-2.3/pro/text-to-video` → `MinimaxHailuo23ProTextToVideoInput`／Output 全表  
2. fal 公開定價摘要：$0.49／次（[模型頁](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/pro/text-to-video)）；第三方交叉（fal learn／評測文 2026）  
3. 站內：`shared/models.ts`（entry #1107 附近、`sc-witness-emotion`、showdown 人物會演）  
4. `shared/money.ts`、`docs/點數校準報告.md`（Hailuo 2.3 Pro 列 ≈15.2）  
5. `shared/modelMechanics.ts`、`shared/textEncoders.ts`  
6. `server/services/generationCore.ts`（input／negative／quota）、`server/services/aiModelPolicy.ts`（operational ready）  
7. MCP：`server/services/mcp.ts`、`shared/mcpCatalog.ts`  
8. `docs/fal生態研究.md`、`docs/模型指南研究補遺.md`、`docs/fal端點連通報告.md`（環境性 TRANSIENT，僅作反證參考）  
9. 姊妹 OpenAPI 抽樣：`…/pro/image-to-video`（prompt+image_url+optimizer）；`hailuo-02/standard/text-to-video`（另有 duration 6/10）  

---

**R3 checklist（#107）**

- [x] L0 靜態契約  
- [x] OpenAPI／定價研究（無 `--yes` live）  
- [x] 點數校準對照  
- [x] input vs schema 差異（aspect_ratio）  
- [x] MCP／助手／情境交叉  
- [x] 九章卡 + `_index` #107 + heartbeat  
- [x] **未**改 verified／points；**未** live 扣費  
