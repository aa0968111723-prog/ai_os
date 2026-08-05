# fal-ai/veo3.1/lite

> 審計：R3 · index **#112** · static+research · 2026-08-05  
> slug：`fal-ai__veo3.1__lite` · 單一真相：`shared/models.ts`  
> **本輪已修** `aspect_ratio`：OpenAPI 僅 `16:9`\|`9:16`（`1:1`→`16:9` 防 422）。**未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/veo3.1/lite`（無 alias） |
| label | Veo 3.1 Lite(Google) |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points | **5** |
| cost（目錄） | `720p $0.03/秒(無音)–$0.05(含音)、1080p $0.05–0.08/秒;按秒計費,點數為 6 秒基準` |
| verified | **true**（既有；本輪不翻） |
| needs | 無 |
| recommended | false |
| strengths | Veo 質感的超低價版;含音只要 $0.05/秒 |
| bestFor | 量產日常 B-roll、空鏡、活動預告 |
| 供應商 | Google **Veo 3.1 Lite** via fal.ai |
| 姊妹 | 旗艦 `fal-ai/veo3.1`（31 點）；Fast `…/fast`（16）；i2v `…/image-to-video` |

**一句話**：Veo 家族超低價經濟檔——720p 無音約 $0.03/秒；適合量產 B-roll／空鏡；**預設 8s＋含音** 與扁平 5 點假設嚴重脫鉤（見 §2 P0）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **5** |
| cost | 上表區間／按秒 |
| `parseRealCost` | 首個 `$0.03/秒` → usdMid=**0.03**；`PRICE_VIDEO_SECONDS=**5**` → ×5 |
| `realPricePoints` | 0.03 × 5 × 31 = **4.65** → round **5** |
| 校準報告 | 4.6 ≈（表列「6 秒基準」文案 vs 機械 **5 秒**） |
| estimatePoints | **扁平 5**（不隨實際 duration／audio／resolution） |

### 風險（**P0 估點脫鉤**，未改 points）

| 官方 default | 實費量級（720p） | 站內扣 5 點 |
|--------------|------------------|------------|
| `duration` **`8s`**（enum 4s\|6s\|8s） | 無音 0.03×8×31≈**7.4**；含音 0.05×8×31≈**12.4** | 嚴重低估 |
| `generate_audio` **true** | 走含音階梯 $0.05–0.08/秒 | 校準用**無音** $0.03 |
| `resolution` **720p** | 1080p 更貴 | 不送 → 720p ✓ |
| cost 寫「6 秒基準」 | 機械估點用 **5s** | 文件債 |

- 本輪**禁止**自動改 points；建議後續：明送 `duration:"4s"` 或 `"6s"` + 可選關音，或動態估點。  
- 長鏡 8s 含音約 **12 點** 成本、收 **5** → 平台倒貼。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0（修後） | **ok** |
| OpenAPI | `endpoint_id=fal-ai/veo3.1/lite` → **HTTP 200** · `Veo31LiteInput`／`Output` |
| 修前 input | `{ prompt, aspect_ratio: aspect(f) }` — **`1:1` 不在 enum** → **422 風險** |
| 修後 input | `{ prompt, aspect_ratio: f==="9:16" ? "9:16" : "16:9" }` |
| dry-run / live | 本輪未跑（無 FAL_KEY；零 --yes） |
| 結論 | **ready-static-only**（契約修齊；verified 已 true；估點 P0 未解） |

### OpenAPI 摘要（2026-08-05）

- **required**：`prompt` only（maxLength 20000）
- **order**：prompt → aspect_ratio → duration → negative_prompt → resolution → generate_audio → seed → auto_fix → safety_tolerance
- `aspect_ratio`：enum **`16:9`\|`9:16` only**，default `16:9`（**無 1:1／auto**）
- `duration`：`4s`\|`6s`\|`8s`，default **`8s`**
- `resolution`：`720p`\|`1080p`，default **720p**
- `generate_audio`：boolean，default **true**
- `negative_prompt`：string \| null（**schema 有**；站內 allowlist **未**收本 id）
- `seed`、`auto_fix`（default true）、`safety_tolerance`（default `"4"`）
- **Output**：`video`（File.url）
- metadata：lightweight cost-effective Veo 3.1 variant；category text-to-video

### 三比例

| format | 修後 body | schema |
|--------|-----------|--------|
| 16:9 | aspect_ratio `16:9` | ✅ |
| 9:16 | `9:16` | ✅ |
| 1:1 | **映射 `16:9`** | ✅ 防 422（產品：方圖專案得橫幅片） |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 家族 | Google Veo 3.1 **Lite**——旗艦物理／寫實的降本檔 |
| 站內 mechanics | 影片閉源族（`video-closed` 文字窗不可量） |
| input | 僅 prompt + 合法 aspect_ratio；不送 duration／audio／resolution → 吃 **8s + 含音 + 720p** |
| negative | schema **有**；`NEGATIVE_PROMPT_SUPPORTED` **未**列 → 禁忌只移出正向（可選 P2 加入 allowlist） |
| seed | schema 有；`SEED_SUPPORTED` 未收 |
| 中文 | 提示可；畫面內中文字卡不可靠（全影片模通病） |
| 與旗艦差 | 全價 Veo 3.1 約 $0.20–0.40/秒；Lite 720p 無音 $0.03——量產向 |

---

## 5. 站內扣點／退點

```
estimatePoints → realPricePoints(cost) → 0.03×5×31 → 5（扁平）
→ reserveQuota(5) → falSubmit("fal-ai/veo3.1/lite", { prompt, aspect_ratio })
→ 失敗 refund(5)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 三者皆 5 → 內部一致 |
| 與 fal 實帳 | **不一致風險高**（default 8s+audio）→ P0 |
| verified true | 失敗仍應 refund（勿略過） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 模型選擇器 t2v economy | ✅ | 無 needs |
| MCP／tRPC generate | ✅ | modelId 全路徑 |
| 旗艦工作流／有聲短片 recipe | ❌ 本 id | 多鎖 `veo3.1` 全價 |
| B-roll／空鏡配方 | △ | bestFor 對；pickIds 未必列本卡 |
| duration／audio UI | ❌ | 吃危險預設 |
| 1:1 專案 | △ | 強制 16:9 片 |

