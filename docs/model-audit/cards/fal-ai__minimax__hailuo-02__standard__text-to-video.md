# fal-ai/minimax/hailuo-02/standard/text-to-video

> 審計：R3 · index **#113** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__minimax__hailuo-02__standard__text-to-video`  
> 禁止改 `verified`／`points`（本卡僅建議）；**禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/minimax/hailuo-02/standard/text-to-video`（`endpointOf` 同字串，無 alias） |
| label | Hailuo 02 Standard |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points | **7** |
| cost（目錄） | `$0.045/秒(768p;Pro 1080p $0.08/秒);按秒計費,點數為 6 秒基準` |
| verified | **true**（既有；本回合**未**改碼、未觸 live。OpenAPI **200** 已證端點存在；出片仍缺 live） |
| needs | 無（純文生，無來源素材） |
| recommended | **false**（models-index） |
| strengths | 物理與指令遵循好;按秒計費透明 |
| bestFor | 中等預算的日常敘事鏡頭 |
| 供應商 | MiniMax **Hailuo-02 Standard（768p）** · fal 託管 queue |
| 姊妹（fal 存在／本目錄） | **Pro t2v** `…/hailuo-02/pro/text-to-video`（OpenAPI 200 · 1080p · **無** duration 欄 · **未**收錄 MODELS）；**Standard i2v**／**Pro i2v**（OpenAPI 200 · **未**收錄）；世代後繼 **Hailuo 2.3** Standard t2v（9 點／固定價敘事）與 Pro t2v（15 點） |

**一句話**：MiniMax **Hailuo-02 經濟 768p 文生影片**——按秒 **$0.045**、官方預設 **6s**；站內 **7 點**對齊機械 **5s×$0.045**（`PRICE_VIDEO_SECONDS`）。物理／指令遵循佳、中文提示理解優；**非**人物會演旗艦（旗艦見證已走 2.3 Pro i2v）。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **7** |
| cost（目錄） | `$0.045/秒(768p;Pro 1080p $0.08/秒);按秒計費,點數為 6 秒基準` |
| 官方價與單位（目錄＋fal 生態研究） | Standard **768p $0.045/秒**；Pro 1080p **$0.08/秒**（Pro **未**入本目錄） |
| 解析／`parseRealCost` | `usdMid: 0.045` · `multiplier: ×5`（`PRICE_VIDEO_SECONDS=5`）· unitNote「×5 秒（單鏡假設）」 |
| `realPricePoints`／覆寫 | `0.045 × 5 × 31 = 6.975` → **round 7**（與目錄／校準報告 **7.0 ≈** 一致） |
| `estimatePoints`（扁平） | **7**（與 prompt 長度無關；**不**隨 `duration` 變動） |
| 估值 NT$（假設 1 點≈NT$1） | **≈ NT$7.0** |
| 時長假設（站內實際送出） | 站內 **不送** `duration` → 吃 OpenAPI 預設 **`"6"`** 秒 |
| 校準判定 | 與 **5s@768p** 機械式 **≈**；與 cost「**6 秒基準**」及**官方 default 6s** **不一致**（見下） |

**階梯示意（$0.045/秒 × 秒 ×31；非站內扣點）**

| 設定 | 約 USD | 約 NT$（×31） | vs 固定 7 點 |
|------|--------|---------------|--------------|
| **5s · 768p**（`PRICE_VIDEO_SECONDS` 假設） | 0.225 | **~7.0** | **≈** |
| **6s · 768p**（OpenAPI **default**／cost「6 秒基準」） | 0.27 | **~8.4** | **輕度低估 ~1 點** |
| **10s · 768p**（enum 可選；站內**未**暴露） | 0.45 | **~14.0** | 低估 ~半（若未來開 UI） |
| Pro 1080p · 5s（姊妹未收錄） | 0.40 | ~12.4 | — |
| Pro 1080p · 6s | 0.48 | ~14.9 | — |

**文件債（cost 字串）**：寫「點數為 **6** 秒基準」但機械估點用 **5s**（0.045×5×31→7）；若真以 6s 為準應 ≈**8** 點。與 Veo Lite／Seedance 2.0 等同族「6 秒文案 vs 5 秒機械」債一致。

**對照家族**：Hailuo **2.3** Standard t2v 目錄 **9** 點（$0.28/6秒 級固定敘事）；本檔 **02** 按秒更透明、單鏡 6s 約 NT$8。人物旗艦見證配方走 **2.3 Pro i2v（15）**，不走本 t2v。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — `MODELS` 唯一 id、category∈CATEGORIES、必填欄齊（label/points/cost/tier/verified/strengths/bestFor/input）；`needs` 無；`endpointOf`=id |
| OpenAPI（研究） | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/minimax/hailuo-02/standard/text-to-video` · schema **`MinimaxHailuo02StandardTextToVideoInput`**／**`MinimaxHailuo02StandardTextToVideoOutput`** · `x-fal-metadata.endpointId` 同 id · category=`text-to-video` |
| dry-run probe | 本環境 **無 FAL_KEY**；`verify-models.ts --probe` 僅能估點路徑，**未**送 queue |
| 歷史連通 | `docs/fal生態研究.md` ✅已查證定價；`docs/fal端點連通報告.md` **無**本 id 專列（不可當 404） |
| playground／模型頁 | https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/text-to-video · API …/api（本環境 HTML **429**／Vercel checkpoint；OpenAPI 可讀） |
| live probe（L4） | **未跑**（R3 static+research；**禁止 `--yes`**） |
| 結論 | **ready-static-only** — 契約與官方 schema／base 定價一致、`verified` 已 true；扁平 7 vs 預設 6s 輕度低估；本回合無 live 出片 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **Queue**：`https://queue.fal.run` · paths 含 submit／status／cancel／result
- **required**：僅 `prompt`
- **properties**（`x-fal-order-properties`）：
  - `prompt` — string，minLength 1，**maxLength 2000**（example：Galactic Smuggler 長敘事）
  - `duration` — enum **`"6"`｜`"10"`**，default **`"6"`**；說明：*10 seconds videos are not supported for 1080p*（本 Standard 固定 768p，10s 可用）
  - `prompt_optimizer` — boolean，**default true**
