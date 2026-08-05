# fal-ai/ltx-video

> 審計：R · index **#103** · static+research · 2026-08-05  
> slug：`fal-ai__ltx-video`  
> **本輪已修 input（P0）**：OpenAPI **無** `aspect_ratio` → 站內改只送 `prompt`。  
> **未**改 verified／points。零 live。禁止 `--yes`。  
> 註：目錄 strengths 提「LTX-2.3 4K+原生音訊」——**本 endpoint 為初代 `fal-ai/ltx-video`**，與 `fal-ai/ltx-2.3/*` 新系不同（P1 文案／產品債）。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/ltx-video`（無 alias） |
| label | LTX Video(開源) |
| category / kind | **text-to-video** · video |
| tier | **budget** |
| points | **1** |
| cost | `$0.02/支(固定價)` |
| verified | **true**（既有；本輪未改） |
| needs | 無 |
| recommended | false |
| strengths | 最低成本影片;秒級生成(新版 LTX-2.3 支援 4K+原生音訊) |
| bestFor | 動態預覽、試鏡頭節奏 |
| 供應商 | Lightricks LTX Video · fal 託管（**此 id＝初代 t2v**） |
| 姊妹 | 圖生 `fal-ai/ltx-video-v095/image-to-video`；新系 ltx-2.3（站內未全收） |

**一句話**：全站**最低成本文生影片**試節奏——站內曾誤送 **`aspect_ratio`**（schema 無此欄，**P0 已去掉**）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄） | `$0.02/支(固定價)` |
| `parseRealCost` | usdMid=**0.02** · ×1／支 |
| `realPricePoints` | `0.02 × 31 = 0.62` → **round 1** |
| `estimatePoints` | 扁平 **1** |
| 生態 | 初代固定低價；LTX-2.3 為按秒 $0.04–0.32 另 endpoint |
| 校準 | 對目錄 **$0.02/支** **≈**（points 取 ceil 到 1） |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（修後） | **ok** — 僅 required `prompt` |
| OpenAPI Queue | **HTTP 200** · openapi **3.0.4** · `LtxVideoInput`（title TextToVideoInput）／`Output` |
| metadata | endpointId=`fal-ai/ltx-video` · category text-to-video |
| 修前 input | `{ prompt, aspect_ratio }` → schema **無** aspect_ratio（多餘欄；嚴格校驗風險／無效） |
| 修後 input | `{ prompt: p }` ✅ |
| live | **未跑**（禁止 --yes；t2v 可 L2 但本輪 static） |
| 結論 | **ready-static-only**（P0 幽靈欄已去） |

### OpenAPI 摘要（2026-08-05）

- **Queue**：POST `/fal-ai/ltx-video`
- **required**：`prompt`
- **選填**：`negative_prompt`（default 含 low quality／motion smear 等）· `seed` · `num_inference_steps`（default 30，max 50）· `guidance_scale`（default 3，>1…≤10）
- **Output**：`video`（File.url）+ `seed` — 站內 video extract ✅
- **無**：`aspect_ratio` · `image_size` · `duration` · `generate_audio` · resolution 檔

### 提示詞指引（官方 about）

- 單段流水鏡頭描述：動作 → 姿態 → 外觀 → 環境 → 運鏡 → 光色  
- 建議 ≤200 words；英文為主  
- CFG 5–7 跟提示、3–5 更自由；steps 40+ 品質／20–30 速度  

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | 初代 LTX t2v；開源、快、便宜；畫質與可控性不如旗艦 |
| input（修後） | 只送 prompt；比例／秒數吃服務端預設 |
| negative | schema 有；**已在** `NEGATIVE_PROMPT_SUPPORTED` ✅ |
| seed | schema 有；SEED_SUPPORTED **未**收（可選 P2） |
| 中文 | 畫面內中文不可靠；英文 prompt |
| 與 LTX-2.3 | 新系另 endpoint、按秒計費、可 4K／音訊——**勿**把 strengths 文案當本 id 能力（P1） |

---

## 5. 站內扣點／退點

```
estimatePoints → 1
→ falSubmit("fal-ai/ltx-video", { prompt })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 皆 **1** → 一致 |
| 對 $0.02/支 | **≈** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| t2v budget | ✅ | 無 needs |
| 情境試鏡頭 | ✅ | COMPARISON／playbook 含本 id |
| MCP | ✅ | 純文字即可 |
| 比例／秒數 UI | ❌ | schema 無；輸出固定預設 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 海量試節奏／佔位片 | ✅ | bestFor |
| 對外成片 4K／原生音 | ❌ | 用旗艦或 LTX-2.3 系（若上架） |
| 中文字幕卡 | ❌ | 英文為主 |
| 指定 9:16 | ❌ | 本 endpoint 無 aspect_ratio |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=fal-ai/ltx-video`（本輪 **200**） |
| Playground | https://fal.ai/models/fal-ai/ltx-video |
| 生態 | `docs/fal生態研究.md` LTX 列（注意新舊 endpoint 混寫） |
| 站內 | `shared/models.ts` #103（本輪 P0：去 aspect_ratio） |

---

## 9. 建議動作

- [x] **P0 修 input**：去掉幽靈 `aspect_ratio`，只送 `prompt`  
- [x] **維持** points=1／verified=true  
- [ ] **P1**：strengths 文案區分初代 vs LTX-2.3；或上架 `ltx-2.3` 再改文案  
- [ ] **P2**：`SEED_SUPPORTED` 收本 id  
- [ ] **L2**（有 KEY）：英文鏡頭段 prompt 出片確認固定價  

**L0 結論**：OpenAPI 綠；**P0 幽靈 aspect_ratio 已修**；NEG allowlist 已含。  
**未做：** live、改 points、改 verified、改 strengths 字串。

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd082-fcae-74d0-a77d-f33826d89954` |
| 結果 | **success** · mp4 |
| artifact | https://v3b.fal.media/files/b/0aa514fe/88sNa0cQm9sZxucwUTjjY.mp4 |
| pointsEst | 1 |
| verified | 目錄已 true；**本輪不改** |
