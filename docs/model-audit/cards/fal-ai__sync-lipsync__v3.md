# fal-ai/sync-lipsync/v3

> 審計：R4 · index **#161** · static+research · **零 live** · 2026-08-05  
> slug：`fal-ai__sync-lipsync__v3` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id / endpoint | `fal-ai/sync-lipsync/v3`（`endpointOf` = id，無 alias） |
| label | Sync-3 對嘴(新旗艦) |
| category | `video-to-video`（影片轉影片） |
| tier | **flagship** |
| kind | `video` |
| points | **155**（目錄；見 §2 與官方 $8/分 落差） |
| cost | `約$5+/分(略高於 v2,以 fal 現場為準);按影片長度計費,點數以 1 分鐘短片估,較長影片實際費用更高` |
| verified | **false** |
| recommended | **false** |
| needs | **video**（人物影片網址） |
| secondaryNeeds | **audio**（配音／替換音訊） |
| sourceHint | 要對嘴的人物影片 |
| secondarySourceHint | 要套用的配音音訊 |
| strengths | sync.so 最新一代;對嘴自然度天花板 |
| bestFor | 對外正式的多語開示對嘴 |
| 供應商／底層 | **Sync.so sync-3** via fal.ai（group `sync-3`） |
| 角色定位 | 站內 **對嘴自然度天花板** 候選旗艦；`sc-lipsync` pickIds **第一順位** |

**一句話**：音訊驅動人物口型（video+audio → video）；語言無關，適合中文開示＋外語配音的國際版。

**L0 靜態契約：** **ok**  
- 必填欄齊；`category ∈ CATEGORIES`；id 唯一；`input` 可呼叫。  
- 雙來源：`needs=video` + `secondaryNeeds=audio` 與官方 required 對齊。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **155** |
| cost 字串 | 約 **$5+/分**（略高於 v2） |
| 官方價（fal 模型頁摘要） | **$8 per minute**（「Your request will cost $ 8 per minute.」） |
| 計費性質 | **按處理影片分鐘**（per-minute of video processed）；與影音長度／錯位處理相關 |
| `parseRealCost` | 解析 cost 得 **usdMid=5**、multiplier=**1**（`PRICE_V2V_MINUTES=1`）→ 期望 **155** 點 |
| 匯率 | USD×**31** ≈ NT$（與審計／校準同基準） |
| 校準報告列 | Sync-3 ⚠︎ · 155 · 判定 **≈**（依目錄 $5 中值） |

### 2.1 粗估（1 分鐘基準）

| 假設單價 | USD/分 | 約 NT$ | 對齊 points |
|----------|--------|--------|-------------|
| 目錄／校準用 $5 | 5 | 155 | **155**（現況） |
| **fal 現場 $8** | 8 | 248 | **248**（應調） |
| 相對 v2 Pro（$5） | — | — | v3 貴 **60%**，不應與 Pro **同點** |
| 相對 v2 標準（$3→93） | — | — | 旗艦溢價合理，但現 155 仍偏低 |

| 時長 | 真實成本 @$8 | 站內固定 155 點 |
|------|--------------|-----------------|
| 30s | $4 ≈ NT$124 | 偏貴緩衝 |
| **1 min** | $8 ≈ NT$248 | **低估約 37%**（155 vs 248） |
| 2 min | $16 ≈ NT$496 | **嚴重偏低** |
| 5 min | $40 ≈ NT$1240 | 長片倒掛更劇 |

**結論（L2）：** 目錄 cost「約$5+」與 fal 明文 **$8/分** 不符；points=155 以 $5×31 校準，**應調至約 248**（或 cost 改寫 $8/分後重跑校準）。長片固定扣點仍會低估——文案已寫「較長影片實際費用更高」，產品誠實度部分 OK，但 **1 分鐘基準本身已錯**。