- **Output**：`video`（File，含 url）— required
- **無**：`aspect_ratio`／`resolution`／`seed`／`negative_prompt`／`image_url`／`generate_audio`
- **about**：*MiniMax Hailuo-02 Text To Video API (Standard, 768p): Advanced video generation model with 768p resolution*

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| `modelMechanicsFor` | **family: `dit`** ·「時序 DiT（Diffusion Transformer）」— path 命中 `minimax` 正則 |
| 文字塔 | `textEncoderProfileFor` → **`video-closed`**（閉源未公開窗口；不可量 token） |
| 條件／時間 | 潛空間 patch + 時序一致性；家族行銷強項偏物理／指令遵循（異於 2.3「人物會演」主打） |
| 輸出 | OpenAPI：`video`（File） |

### 4.2 站內 `input()` vs 官方

站內（`shared/models.ts` 約 L1149）：

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
| `aspect_ratio` | ✅ 每請求送 | ❌ 無此欄 | **死欄／被忽略風險**；外部敘事 T2V 多預設橫幅 16:9 級 |
| `duration` | ❌ 不送 | 預設 **`"6"`** | 與扁平 5s 估點脫鉤（**輕度**）；**未**暴露 10s |
| `prompt_optimizer` | ❌ 不送 | 預設 true | 吃官方預設（正確可不強送） |
| `resolution` | ❌ | schema **無**（about 固定 768p） | 勿誤以為可開 1080p（那是 Pro 端點） |
| `negative_prompt` | 不注入（不在 allowlist） | schema 無 | **正確不送** |
| `seed` | 不送（不在 SEED_SUPPORTED） | schema 無 | 消融無法鎖噪聲 |

**契約健康度**：必填 `prompt` 對齊；多送 `aspect_ratio` 為**輕度落差**（多數 fal 忽略未知欄，但專案 format 無法保證影響畫幅）。`NEGATIVE_PROMPT_SUPPORTED`／`SEED_SUPPORTED` **刻意未收**——與 OpenAPI 一致。估點 vs 預設 6s 為**輕度**平台風險（非 Veo Lite 級嚴重）。

