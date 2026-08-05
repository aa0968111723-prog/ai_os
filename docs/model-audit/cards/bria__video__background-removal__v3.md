# bria/video/background-removal/v3

> 審計：R4 · index **#172** · static+research · 2026-08-05  
> slug：`bria__video__background-removal__v3` · 單一真相：`shared/models.ts`  
> **OpenAPI 200** · status **active** · required `video_url` 與站內對齊。  
> **未**改 verified；**未**手改 points（見 §2 機械覆寫）。零 live。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **172** |
| 站內 id | `bria/video/background-removal/v3` |
| endpoint | 同 id（**無** `fal-ai/` 前綴；`fal-ai/bria/…/v3` → **404**） |
| label | Bria VRMBG 3.0 影片去背 |
| category / kind | **video-to-video** · video |
| tier | **flagship** |
| points（手填／目錄快照） | **3**（`models-index` 舊快照仍可能顯示 3） |
| points（runtime `realPricePoints`） | **1**（見 §2） |
| cost（現碼） | **`$0.0042/秒;按秒計費,點數為 6 秒基準`** |
| cost（index 舊字串） | `按處理影片計費(頁面未載價);…`（**已過期**，以 models.ts 為準） |
| verified | **false**（維持） |
| needs | **video** |
| recommended | false |
| sourceHint | 要去背的影片網址 |
| strengths | Bria 第三代影片去背;更準、時序穩少閃爍 |
| bestFor | 開示剪輯、見證短片等正式成品的去背首選 |
| 供應商 | **Bria VRMBG 3.0** via fal · group Bria-RMBG |
| 姊妹 | base `bria/video/background-removal`（#159，站內 id 仍 `fal-ai/bria/…`→endpoint 裸 bria）；realtime id（#173）**映到 base batch**；BEN2 `fal-ai/ben/v2/video`；VEED `veed/video-background-removal` |
| 情境 | **`sc-video-bg` 首選**（runner-up BEN2） |

**一句話**：Bria **第三代**影片去背——talking-head／播客／產品片；官方 **$0.0042／影片秒**；站內只送 `video_url`，吃預設 **黑底 + webm_vp9 + 保音**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 官方價 | **$0.0042 / 影片秒**（生態／realtime 同價帶；現碼已寫死） |
| `parseRealCost` | usdMid=**0.0042** · multiplier=**`PRICE_VIDEO_SECONDS=5`** |
| 機械點數 | `0.0042 × 5 × 31 = 0.651` → **round 1** |
| 若 6s 文案 | `0.0042 × 6 × 31 = 0.781` → 仍 **1** |
| `estimatePoints` | 扁平 **1**（runtime） |
| 舊手填 3 | 來自「頁面未載價」時代；**現被 realPricePoints 覆寫為 1** |
| 校準 | **≈** 對 5–6s 短片；長片扁平 1 **嚴重偏低**（P0 估點脫鉤） |

### 長片風險（P0）

| 片長 | 實費 USD | ≈NT$ | vs 扣 1 點 |
|------|----------|------|-----------|
| 5s | 0.021 | 0.65 | ≈ |
| 10s | 0.042 | 1.3 | 略低 |
| 30s | 0.126 | 3.9 | **低估 ~4×** |
| 60s | 0.252 | 7.8 | **低估 ~8×** |

**結論：** 不手改 points 數值（禁止自動改 points）；長片需 **依秒動態估點**（P0 產品債，同多數 /秒 v2v）。目錄快照 points=3 應在下次 gen-index 對齊 runtime 1。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** — needs=video · `input → { video_url }` |
| OpenAPI | **HTTP 200** · `…?endpoint_id=bria/video/background-removal/v3` |
| Platform | status **active** · display **Bria's VRMBG 3.0** · category video-to-video · updated 2026-07 |
| 死 path | `fal-ai/bria/video/background-removal/v3` → **404** |
| live | **未跑**（needs=video；無 KEY；禁止 --yes） |
| 結論 | **ready-static-only** |

### OpenAPI 摘要（本輪拉取）

