# veed/lipsync

> 審計：R4 · index **#166** · static+research · **零 live** · 2026-08-05  
> slug：`veed__lipsync` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id / endpoint | `veed/lipsync`（`endpointOf` = id，無 alias；非 `fal-ai/*` 命名空間） |
| label | VEED 對嘴 |
| category | `video-to-video`（影片轉影片） |
| tier | **economy** |
| kind | `video` |
| points | **12** |
| cost | `$0.4/分;按影片長度計費,點數以 1 分鐘短片估,較長影片實際費用更高` |
| verified | **false** |
| recommended | **false** |
| needs | **video**（人物影片網址） |
| secondaryNeeds | **audio**（配音／替換音訊） |
| sourceHint | 要對嘴的人物影片 |
| secondarySourceHint | 要套用的配音音訊 |
| strengths | 商用對嘴,便宜穩定;1.9 與 Sync 標準間的性價比 |
| bestFor | 量大時的中階對嘴 |
| 供應商／底層 | **VEED** commercial lipsync via fal.ai（display_name **Lipsync**；tags `lipsync`／`video-to-video`／`avatar`；license **commercial**） |
| 角色定位 | 對嘴家族 **經濟／量產中階**（價低於 Sync 1.9、遠低於 v2 標準）；**未**進 `sc-lipsync` pickIds（該卡：v3 → v2 → MuseTalk） |

**一句話**：音訊驅動人物口型（video+audio → video）；**$0.4/分** 商用檔，量大試跑／中階出片的便宜穩定選項。

**L0 靜態契約：** **ok**  
- 必填欄齊；`category ∈ CATEGORIES`；id 唯一；`input` 可呼叫。  
- 雙來源：`needs=video` + `secondaryNeeds=audio` 與官方 OpenAPI required 對齊。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **12** |
| cost 字串 | **$0.4/分**；按影片長度；1 分鐘短片估 |
| 官方價（生態研究已查證） | **$0.4／分鐘**（`docs/fal生態研究.md` ✅已查證） |
| 計費性質 | **按處理影片分鐘**（per-minute）；長片實際費用高於固定扣點 |
| `parseRealCost` | 解析 cost 得 **usdMid=0.4**、multiplier=**1**（`PRICE_V2V_MINUTES=1`）→ 期望 **12** 點 |
| `realPricePoints` | `round(0.4 × 1 × 31)` = **12**（載入時機械覆寫＝目錄值） |
| 匯率 | USD×**31** ≈ NT$（與審計／校準同基準） |
| 校準報告列 | VEED 對嘴 ⚠︎ · 12 · 判定 **≈**（usdMid 0.400 → 期望 12.4 → 12） |

### 2.1 粗估（1 分鐘基準）

| 假設單價 | USD/分 | 約 NT$ | 對齊 points |
|----------|--------|--------|-------------|
| **fal／目錄 $0.4** | 0.4 | 12.4 | **12**（現況＝機械校準） |
| 相對 Sync 1.9（$0.7→22） | — | — | VEED **更省約 43%**（0.4/0.7） |
| 相對 v2 標準（$3→93） | — | — | 約 **1/7.5** 成本 |
| 相對 LatentSync／MuseTalk budget | — | — | 略高於 budget 打量檔，定位「商用穩定」 |

| 時長 | 真實成本 @$0.4 | 站內固定 12 點 |
|------|----------------|----------------|
| 30s | $0.2 ≈ NT$6.2 | 偏貴緩衝 |
| **1 min** | $0.4 ≈ NT$12.4 | **對齊**（四捨五入 12） |
| 2 min | $0.8 ≈ NT$24.8 | **偏低**（固定點） |
| 5 min | $2.0 ≈ NT$62 | 長片倒掛 |

**結論（L2）：** 目錄 cost **$0.4/分** 與生態研究「已查證」一致；points=12＝`round(0.4×31×1)`，**1 分鐘基準無需調價**。長片固定扣點仍低估——文案已寫「較長影片實際費用更高」，產品誠實度 OK。

**註：** `models.ts` 行首註解「依 ×0.1×31…上調防長片」與現行 **$0.4 → realPricePoints=12** 不一致，屬**過時註解**；以 cost 字串＋機械覆寫為準，**不依該註解調點**。

**本回合禁止改 `models.ts` 的 points／verified**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — id／category／needs／secondaryNeeds／`input(s,s2)→{video_url,audio_url}` |
| OpenAPI Queue | **HTTP 200** · `GET …/openapi.json?endpoint_id=veed/lipsync` · openapi **3.0.4** |
| 平台 metadata | **HTTP 200** · `api.fal.ai/v1/models?endpoint_id=…` · status **active** · display_name **Lipsync** · description「Generate realistic lipsync from any audio using VEED's model.」 · tags `lipsync,video-to-video,avatar` · license **commercial** · updated **2026-07-13** · date **2025-05-28** · kind **inference** |
| 模型頁 HTML | 連線 reset／逾時（反爬）— **不計連通失敗**（schema+metadata 已通） |
| dry-run probe | `verify-models.ts --probe "veed/lipsync"` → **拒探**：「需要來源輸入(影片)…請在站內以素材實測」（符合 needs 鐵律） |
| L1 空 `{}` --yes | **未跑**（零 live；**禁止 --yes**） |
| L2 live 生成 | **未跑**（需 video+audio 素材；單次 1 分 @$0.4 約 NT$12 級） |
| 結論 | **ready-static-only**（契約＋OpenAPI＋active＋價對齊；待素材 live 後可升 ready／verified） |

