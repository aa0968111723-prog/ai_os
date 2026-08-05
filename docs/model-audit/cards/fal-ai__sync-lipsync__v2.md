# fal-ai/sync-lipsync/v2

> 審計：R4 · index **#162** · static+research · **零 live** · 2026-08-05  
> slug：`fal-ai__sync-lipsync__v2` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id / endpoint | `fal-ai/sync-lipsync/v2`（`endpointOf` = id，無 alias） |
| label | Lipsync v2 對嘴(標準) |
| category | `video-to-video`（影片轉影片） |
| tier | **flagship** |
| kind | `video` |
| points | **93** |
| cost | `$3/分;按影片長度計費,點數以 1 分鐘短片估,較長影片實際費用更高` |
| verified | **false** |
| recommended | **false** |
| needs | **video**（人物影片網址） |
| secondaryNeeds | **audio**（配音／替換音訊） |
| sourceHint | 要對嘴的人物影片 |
| secondarySourceHint | 要套用的配音音訊 |
| strengths | 新一代對嘴標準版;品質接近 Pro 省 4 成 |
| bestFor | 多語版開示的日常出片 |
| 供應商／底層 | **Sync Labs Lipsync 2.0（lipsync-2）** via fal.ai（group `sync-lipsync` / Lipsync 2.0） |
| 角色定位 | 對嘴家族 **日常出片主力（標準檔）**；`sc-lipsync` pickIds **第二順位**（v3 之後） |

**一句話**：音訊驅動人物口型（video+audio → video）；$3/分標準檔，品質接近 Pro（$5）省約 40%，適合多語開示日常量。

**L0 靜態契約：** **ok**  
- 必填欄齊；`category ∈ CATEGORIES`；id 唯一；`input` 可呼叫。  
- 雙來源：`needs=video` + `secondaryNeeds=audio` 與官方 required 對齊。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **93** |
| cost 字串 | **$3/分**；按影片長度；1 分鐘短片估 |
| 官方價（fal 模型頁摘要） | **$3 per minute of video**（standard `lipsync-2`）；Pro 變體 **$5/分**（約 1.67×） |
| 計費性質 | **按處理影片分鐘**（per-minute of video）；與影音長度／`sync_mode` 處理相關 |
| `parseRealCost` | 解析 cost 得 **usdMid=3**、multiplier=**1**（`PRICE_V2V_MINUTES=1`）→ 期望 **93** 點 |
| 匯率 | USD×**31** ≈ NT$（與審計／校準同基準） |
| 校準報告列 | Lipsync v2 標準 ⚠︎ · 93 · 判定 **≈** |

### 2.1 粗估（1 分鐘基準）

| 假設單價 | USD/分 | 約 NT$ | 對齊 points |
|----------|--------|--------|-------------|
| **fal 標準 lipsync-2 $3** | 3 | 93 | **93**（現況＝官方） |
| 同端點若選 lipsync-2-pro | 5 | 155 | 站內 **不傳 model**→預設 lipsync-2；Pro 另有獨立 id `…/v2/pro` |
| 相對 v2 Pro（$5→155） | — | — | 標準省 **40%**（3/5） |
| 相對 v3（官方 $8→應 248） | — | — | 日常檔遠低於旗艦天花板 |
| 相對 1.9（$0.7→22） | — | — | 品質階梯換成本 |

| 時長 | 真實成本 @$3 | 站內固定 93 點 |
|------|--------------|----------------|
| 30s | $1.5 ≈ NT$46.5 | 偏貴緩衝 |
| **1 min** | $3 ≈ NT$93 | **對齊** |
| 2 min | $6 ≈ NT$186 | **偏低**（固定點） |
| 5 min | $15 ≈ NT$465 | 長片倒掛 |

**結論（L2）：** 目錄 cost **$3/分** 與 fal 明文 **$3/分（lipsync-2）** 一致；points=93＝`round(3×31×1)`，**1 分鐘基準無需調價**。長片固定扣點仍低估——文案已寫「較長影片實際費用更高」，產品誠實度 OK；可選 follow-up 做時長 `estimatePoints`（另案，非本卡必改）。