**本回合禁止改 `models.ts` 的 points／verified**；建議 follow-up 人工 PR 調價。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — id／category／needs／secondaryNeeds／`input(s,s2)→{video_url,audio_url}` |
| OpenAPI Queue | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/sync-lipsync/v3` · openapi **3.0.4** |
| 平台 metadata | **HTTP 200** · `api.fal.ai/v1/models?endpoint_id=…` · status **active** · display_name **sync-3 Lipsync** · tags `stylized,transform,lipsync` · license **commercial** · updated **2026-06-22** · about「native visual intelligence」 |
| 模型頁 HTML | Vercel Security Checkpoint／**429**（反爬）— **不計連通失敗**（schema+metadata 已通） |
| dry-run probe | `verify-models.ts --probe "fal-ai/sync-lipsync/v3"` → **拒探**：「需要來源輸入(影片)…請在站內以素材實測」（符合 needs 鐵律） |
| L1 空 `{}` --yes | **未跑**（零 live；**禁止 --yes**） |
| L2 live 生成 | **未跑**（需 video+audio 素材；單次 1 分 @$8 約 NT$248 級） |
| 結論 | **ready-static-only**（契約＋OpenAPI＋active；待素材 live 後可升 ready／verified） |

**歷史：** `docs/fal端點連通報告.md` 曾標 v3 暫時性 5xx／逾時——屬當時 probe 環境，**本回合 schema 200 + status active** 不支持「端點已死」。

---

## 4. 底層邏輯

### 4.1 能力（公開資料）

- **Sync.so sync-3**：官方／fal 描述為目前最強對嘴、**native visual intelligence**、professional-quality。  
- 輸入：既有 **人物影片** + **任意語言配音音訊** → 輸出口型對齊影片（語言無關）。  
- 站內定位：多語開示、虛擬主持人、配音替換的旗艦；較 MuseTalk 更「全臉自然度」，較 1.9／v2 更貴。

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
| 可選旋鈕 | 站內 **不暴露** `sync_mode`／`options`（吃官方預設） |

`prepareGenerationRequest`：缺 `needs` 或 `secondaryNeeds` 分別 BAD_REQUEST（「此模型需要來源…」「還需要第二來源…」）。

### 4.3 官方 OpenAPI `SyncLipsyncV3Input` 對照

| Property | 約束 | Required | Default | 站內 | 備註 |
|----------|------|----------|---------|------|------|
| `video_url` | string | **是** | — | ✅ | 一致 |
| `audio_url` | string | **是** | — | ✅ | 一致 |
| `sync_mode` | enum：`cut_off`／`loop`／`bounce`／`silence`／`remap` | 否 | **cut_off** | ❌ 預設 | 影音時長不一致時的策略 |
| `options` | `Sync3GenerationOptions` \| null | 否 | — | ❌ | 進階；其內 `sync_mode` 可覆寫頂層 |

**`options` 子項（Sync.so；多數標註 primarily react-1／sync-3 自動忽略）：**

| 子欄 | 說明 | 站內 |
|------|------|------|
| `model_mode` | lips／face／head／lipsync／emotion／talking_head | 未暴露 |
| `prompt` | 情緒枚舉 happy…neutral（react-1） | 未暴露 |
| `temperature` | 0–1 表現力；**sync-3 忽略** | 未暴露 |
| `occlusion_detection_enabled` | **sync-3 忽略** | 未暴露 |
| `active_speaker_detection` | 多人畫面主動說話者（auto_detect／bbox／face_image 等） | 未暴露 |

**Output `SyncLipsyncV3Output`：** required `video`（`File`：url／content_type／file_name／file_size）。

**Queue：** `https://queue.fal.run` · paths `/fal-ai/sync-lipsync/v3`（POST）+ status／cancel／result。

### 4.4 與官方差異／風險

1. **定價低估（P0）：** 站內 $5+／155 點 vs fal **$8/分** → 1 分鐘基準已倒掛。  
2. **未暴露 `sync_mode`：** 預設 `cut_off` 會裁切較長端；長旁白配短片可能不如預期——進階使用者無 UI。  
3. **未暴露 active speaker：** 多人同框開示無法指定說話者。  
4. **prompt 在 MCP 路徑：** 部分工具 schema 要 prompt，但本模 input 丟棄——可填佔位，不影響輸出。  
5. **`verified=false`：** `modelIsOperationallyReady` 否 → 助手強制 verified 時不會自動選它；但 **`sc-lipsync` 仍把 v3 放第一**——手動情境卡可選、自動路由可能跳過。  
6. **家族競品：** v2 Pro（155、$5、verified true）、v2（93、$3）、1.9（22、$0.7）、MuseTalk／LatentSync／VEED——價位與「改嘴保守度」階梯清楚。

### 4.5 分詞／文字塔

不適用（無 T5／CLIP 條件）。世界觀／卡片注入：對嘴類不依 prompt，卡片錨點不影響口型。

---

## 5. 站內點數