- **Queue**：`https://queue.fal.run` · POST `/bria/video/background-removal/v3`
- **Input `VideoBackgroundRemovalV3Input`**
  - **required**：`video_url`
  - **order**：output_container_and_codec → preserve_audio → video_url → background_color → auto_zoom
  - `preserve_audio`：default **true**
  - `background_color`：enum Transparent／Black／White／Gray／Red／Green／Blue／Yellow／Cyan／Magenta／Orange；default **`Black`**
  - `auto_zoom`：default **false**（裁最小包絡矩形）
  - `output_container_and_codec`：mp4_h265／mp4_h264／**webm_vp9**／mov_*／mkv_*／gif；default **`webm_vp9`**
- **Output**：`video` + `request_id`（皆 required）

### 站內 input vs 官方

| 欄位 | 站內 | OpenAPI | 備註 |
|------|------|---------|------|
| `video_url` | ✅ `s` | required | **對齊** |
| `background_color` | ❌ 未送 | default **Black** | 合成透明層需顯送 **Transparent**（P1） |
| `preserve_audio` | ❌ | default true | 通常 OK |
| `output_*` | ❌ | default webm_vp9 | 適合 alpha；黑底時亦 webm |
| `auto_zoom` | ❌ | false | OK |

**無 422 風險**（required 已滿足）。`prompt` 不送——無文字條件（語言無關）。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | Bria VRMBG **3.0**：較 base／舊版更準、時序穩、少閃爍；talking-head／播客／產品／電影感 |
| vs realtime id | #173 裸 `…/realtime` 為 WebRTC 串流 → 站內 **endpoint 映 base batch**；**品質旗艦仍走 v3** |
| vs BEN2 | BEN2 按 **MP**、可真 alpha；v3 按 **秒**、商用授權敘事；`sc-video-bg` 正式→v3、量大→BEN2 |
| vs VEED | VEED 商用 refine；價常按 30 幀；v3 為 Bria 生態首選 |
| 站內 mechanics | v2v · 無 negative／seed |

---

## 5. 站內扣點／退點

```
estimatePoints → realPricePoints("$0.0042/秒") → 1
→ needs=video 守門 → falSubmit("bria/video/background-removal/v3", { video_url })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 短片 5–6s | 顯示／扣／退 **1** 自洽 |
| 長片 | **倒掛**（實帳 ≫ 1）→ P0 |
| verified false | 正確；升 true 待 live |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| v2v 選擇器 | ✅ | flagship |
| `sc-video-bg` | ✅ | **winner** |
| MCP | ✅ | modelId＝裸 bria path |
| 透明底／編碼 UI | ❌ | 吃 Black＋webm_vp9 預設 |
| auto_zoom | ❌ | 預設關 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 正式開示／見證去背 | ✅ | bestFor；情境首選 |
| 透明 webm 合成字卡 | △ | 須顯送 `Transparent`（現黑底） |
| 日常大量試錯 | △ | 改 realtime 映 base 或 BEN2 更省敘事 |
| 綠幕專端 | ❌ | 用 VEED green-screen |
| 無來源片 | ❌ | needs=video |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…/openapi.json?endpoint_id=bria/video/background-removal/v3`（**200**） |
| Platform | active · Bria's VRMBG 3.0 |
| Playground | https://fal.ai/models/bria/video/background-removal/v3 |
| 生態 | `docs/fal生態研究.md` VRMBG 3.0 列 |
| 姊妹卡 | `fal-ai__ben__v2__video.md`、`veed__video-background-removal.md` |
| 站內碼 | `shared/models.ts` #172 列（cost 已 $0.0042/秒） |

---

## 9. 建議動作

- [x] 親驗 endpoint **200**／active；input `video_url` 對齊  
- [x] 確認 runtime 估點 **1**（$0.0042×5s）  
- [x] **維持** verified=false；**不**手改 points  
- [ ] **P0**：長片依秒動態估點（否則 30s+ 倒掛）  
- [ ] **P1**：合成場景預設／可選 `background_color: "Transparent"`  
- [ ] **P2**：暴露 preserve_audio／codec；同步 `models-index` 舊 cost／points=3 快照  
- [ ] **L4**（有 KEY＋短片）：6s 級 live 校 webm 與實帳  

**L0 結論**：契約綠、價機械 1 點短片 ≈；**預設黑底**與**長片估點**為主要殘差。  
**未做：** live、改 verified、改手填 points。
