# fal-ai/cogvideox-5b

> 審計：R · index **#127** · static+research · 2026-08-05  
> slug：`fal-ai__cogvideox-5b`  
> **本輪已修 input（P0）**：OpenAPI **無** `aspect_ratio` → 改送 **`video_size: imageSize(f)`**。  
> **未**改 verified／points。零 live。禁止 `--yes`。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/cogvideox-5b`（無 alias） |
| label | CogVideoX-5B(智譜開源) |
| category / kind | **text-to-video** · video |
| tier | **budget** |
| points | **6** |
| cost | `$0.2/支` |
| verified | **true**（既有；本輪未改） |
| needs | 無 |
| recommended | false |
| strengths | 開源老將,按支超低價;品質基礎但穩定 |
| bestFor | 教學練習、海量試驗、佔位動態 |
| 供應商 | 智譜 THUDM CogVideoX-5B · fal 託管 |
| 姊妹 | 同價帶 `fal-ai/wan-t2v`、`luma … ray-2-flash`；更高 Hunyuan／Wan 2.x |

**一句話**：智譜開源 **5B** 文生影——**$0.2/支** 海量試片；比例走 **`video_size`** 而非 aspect_ratio（**P0 已修**）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **6** |
| cost | `$0.2/支` |
| `parseRealCost` | usdMid=**0.2** · ×1／支 |
| `realPricePoints` | `0.2 × 1 × 31 = 6.2` → **round 6** |
| `estimatePoints` | 扁平 **6** |
| 校準 | **≈** 固定支價 |

### 輸出假設（不送進階參數 → 預設）

| 項 | OpenAPI default | 備註 |
|----|-----------------|------|
| `video_size` | `{width:720,height:480}` 或 enum | 站內改送 imageSize 三比例 |
| `export_fps` | **16** | 可 4–32 |
| `use_rife` | **true** | 插幀 |
| `num_inference_steps` | **50** | 上限 50 |
| `guidance_scale` | **7** | |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（修後） | **ok** |
| OpenAPI | **HTTP 200** · `Cogvideox5bInput`／`…Output` |
| metadata | status active · display_name「CogVideoX-5B」· group Text to Video |
| 修前 input | `{ prompt, aspect_ratio }` — **schema 無 aspect_ratio** → 無效／風險 |
| 修後 input | `{ prompt, video_size: imageSize(f) }` |
| live | **未跑**（禁止 --yes） |
| 結論 | **ready-static-only** |

### OpenAPI 摘要（2026-08-05）

- **Queue**：POST `/fal-ai/cogvideox-5b`
- **required**：`prompt`
- **properties**：`prompt` · `negative_prompt` · `video_size` · `export_fps` · `use_rife` · `seed` · `num_inference_steps` · `guidance_scale` · `loras[]`
- **無**：`aspect_ratio`／`duration`／`resolution` 字串
- **Output**：`video` + `seed` + timings／prompt

### 三比例（修後）

| format | body `video_size` | schema |
|--------|-------------------|--------|
| 16:9 | `landscape_16_9` | ✅ enum |
| 9:16 | `portrait_16_9` | ✅ |
| 1:1 | `square_hd` | ✅ |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | CogVideoX 開源 5B——品質基礎、適合佔位與教學 |
| input | 比例＝**video_size**（與圖像 ImageSize 同 enum） |
| negative | schema **有**；`NEGATIVE_PROMPT_SUPPORTED` **已列** ✅ |
| seed | schema 有；allowlist 無 |
| LoRA | schema 支援 `loras`；站內本 id **未**綁 zip needs |
| 中文 | 提示可用；畫面內字卡不可靠 |

---

## 5. 站內扣點／退點

```
estimatePoints → 6
→ falSubmit("fal-ai/cogvideox-5b", { prompt, video_size })
→ 失敗 refund(6)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 皆 **6** → 一致 |
| 對 $0.2/支 | **≈** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| t2v budget | ✅ | 無 needs |
| MCP | ✅ | |
| fps／RIFE／steps UI | ❌ | 吃預設 |
| 正式成片主推 | ❌ | bestFor=佔位／試驗 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 教學練習／海量試驗 | ✅ | bestFor |
| 佔位動態時間軸 | ✅ | 6 點低 |
| 正式對外成片 | ❌ | 換 Wan／Hunyuan／商用旗艦 |
| 畫面內中文 | ❌ | 不可靠 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=fal-ai/cogvideox-5b`（**200**） |
| Platform | active |
| Playground | https://fal.ai/models/fal-ai/cogvideox-5b |
| HF／授權 | metadata github_url → THUDM CogVideoX-5b LICENSE |
| 站內 | `shared/models.ts` #127（本輪 video_size） |

---

## 9. 建議動作

- [x] **P0 修 input**：去掉 `aspect_ratio`，改 `video_size: imageSize(f)`  
- [x] **維持** points=6／verified=true／negative allowlist  
- [ ] **可選 P2**：SEED allowlist  
- [ ] **L2**：最小 prompt live  

**L0 結論**：OpenAPI 綠；**P0 比例欄已對齊**；支價 6 點 ≈。  
**未做：** live、改 points、改 verified。

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd0a1-01f6-7fb1-a408-30b3ec97695d` |
| 結果 | **timeout** 長時間 queued（未 re-yes） |
| pointsEst | 6 保守入帳 |
| verified | 目錄 true；本輪不改 |