### 4.3 generationCore 路徑

```
estimatePoints → 7（扁平；非 TTS 動態）
→ reserveQuota(7)
→ falSubmit("fal-ai/minimax/hailuo-02/standard/text-to-video", { prompt, aspect_ratio })
→ 失敗 refund(7)
→ 供應商按秒計費；預設 6s ≈$0.27（平台收 ~7 點／~$0.23 假設 1 點≈NT$1 對美）
```

- 世界觀禁忌：`supportsNegativePrompt===false` → **不會**附加 `negative_prompt`（禁忌僅能靠正向改寫／移出）  
- seed：schema 無 → 消融無法鎖噪聲  
- BYOK：自備 key 時點數實際可為 0（平台 key 才扣 est）— 通用規則

### 4.4 與姊妹對照

| | **02 Standard t2v（本 #113）** | 02 Pro t2v（未收錄） | 2.3 Standard t2v（#102） | 2.3 Pro t2v（#107） |
|--|-------------------------------|----------------------|--------------------------|---------------------|
| 解析 | **768p** 固定 | **1080p** | 多為 768p 固定價敘事 | 1080p 固定價 |
| duration | **6／10**（default 6） | schema **無** duration | OpenAPI 亦 6／10 | schema **無** duration |
| 計價 | **$0.045/秒** | **$0.08/秒** | 目錄 9 點級固定 | **$0.49/支** → 15 點 |
| aspect | schema 無 | schema 無 | 同 | 同 |
| 站內 | ✅ 已收 | ❌ | ✅ | ✅ |

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 points | **7** |
| 預估／扣點 | `estimatePoints` = 7；與 prompt 字數無關 |
| UI | 挑選器／配方顯示與 `MODELS[].points` 同源 |
| 退點 | 生成失敗 terminal + 帳本退點（generationCore 交易路徑）；本回合**未**做 L5 真扣點 |
| BYOK | 通用：自備 key 可不扣平台點 |
| 與官方 | 5s 機械 **≈**；**default 6s** 時平台約**倒貼 ~1 點**；10s 若裸開則嚴重低估（現 UI 不送 duration → 不觸 10s） |
| 建議 | 本回合 **維持 7**；可選後續：cost 改「約 5 秒@768p」或改 6s 基準並調至 **8**；或明送 `duration:"6"` 並動態估點 |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 中等預算日常敘事／場景片 | ✅ | bestFor 合理；按秒透明好算帳 |
| 物理／動作指令遵循 | ✅ | strengths 主軸 |
| 見證人物情緒特寫（有定裝圖） | ❌ 勿當首選 | Recipe／showdown 走 **2.3 Pro i2v** |
| 純文字、要「會演」旗艦 | △ | 可試，但 2.3 Pro t2v／i2v 更新世代 |
| 畫面內中文字 | ❌ | 影片族不渲染可靠中文字；字卡另做 |
| 原生對白／BGM | ❌ | schema 無音訊；需後製 |
| 精確運鏡指令 | △ | 前代 Video-01 Director（#114）更偏運鏡；本檔偏物理／敘事 |
| 10 秒長鏡 | △ 官方可、站內未暴露 | 開 UI 前必須聯動估點（≈14） |
| 1080p 成片 | ❌ 本端點 | 用未收錄 Pro 或 2.3 Pro |
| 手動選模 | ✅ | category text-to-video，needs 無 |
| 助手／代理 | ✅ 可被選 | `verified:true` → operational ready；**recommended:false** + economy 7 點，budget 偏好下可競爭 |
| MCP | ✅ | `find_model` 可命中；`submit_generation` 帶 modelId+prompt 即可 |

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| MCP `find_model` | category=`text-to-video`、keyword「Hailuo／02／物理」、tier=economy、points=7 |
| MCP `submit_generation` | 建議 body 僅 `projectId` + `modelId` + `prompt`；**勿**自拼 `aspect_ratio` 當硬規格、勿送 negative/seed；若要 10s 須產品先估點再送 `duration` |
| 文件 | [fal 模型頁](https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/text-to-video) |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/minimax/hailuo-02/standard/text-to-video` |
| 定價摘要 | Standard 768p **$0.045/秒**；Pro 1080p $0.08/秒（生態研究已查證） |

**建議 MCP 形狀**：

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/minimax/hailuo-02/standard/text-to-video",
  "prompt": "清晨市場小巷，推車緩行，水氣與光塵，固定機位中景，寫實，無字幕"
}
```