| 項目 | 說明 |
|------|------|
| 估點 | 扁平 **points=155**（無 `estimatePoints` 時長係數） |
| 扣點 | `reserveQuota(…, est)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／回收 `refund`；與 est 對稱 |
| UI | 模型卡顯示 155；cost 文案提示長片更貴 |
| 與官方 | 官方 **$8/分** 浮動；站內固定 155 ≈ **$5 基準** → **短於 ~0.6 分有緩衝、≥1 分平台吃虧** |
| 本回合 | **未改 points**；未跑真扣點 e2e |

**建議（人工 PR，非本卡改碼）：**  
1. `cost` → `$8/分;按影片長度計費,點數以 1 分鐘短片估,較長影片實際費用更高`  
2. `points` → **248**（`round(8×31×1)`）  
3. 可選：長片 `estimatePoints` 依秒數線性（與 TTS 按字類似）— 另案。

---

## 6. 情境與可用性

| 情境 | 適配 | 原因 |
|------|------|------|
| 對外正式多語開示對嘴 | ✅ 主場 | bestFor；sync-3 品質天花板 |
| 近景高規虛擬主持人 | ✅ | native visual intelligence；較 v2 標準更適合 |
| 日常量大對嘴 | △／❌ | 太貴；用 v2（93）或 1.9（22）／VEED |
| 師父影像「只改嘴、少動臉」 | △ | `sc-lipsync` why 指向 **MuseTalk** 保守型 |
| 無片源／無音訊 | ❌ | needs+secondaryNeeds 雙攔截 |
| 純文生影 | ❌ | 非 t2v |
| 助手自動挑選（requireVerified） | ❌ | verified=false |
| 手動選模／情境卡 `sc-lipsync` | ✅ 可選 | pickIds 第一；UI 顯示雙來源提示 |

**可用性／文案（L6）**

- sourceHint／secondarySourceHint 清楚；ModelPicker 會串「影片＋配音」。  
- strengths／bestFor 方向正確。  
- **應同步：** cost／points 與 $8；必要時標「貴於 v2 Pro（$5）」。  
- playbook `scenarioPlaybook` 弘法路線仍列 v2 pro／1.9，**未列 v3**——與 `SCENARIO_RECIPES sc-lipsync` 不一致，後續可對齊（非本回合改碼）。

---

## 7. MCP / 文件

| 項目 | 結果 |
|------|------|
| MCP `find_model` | 目錄同源；關鍵詞「對嘴／lipsync／Sync-3」可命中 |
| MCP `submit_generation` | 可調；**必須** `source_url`（影片）+ 第二來源音訊；與網頁同 `executeGenerationCommand` |
| MCP 火力 | 同站內：僅 `video_url`+`audio_url`；無 sync_mode／ASD |
| Playground | https://fal.ai/models/fal-ai/sync-lipsync/v3 |
| API 文件 | https://fal.ai/models/fal-ai/sync-lipsync/v3/api |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/sync-lipsync/v3 |
| 本回合 HTTP | OpenAPI **200**；metadata **200 active**；HTML **429**／checkpoint |

---

## 8. 建議動作

- [ ] **調 points（建議主標籤）** — **155 → 248**（官方 **$8/分** ×31×1 分鐘）；同步 `cost` 為 `$8/分;…`；重跑 `audit-model-pricing`／點數校準列  
- [x] **維持 id／endpoint／category／needs／secondaryNeeds／input** — 與 OpenAPI required 一致，無需修 schema 映射  
- [ ] **修 input 可選 P2** — 暴露 `sync_mode`；進階 `options.active_speaker_detection`（多人同框）  
- [ ] **verified true** — **勿擅自改**；待 L4 站內 video+audio 素材 live 成功後人工開  
- [ ] **下架或隱藏** — **否**；端點 active，產品位階明確  
- [ ] **文案／配方** — `sc-lipsync` 已推 v3；`scenarioPlaybook` 弘法對嘴可補 v3；標明貴於 v2 Pro  
- [ ] **Live 佇列（可選，控費）** — 最短片源＋短音訊；估 **≥ NT$ 數十～248／分**；**禁止本回合 --yes**

**總建議標籤（寫入 _index）：** `調 points`（官方 $8/分→248；cost 同步；ready-static-only；live 後 verified）

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄 OpenAPI | 未跑 | **調 points**（$8/分；結構維持） |

---

## 9. 來源

1. `shared/models.ts` — `fal-ai/sync-lipsync/v3`（~1541–1547）、家族 v2/pro／v2／1.9、`sc-lipsync`、`parseRealCost`／`PRICE_V2V_MINUTES`  
2. `docs/model-audit/models-index.json` — index **161**  
3. `docs/fal生態研究.md` — Sync-3 列、約 $5+/分（**本回合以 fal $8 覆蓋**）  
4. `docs/點數校準報告.md` — Sync-3 155／≈（依 $5）  
5. `docs/模型目錄.md`／`docs/模型清查清單.md` — ⚠︎ 未驗證  
6. fal OpenAPI（本回合 curl **200**）— `SyncLipsyncV3Input`／`Output`／`Sync3GenerationOptions`  
7. fal metadata API — status **active**、display_name sync-3 Lipsync  
8. fal 模型頁搜尋摘要 — **$8 per minute**  
9. `scripts/verify-models.ts --probe`（**無 --yes**）— needs 拒探  
10. `server/services/generationCore.ts`／`aiModelPolicy.ts` — 雙來源攔截、operational ready  
11. sync.so pricing 公開頁 — sync-3 原廠按幀／秒價位參考（fal 以 **$8/分** 為準）

**未做：** FAL_KEY live 生成、空輸入 L1 `--yes`、站內真扣點 e2e、改 `verified`／`points` 寫入 `models.ts`。