**歷史：** `docs/fal端點連通報告.md` **無**本 id 列；本回合 schema 200 + status active 支持「端點活著」。

---

## 4. 底層邏輯

### 4.1 能力（公開資料）

- **VEED commercial lipsync**：任意音訊 → 人物影片口型同步；fal 描述「realistic lipsync from any audio」。  
- 輸入：既有 **人物影片** + **配音音訊** → 輸出口型對齊影片（生態研究：語言無關，中文可用）。  
- 站內定位：量大中階／日常量產；較 Sync 1.9 更省，較 v2／v3 品質與單價都低一階；師父影像「不能失真」仍應走 **MuseTalk**（只改嘴）。

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
| 可選旋鈕 | 官方 schema **僅**兩必填欄；站內無額外旋鈕可暴露 |

`prepareGenerationRequest`：缺 `needs` 或 `secondaryNeeds` 分別 BAD_REQUEST（「此模型需要來源…」「還需要第二來源…」）。

### 4.3 官方 OpenAPI `LipsyncInput` 對照

| Property | 約束 | Required | Default | 站內 | 備註 |
|----------|------|----------|---------|------|------|
| `video_url` | string (uri), minLength 1, maxLength 2083 | **是** | — | ✅ | 一致 |
| `audio_url` | string (uri), minLength 1, maxLength 2083 | **是** | — | ✅ | 一致 |

**無** `model`／`sync_mode`／解析度等可選欄（比 Sync v2 更簡）。

**Output `LipsyncOutput`：** required `video`（`File`：url／content_type 等；例 `video/mp4`）。

**Queue：** paths `/veed/lipsync`（POST）+ `/veed/lipsync/requests/{request_id}` status／cancel／result。

### 4.4 與官方差異／風險

1. **定價（1 分鐘基準）：** 站內 $0.4／12 點 vs 生態研究 **$0.4/分** → **對齊**，無需調 points。  
2. **schema 極簡：** 無影音不等長策略旋鈕——行為完全依 VEED 後端預設（不可站內調）。  
3. **strengths「1.9 與 Sync 標準間的性價比」：** **單價低於 1.9**（$0.4 vs $0.7），「中階」較宜解讀為**商用穩定／品質體感**，非價位夾在中間；文案可選澄清「比 1.9 更省」。  
4. **`sc-lipsync` 未列本 id：** 情境卡只推 v3／v2／MuseTalk；量大經濟檔靠手動選模或目錄搜尋。  
5. **prompt 在 MCP 路徑：** 部分工具 schema 要 prompt，本模 input 丟棄——可填佔位。  
6. **`verified=false`：** `modelIsOperationallyReady` 否 → 助手 requireVerified 時不會自動選；手動可選。  
7. **家族階梯（價）：** LatentSync／MuseTalk（budget）→ **VEED（12／$0.4）** → 1.9（22／$0.7）→ v2 標準（93／$3）→ v2 Pro（155／$5）→ v3（目錄 155 但官方 $8，見 #161）。

### 4.5 分詞／文字塔

不適用（無 T5／CLIP 條件）。世界觀／卡片注入：對嘴類不依 prompt，卡片錨點不影響口型。

---

## 5. 站內點數