## 8. 建議動作

- [x] **維持** points=7、cost 字串、verified=true、recommended=false（本回合不改碼）
- [ ] 調 points — **本回合不需要**（5s 機械 ≈）；若改以官方 default 6s 為準再考慮 **7→8**
- [ ] 修 input/id — **可選 P2**：`input()` 停止送 `aspect_ratio`（OpenAPI 無此欄），改只送 `{ prompt }`；或 live 確認未知欄被忽略後維持並在 UI 註「本模畫幅固定」
- [ ] verified true — **已是 true**；本回合**禁止**改動 verified
- [ ] 下架或隱藏 — **否**
- [ ] L1 有效 probe — 有 FAL_KEY 時對本 endpoint 空輸入 `{}` 應期望 **422 OK_VALIDATED**（勿 --yes 生成）
- [ ] L4 live — 控費單次：先估點再人工 `--yes`（約 7 點目錄／實費可能 ≈6s×$0.045）

**優先級（僅建議）**

| 級 | 項 |
|----|-----|
| P1 | 文件／估點對齊：cost「6 秒基準」vs `PRICE_VIDEO_SECONDS=5` vs 官方 default **6**；擇一寫清或改 8 點／明送 duration |
| P2 | 移除或條件化 `aspect_ratio` 死欄；UI 註固定 768p／預設橫幅 |
| P2 | 若產品要開 **10s**：必須聯動 `estimatePoints`（≈14）與 UI 標價 |
| P3 | 評估是否收錄 **Pro t2v**／**Standard i2v**（fal 已通）作為 1080p／有參考圖路徑 |
| — | **不**納入 `NEGATIVE_PROMPT_SUPPORTED`／`SEED_SUPPORTED`（schema 無） |

## 9. 來源

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/minimax/hailuo-02/standard/text-to-video` → `MinimaxHailuo02StandardTextToVideoInput`／Output 全表  
2. 姊妹 OpenAPI 抽樣：`…/hailuo-02/pro/text-to-video`（prompt+optimizer，無 duration）；`…/standard/image-to-video`（prompt+image_url+duration 6/10+resolution 512P/768P）；`hailuo-2.3/standard/text-to-video`（duration 6/10）  
3. 站內：`shared/models.ts`（entry L1149 附近）、`shared/money.ts`、`USD_TO_TWD=31`、`PRICE_VIDEO_SECONDS=5`  
4. `docs/點數校準報告.md`（Hailuo 02 Standard 列 7.0 ≈）  
5. `shared/modelMechanics.ts`、`shared/textEncoders.ts`（dit／video-closed）  
6. `server/services/generationCore.ts`（input／negative／quota）、`server/services/aiModelPolicy.ts`  
7. MCP：`server/services/mcp.ts`、`shared/mcpCatalog.ts`  
8. `docs/fal生態研究.md`（$0.045/秒 768p 已查證）、`docs/模型目錄.md`  
9. 模型頁 HTML 本環境 429 — 定價以目錄＋生態研究＋校準報告交叉；OpenAPI about 確認 768p Standard  

---

**R3 checklist（#113）**

- [x] L0 靜態契約  
- [x] OpenAPI／定價研究（無 `--yes` live）  
- [x] 點數校準對照（5s ≈7；default 6s ~8.4）  
- [x] input vs schema 差異（aspect_ratio 死欄；duration 未送）  
- [x] MCP／助手／情境交叉  
- [x] 九章卡 + `_index` #113 + heartbeat  
- [x] **未**改 verified／points；**未** live 扣費  