**MCP 陷阱**：勿送 `aspect_ratio:"1:1"`；勿假設扣 5 點＝8 秒含音實費。

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 量產 B-roll／空鏡／活動預告 | ✅ | bestFor |
| 先看節奏再上旗艦 | ✅ | 比 Fast（16 點）更省 |
| 含原生音效一次出片 | △ | 預設開音但**倒貼**；正式有聲推全價 Veo／PixVerse |
| 對外形象關鍵鏡頭 | ❌ | 走 veo3.1／Kling 旗艦 |
| 人物情緒特寫 | ❌ | Hailuo／Kling i2v |
| 畫面內中文字卡 | ❌ | 另做字卡疊加 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal OpenAPI | `…/openapi.json?endpoint_id=fal-ai/veo3.1/lite`（本輪 **200**） |
| Playground | https://fal.ai/models/fal-ai/veo3.1/lite |
| API | https://fal.ai/models/fal-ai/veo3.1/lite/api |
| 站內 | `shared/models.ts`（#112 entry／PRICE_VIDEO_SECONDS=5） |
| 生態／校準 | `docs/fal生態研究.md` Veo 3.1 Lite 列；`docs/點數校準報告.md` 4.6≈ |

---

## 9. 建議動作

- [x] **修 aspect_ratio**：僅 `16:9`\|`9:16`；`1:1`→`16:9`（防 422）
- [x] **維持** points=5、verified=true、id＝endpoint
- [ ] **P0 估點**（產品決策，本輪不改碼）：  
  - 方案 A：input 明送 `duration:"4s"` 或 `"6s"` + 可選 `generate_audio:false` 對齊 5 點  
  - 方案 B：依 duration×audio×resolution 動態估點  
  - 方案 C：提高 points 對齊 default 8s 含音（≈12）
- [ ] **文件**：cost「6 秒基準」↔ 機械 5 秒／官方 default 8s 三方對齊文案
- [ ] **可選 P2**：`NEGATIVE_PROMPT_SUPPORTED` 加入本 id（schema 有）
- [ ] **可選 P3**：UI 暴露 duration／generate_audio／resolution
- [ ] **L2 回歸**（有 KEY）：`--probe` 後單次 `--yes`（注意 8s 含音實費）
- [ ] **勿**送 `1:1`；**勿**在未修估點前宣傳「5 點＝完整 8 秒有聲 Veo」

**L0 結論**：OpenAPI 綠；1:1 422 已修；**P0** 為 default **8s+audio** 對扁平 5 點倒貼。  
**未做：** live、`--yes`、改 points／verified。