| 項目 | 說明 |
|------|------|
| 估點 | 扁平 **points=12**（無 `estimatePoints` 時長係數） |
| 扣點 | `reserveQuota(…, est)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／回收 `refund`；與 est 對稱 |
| UI | 模型卡顯示 12；cost 文案提示長片更貴 |
| 與官方 | 官方 **$0.4/分** 浮動；站內固定 12 ≈ **1 分鐘基準對齊**；**≥2 分平台吃虧** |
| 本回合 | **未改 points**；未跑真扣點 e2e |

**建議（可選 follow-up，非本卡必改）：**  
1. **維持** points=12、cost=`$0.4/分;…`（已正確）。  
2. 可選：長片 `estimatePoints` 依秒數線性——與全家族 v2v 對嘴另案。  
3. 清理過時行首註解（×0.1×31／0.7→8 點），避免後人誤調。

---

## 6. 情境與可用性

| 情境 | 適配 | 原因 |
|------|------|------|
| 量大中階對嘴／日常量產 | ✅ 主場 | bestFor；商用、$0.4/分 |
| 多語開示草稿／志工旁白試片 | ✅ | 生態研究：日常量產降 1.9 或 **VEED** |
| 近景高規／牙齒細節極致 | ❌ | 改 **v2 Pro** 或 **v3** |
| 對外正式天花板自然度 | ❌ | 用 **v3**／**v2 Pro** |
| 師父影像「只改嘴、少動臉」 | △／❌ | `sc-lipsync` why 指向 **MuseTalk** 保守型 |
| 無片源／無音訊 | ❌ | needs+secondaryNeeds 雙攔截 |
| 純文生影／avatar 從單圖生講者 | ❌ | 非 t2v；Kling lipsync audio-to-video 另端點 |
| 助手自動挑選（requireVerified） | ❌ | verified=false |
| 手動選模／目錄搜尋 | ✅ 可選 | UI 雙來源提示；**不在** `sc-lipsync` pickIds |

**可用性／文案（L6）**

- sourceHint／secondarySourceHint 清楚。  
- bestFor 與量大中階一致。  
- strengths「介於 1.9 與 Sync 標準」易被讀成**價位**夾中——實際更便宜；可選改「商用穩定、單價低於 1.9」。（非阻塞）  
- cost／points 與 $0.4 對齊——**無需改價文案**。  
- 目錄標 ⚠︎（未 verified）合理，待 live。

---

## 7. MCP / 文件

| 項目 | 結果 |
|------|------|
| MCP `find_model` | 目錄同源；關鍵詞「對嘴／lipsync／VEED／veed」可命中 |
| MCP `submit_generation` | 可調；**必須** `source_url`（影片）+ 第二來源音訊；與網頁同 `executeGenerationCommand` |
| MCP 火力 | 同站內：僅 `video_url`+`audio_url`；無額外旋鈕 |
| Playground | https://fal.ai/models/veed/lipsync |
| API 文件 | https://fal.ai/models/veed/lipsync/api |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=veed/lipsync |
| 本回合 HTTP | OpenAPI **200**；metadata **200 active**；定價依生態研究 **$0.4/分**（模型頁 HTML 本回合未取到） |

---

## 8. 建議動作

- [x] **維持 points／cost** — **12** 與官方／研究 **$0.4/分**×31×1 分鐘一致；無需調價  
- [x] **維持 id／endpoint／category／needs／secondaryNeeds／input** — 與 OpenAPI required 一致  
- [ ] **修 input 可選** — schema 無額外旋鈕；**無須**暴露 sync_mode／model  
- [ ] **verified true** — **勿擅自改**；待 L4 站內 video+audio 素材 live 成功後人工開  
- [ ] **下架或隱藏** — **否**；端點 active，經濟對嘴檔位清楚  
- [ ] **文案 P3（可選）** — strengths 澄清「單價低於 1.9 的商用檔」；行首過時註解清理  
- [ ] **情境卡（可選）** — 若產品要推量大經濟檔，可將 `veed/lipsync` 納入 `sc-lipsync` 或另開「大量草稿對嘴」卡（現況：LatentSync／1.9／本模皆手動）  
- [ ] **Live 佇列（可選，控費）** — 最短片源＋短音訊；估 **≥ NT$ 數元～12／分**；**禁止本回合 --yes**

**總建議標籤（寫入 _index）：** `維持`（$0.4/分＝12 已對齊；ready-static-only；live 後 verified）

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄 OpenAPI | 未跑 | **維持**（結構＋定價對齊） |

---

## 9. 來源

1. `shared/models.ts` — `veed/lipsync`（~1580–1586）、對嘴家族 1.9／v2／v3／MuseTalk／LatentSync、`sc-lipsync`、`parseRealCost`／`PRICE_V2V_MINUTES`／`realPricePoints`／`USD_TO_TWD=31`  
2. `docs/model-audit/models-index.json` — index **166** · slug `veed__lipsync`  
3. `docs/fal生態研究.md` — VEED Lipsync **$0.4/分鐘** ✅已查證；多語弘法日常量產降 1.9 或 VEED  
4. `docs/點數校準報告.md` — VEED 對嘴 12／≈（期望 12.4）  
5. `docs/模型目錄.md`／`docs/模型清查清單.md` — ⚠︎ 未驗證；需影片素材實測  
6. fal OpenAPI（本回合 curl **200**）— `LipsyncInput`／`LipsyncOutput`（required video_url+audio_url only）  
7. fal metadata API — status **active**、display_name Lipsync、license commercial  
8. `scripts/verify-models.ts --probe`（**無 --yes**）— needs 拒探  
9. `server/services/generationCore.ts`／`aiModelPolicy.ts` — 雙來源攔截、operational ready  
10. 同家族卡 `docs/model-audit/cards/fal-ai__sync-lipsync__v2.md`（#162）、`…__v3.md`（#161）— 結構對照  

**未做：** FAL_KEY live 生成、空輸入 L1 `--yes`、站內真扣點 e2e、改 `verified`／`points` 寫入 `models.ts`。