**本回合禁止改 `models.ts` 的 points／verified**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — id／category／needs／secondaryNeeds／`input(s,s2)→{video_url,audio_url}` |
| OpenAPI Queue | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/sync-lipsync/v2` · openapi **3.0.4** |
| 平台 metadata | **HTTP 200** · `api.fal.ai/v1/models?endpoint_id=…` · status **active** · display_name **Sync Lipsync 2.0** · tags `animation,lip sync` · license **commercial** · updated **2026-06-26** · group **sync-lipsync / Lipsync 2.0** · about「Lipsync Request V2」 |
| 模型頁定價摘要 | **$3/分**（standard）；Pro 變體 $5/分 · 1.67× |
| dry-run probe | `verify-models.ts --probe "fal-ai/sync-lipsync/v2"` → **拒探**：「需要來源輸入(影片)…請在站內以素材實測」（符合 needs 鐵律） |
| L1 空 `{}` --yes | **未跑**（零 live；**禁止 --yes**） |
| L2 live 生成 | **未跑**（需 video+audio 素材；單次 1 分 @$3 約 NT$93 級） |
| 結論 | **ready-static-only**（契約＋OpenAPI＋active＋價對齊；待素材 live 後可升 ready／verified） |

**歷史：** `docs/fal端點連通報告.md` 曾標 v2 暫時性 5xx／逾時——屬當時 probe 環境，**本回合 schema 200 + status active** 不支持「端點已死」。

---

## 4. 底層邏輯

### 4.1 能力（公開資料）

- **Sync Labs Lipsync 2.0**：frame-accurate 音訊→口型同步；任意音訊來源＋既有人物影片。  
- 輸入：人物影片 + 任意語言配音 → 口型對齊輸出（語言無關）。  
- 雙檔位：同一 OpenAPI 可選 `model=lipsync-2`（預設）或 `lipsync-2-pro`（約 1.67× 價、近景細節）；站內則拆成 **本 id（標準）** 與 **`fal-ai/sync-lipsync/v2/pro`（Pro）**。  
- 站內定位：多語開示**日常出片**；較 v3 便宜、較 1.9／MuseTalk 品質階梯更高。

### 4.2 站內 input 組裝

```ts
// shared/models.ts
input: (_p, _f, s, s2) => ({ video_url: s, audio_url: s2 })
```

| 行為 | 說明 |
|------|------|
| prompt / format | **忽略**（對嘴不吃文生提示與比例） |
| 來源 1 | `s` → **`video_url`** |
| 來源 2 | `s2` → **`audio_url`** |
| 可選旋鈕 | 站內 **不暴露** `model`／`sync_mode`（吃官方預設：`lipsync-2` + `cut_off`） |

`prepareGenerationRequest`：缺 `needs` 或 `secondaryNeeds` 分別 BAD_REQUEST（「此模型需要來源…」「還需要第二來源…」）。

### 4.3 官方 OpenAPI `SyncLipsyncV2Input` 對照

| Property | 約束 | Required | Default | 站內 | 備註 |
|----------|------|----------|---------|------|------|
| `video_url` | string | **是** | — | ✅ | 一致 |
| `audio_url` | string | **是** | — | ✅ | 一致 |
| `model` | enum：`lipsync-2`／`lipsync-2-pro` | 否 | **lipsync-2** | ❌ 預設 | Pro 約 **1.67×** 價；站內另有 `/v2/pro` 端點 |
| `sync_mode` | enum：`cut_off`／`loop`／`bounce`／`silence`／`remap` | 否 | **cut_off** | ❌ 預設 | 影音時長不一致策略 |

**Output `SyncLipsyncV2Output`：** required `video`（`File`：url／content_type／file_name／file_size）。

**Queue：** `https://queue.fal.run` · paths `/fal-ai/sync-lipsync/v2`（POST）+ status／cancel／result。

### 4.4 與官方差異／風險

1. **定價（1 分鐘基準）：** 站內 $3／93 點 vs fal **$3/分** → **對齊**，無需調 points。  
2. **未暴露 `sync_mode`：** 預設 `cut_off` 裁較長端；長旁白配短片可能不如預期。  
3. **未暴露 `model`：** 預設 `lipsync-2`——正確；若有人經 raw API 傳 `lipsync-2-pro` 會被收 $5/分但站內仍扣 93 點——**站內路徑不傳 model，風險低**；Pro 應走 `…/v2/pro`。  
4. **prompt 在 MCP 路徑：** 部分工具 schema 要 prompt，本模 input 丟棄——可填佔位。  
5. **`verified=false`：** `modelIsOperationallyReady` 否 → 助手 requireVerified 時不會自動選；**`sc-lipsync` 仍列第二**——手動／情境卡可選。  
6. **家族階梯：** 1.9（22／$0.7）→ **v2 標準（93／$3）** → v2 Pro（155／$5，verified）→ v3（目錄 155 但官方 $8，見 #161）→ MuseTalk 保守／VEED 低價。

### 4.5 分詞／文字塔

不適用（無 T5／CLIP 條件）。世界觀／卡片注入：對嘴類不依 prompt，卡片錨點不影響口型。

---

## 5. 站內點數

