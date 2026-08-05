# bria/video/background-removal/realtime

> 審計：R4 · index **#173** · static+research · **零 live** · 2026-08-05  
> slug：`bria__video__background-removal__realtime` · 單一真相：`shared/models.ts`  
> **P0 已修：** 裸 endpoint `…/realtime` 為 **WebRTC 即時**，與站內 queue 批次管線不相容 → **映到 batch** `bria/video/background-removal`。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id | `bria/video/background-removal/realtime`（目錄／UI 穩定 id） |
| **endpoint（修後）** | **`bria/video/background-removal`**（batch queue；**非** `/realtime`） |
| label | Bria VRMBG 高速版 |
| category | `video-to-video` |
| tier | **economy** |
| points | **1** |
| cost | **`$0.0042/秒;按秒計費,點數為 6 秒基準`** |
| verified | **false** |
| needs | **video** |
| sourceHint | 要去背的影片網址 |
| strengths | VRMBG 高速版;單價極低可放心試錯 |
| bestFor | 日常大量影片去背主力;正式成品再上 v3 |
| 角色定位 | 去背 **1 點經濟檔**（實為 base batch 同價路徑）；**未**進 `sc-video-bg`（該卡 v3→BEN2） |

**L0（修後）：** **ok** — batch OpenAPI required 僅 `video_url`；站內 `input→{video_url}` 對齊。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| 官方價 | **$0.0042／秒**（base batch 與 realtime 頁皆標此價） |
| 6s | USD **0.025** ×31 ≈ **0.78** → **round=1** ✅ 對齊 |
| 結論 | **維持 points=1**；短片定價正確；長片仍扁平倒掛 |

| 長度 | USD | ≈NT$ | vs 1 點 |
|------|-----|------|---------|
| 6s | 0.025 | 0.78 | ≈ |
| 10s | 0.042 | 1.3 | 略低估 |
| 30s | 0.126 | 3.9 | 倒掛 |

與 **v3（3 點）**：同 $0.0042/s — 價差來自 **站內扁平點數**（v3 旗艦緩衝），非官方秒價不同。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 裸 `…/realtime` OpenAPI | **200** 但 **WebRTC** 契約 |
| 修後 batch OpenAPI | **200** · `VideoBackgroundRemovalInput` required `video_url`；output `video`＝File\|Video |
| L2 | **未跑**；禁止 `--yes` |
| 結論 | **ready-static-only**（endpoint 修好後契約綠） |

### 🔴 P0 根因（修前）

| | 裸 `/realtime` | 站內期望 |
|--|----------------|----------|
| 用途 | **Live streaming / WebRTC**（webcam `image_url`） | 上傳片源 batch 去背 |
| required | **無**（`image_url` 僅 playground 說明） | `video_url` |
| output | ICE servers／answer／candidate | 影片 File URL |
| 站內 input | 送 `video_url`（schema 不認） | — |
| extractResult | 無 `video.url` → **無法解析** | — |

**本輪改碼：** `endpoint: "bria/video/background-removal"`（與 `#159` 同 batch 端點；id 保留「realtime」歷史命名）。

### Batch OpenAPI（修後實際打的端點）

| Property | Required | Default | 站內 |
|----------|----------|---------|------|
| `video_url` | **是** | — | ✅ |
| `preserve_audio` | 否 | （schema 有） | ❌ |
| `background_color` | 否 | | ❌ |
| `output_container_and_codec` | 否 | | ❌ |

**Output：** 單一 `video` File → extract **OK**。

---

## 4. 風險（修後）

1. **id 名含 realtime** 但實際走 batch — UI 文案「高速」仍合理（同秒價、queue 批次）；勿宣稱 WebRTC 直播。  
2. **與 #159 `fal-ai/bria/video/background-removal` 撞同一 endpoint** — #159 扁平 **16 點**／舊 cost「≈$0.1/秒」嚴重高估；本 id 是正確廉價入口。建議後續校正 #159 或合併（P1）。  
3. **與 v3 同秒價** — 旗艦溢價在 points 不在 fal 帳單。  
4. 旋鈕（codec／底色）未暴露。

---

## 5. 點數

扁平 **1** ≈ 6s；無秒數動態。**未改 points／verified**。

---

## 6. 情境

| 情境 | 適配 |
|------|------|
| 日常大量去背試錯 | ✅ 1 點主場 |
| 正式成品 | △ 優先 v3（recipe） |
| WebRTC 直播去背 | ❌ 本站未接 realtime 客戶端（裸 endpoint 已避開） |
| 透明層／綠幕專用 | △／❌ 用 BEN2 webm 或 VEED green-screen |

---

## 7. 文件

- 原（WebRTC）：https://fal.ai/models/bria/video/background-removal/realtime  
- **實際呼叫：** https://fal.ai/models/bria/video/background-removal  

---

## 8. 建議動作

- [x] **P0 endpoint 映 batch** `bria/video/background-removal`  
- [x] **維持** points=1／cost $0.0042／input video_url  
- [ ] 校正 #159 高估 points／cost 或標 deprecated  
- [ ] 文案可選改 label「Bria 影片去背(經濟)」避免 realtime 誤解  
- [ ] live 後 verified  

**總建議標籤：** `已修 endpoint→batch base；1≈6s@$0.0042；勿走 WebRTC 裸 id；ready-static-only`

### 狀態燈

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ⚠input→fixed | 📄OpenAPI | 未跑 | **已修** endpoint→batch |

---

## 9. 來源

1. OpenAPI `/realtime`（WebRTC IceServers／Answer）vs base batch（video_url）  
2. WebSearch：$0.0042/s on base／realtime／v3 頁  
3. `shared/models.ts` 本輪 endpoint 覆寫  
4. `docs/fal生態研究.md`  

**未做：** live、改 verified／points、#159 合併。