| 項目 | 說明 |
|------|------|
| 估點 | 扁平 **points=93**（無 `estimatePoints` 時長係數） |
| 扣點 | `reserveQuota(…, est)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／回收 `refund`；與 est 對稱 |
| UI | 模型卡顯示 93；cost 文案提示長片更貴 |
| 與官方 | 官方 **$3/分** 浮動；站內固定 93 ≈ **1 分鐘基準對齊**；**≥2 分平台吃虧** |
| 本回合 | **未改 points**；未跑真扣點 e2e |

**建議（可選 follow-up，非本卡必改）：**  
1. **維持** points=93、cost=`$3/分;…`（已正確）。  
2. 可選：長片 `estimatePoints` 依秒數線性——與全家族 v2v 對嘴另案。  
3. 勿在本 id 默許 `model=lipsync-2-pro`（Pro 走獨立條目）。

---

## 6. 情境與可用性

| 情境 | 適配 | 原因 |
|------|------|------|
| 多語版開示日常出片 | ✅ 主場 | bestFor；品質接近 Pro、省 4 成 |
| 近景高規／牙齒細節極致 | △ | 改 **v2 Pro** 或 **v3** |
| 對外正式天花板自然度 | △／❌ | 用 **v3**（更貴） |
| 量大試跑／成本優先 | △ | 1.9（22）或 VEED／MuseTalk 更省 |
| 師父影像「只改嘴、少動臉」 | △ | `sc-lipsync` why 指向 **MuseTalk** 保守型 |
| 無片源／無音訊 | ❌ | needs+secondaryNeeds 雙攔截 |
| 純文生影 | ❌ | 非 t2v |
| 助手自動挑選（requireVerified） | ❌ | verified=false |
| 手動選模／情境卡 `sc-lipsync` | ✅ 可選 | pickIds 第二；UI 雙來源提示 |

**可用性／文案（L6）**

- sourceHint／secondarySourceHint 清楚。  
- strengths／bestFor 與 fal 生態研究一致（標準版、省 Pro 四成）。  
- cost／points 與 $3 對齊——**無需改價文案**。  
- 目錄標 ⚠︎（未 verified）合理，待 live。

---

## 7. MCP / 文件

| 項目 | 結果 |
|------|------|
| MCP `find_model` | 目錄同源；關鍵詞「對嘴／lipsync／v2／標準」可命中 |
| MCP `submit_generation` | 可調；**必須** `source_url`（影片）+ 第二來源音訊；與網頁同 `executeGenerationCommand` |
| MCP 火力 | 同站內：僅 `video_url`+`audio_url`；無 `model`／`sync_mode` |
| Playground | https://fal.ai/models/fal-ai/sync-lipsync/v2 |
| API 文件 | https://fal.ai/models/fal-ai/sync-lipsync/v2/api |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/sync-lipsync/v2 |
| 本回合 HTTP | OpenAPI **200**；metadata **200 active**；定價摘要 **$3/分** |

---

## 8. 建議動作

- [x] **維持 points／cost** — **93** 與官方 **$3/分**×31×1 分鐘一致；無需調價  
- [x] **維持 id／endpoint／category／needs／secondaryNeeds／input** — 與 OpenAPI required 一致  
- [ ] **修 input 可選 P2** — 暴露 `sync_mode`（影音不等長）；**不要**在本 id 暴露 `model=pro`（Pro 走 `…/v2/pro`）  
- [ ] **verified true** — **勿擅自改**；待 L4 站內 video+audio 素材 live 成功後人工開  
- [ ] **下架或隱藏** — **否**；端點 active，日常對嘴檔位清楚  
- [ ] **文案** — 可選補「較 v2 Pro 省約 40%；較 v3 便宜」；非阻塞  
- [ ] **Live 佇列（可選，控費）** — 最短片源＋短音訊；估 **≥ NT$ 數十～93／分**；**禁止本回合 --yes**

**總建議標籤（寫入 _index）：** `維持`（$3/分＝93 已對齊；ready-static-only；live 後 verified）

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄 OpenAPI | 未跑 | **維持**（結構＋定價對齊） |

---

## 9. 來源

1. `shared/models.ts` — `fal-ai/sync-lipsync/v2`（~1549–1555）、家族 v2/pro／v3／1.9、`sc-lipsync`、`parseRealCost`／`PRICE_V2V_MINUTES`  
2. `docs/model-audit/models-index.json` — index **162**  
3. `docs/fal生態研究.md` — Sync Lipsync 2.0 標準 **$3/分** 已查證  
4. `docs/點數校準報告.md` — Lipsync v2 標準 93／≈  
5. `docs/模型目錄.md`／`docs/模型清查清單.md` — ⚠︎ 未驗證  
6. fal OpenAPI（本回合 curl **200**）— `SyncLipsyncV2Input`／`Output`（`model`、`sync_mode`、required video+audio）  
7. fal metadata API — status **active**、display_name Sync Lipsync 2.0  
8. fal 模型頁搜尋摘要 — **$3 per minute**（standard）；Pro **$5/分** 1.67×  
9. `scripts/verify-models.ts --probe`（**無 --yes**）— needs 拒探  
10. `server/services/generationCore.ts`／`aiModelPolicy.ts` — 雙來源攔截、operational ready  
11. 同家族卡 `docs/model-audit/cards/fal-ai__sync-lipsync__v3.md`（#161）— 結構對照

**未做：** FAL_KEY live 生成、空輸入 L1 `--yes`、站內真扣點 e2e、改 `verified`／`points` 寫入 `models.ts`。
