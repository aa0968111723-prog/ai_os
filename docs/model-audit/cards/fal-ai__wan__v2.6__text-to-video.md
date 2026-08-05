# fal-ai/wan/v2.6/text-to-video

> 審計：R3 · index **#116** · static+research · 2026-08-05  
> slug：`fal-ai__wan__v2.6__text-to-video`  
> **本輪已修 endpoint**：目錄 path／`wan-26` 皆 **404** → 實端點 **`wan/v2.6`**（無 `fal-ai/`、無 `/text-to-video` 後綴）。  
> **未**改 verified／points。零 live。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id | `fal-ai/wan/v2.6/text-to-video`（相容舊字串） |
| **實際 endpoint** | **`wan/v2.6`** |
| label | Wan 2.6(開源) |
| category / kind | **text-to-video** · video |
| tier | economy |
| points | **16** |
| cost | `$0.10/秒(720p)、$0.15/秒(1080p);按秒計費,點數為 6 秒基準` |
| verified | **true**（既有；本輪才證實端點） |
| needs | 無 |
| recommended | false |
| strengths | Wan 最新多模態世代;音畫一體、開源質感天花板 |
| bestFor | 正式一點又要控成本的敘事片 |
| 姊妹 | i2v `wan/v2.6/image-to-video`；r2v `wan/v2.6/reference-to-video`；2.5 t2v `fal-ai/wan-25/text-to-video` |

**一句話**：WAN 2.6 文生影片——多鏡頭智能切分、5/10/15 秒；**endpoint 極短 `wan/v2.6`**；預設 1080p 會倒貼扁平 16 點（P0）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **16** |
| `parseRealCost` | 首 `$0.10/秒` ×5s ×31 = **15.5** → **16** |
| 校準 | 15.5 ≈ |
| estimatePoints | 扁平 **16** |

### P0 估點脫鉤

| 官方 default | 5s 實費 | 站內 16 |
|--------------|---------|--------|
| `resolution` **1080p**（$0.15/秒） | ≈**23.3** | 低估 |
| `duration` **5**（可 10／**15**） | 15s@1080p≈**70** | 若暴露更糟 |
| 720p $0.10 | ≈15.5 | 與 16 對齊 |
| **無 480p** | — | 異於 2.5 |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| `fal-ai/wan/v2.6/text-to-video` | **404** |
| `fal-ai/wan-26/text-to-video` | **404**（異於 2.5 的 wan-25 模式） |
| **`wan/v2.6`** | **HTTP 200** · `V26Input`／`V26Output` |
| input | `{ prompt, aspect_ratio }` — enum 含 16:9／9:16／1:1（另 4:3／3:4 未暴露） |
| live | **未跑** |
| 結論 | **ready-static-only**（端點已修；P0 解析度） |

### OpenAPI 摘要（`wan/v2.6`）

- **required**：`prompt`  
- **order**：prompt → audio_url → aspect_ratio → resolution → duration → negative_prompt → enable_prompt_expansion → multi_shots → seed → enable_safety_checker  
- `aspect_ratio`：`16:9`\|`9:16`\|`1:1`\|`4:3`\|`3:4`，default 16:9  
- `resolution`：`720p`\|`1080p` only，default **`1080p`**（**無 480p**）  
- `duration`：`5`\|`10`\|`15`，default **`5`**  
- `multi_shots`：default **true**（需 prompt_expansion on）  
- `negative_prompt`／`seed`／`audio_url`／safety／expansion  
- **Output**：`video` + `seed` + optional `actual_prompt`  
- about：multi-shot 智能分鏡；720p/1080p；5–15s  

### 死路徑一覽

| 嘗試 | 結果 |
|------|------|
| fal-ai/wan/v2.6/text-to-video | 404 |
| fal-ai/wan-26/text-to-video | 404 |
| wan/v2.6/text-to-video | 404 |
| **wan/v2.6** | **200** |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | WAN 2.6 T2V：多鏡頭敘事、更長 15s、無 480p |
| 命名 | 異於 2.5（`fal-ai/wan-25/...`）；2.6 用 **無前綴短 id** |
| 音訊 | 可選 `audio_url` 背景樂（同 2.5 模式，非 generate_audio） |
| allowlist | **negative 已收**本 id；**seed 未收** v2.6（僅 v2.5／v2.2——可選 P2） |
| 站內 | 不送 resolution／duration／multi_shots → **1080p＋5s＋multi on** |

---

## 5. 站內扣點／退點

```
estimatePoints → 16（720p 首價機械）
→ falSubmit("wan/v2.6", { prompt, aspect_ratio })
→ 失敗 refund(16)
```

| 檢查 | 結果 |
|------|------|
| 內部一致 | 16 |
| 對 1080p 預設 | **脫鉤** ≈23 vs 16 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| t2v 選擇器 | ✅ | modelId 用目錄長 id |
| MCP | ✅ | **勿**把 `wan/v2.6` 當 modelId（getModel 失敗） |
| multi_shots／15s UI | ❌ | 吃預設 |
| seed 消融 | △ | schema 有、allowlist 無 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 開源質感敘事／多鏡頭 | ✅ | multi_shots 預設 on |
| 控成本正式一點 | △ | bestFor；但 1080p 預設成本高於扣點 |
| 最長 15s 單支 | △ | enum 有；未暴露且估點炸 |
| 480p 草稿 | ❌ | schema 無 480p → 用 2.5 |
| 有聲原生對白 | △ | 外掛 audio_url；非 Veo 級 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=wan/v2.6`（**200**） |
| Playground | https://fal.ai/models/wan/v2.6 |
| 2.5 卡 | `fal-ai__wan__v2.5__text-to-video.md`（wan-25 模式對照） |
| 生態 | slug 原 🔸推定——本輪實端點升實 |

---

## 9. 建議動作

- [x] **修 endpoint** → `wan/v2.6`  
- [x] **維持** 站內 id／points=16／verified=true／aspect 直送  
- [ ] **P0**：input 明送 `resolution:"720p"` 或動態估點（1080p／10s／15s）  
- [ ] **可選 P2**：`SEED_SUPPORTED` 加本 id  
- [ ] **可選 P3**：暴露 multi_shots／duration；strengths 澄清 audio_url  
- [ ] **L2**（有 KEY）：對 `wan/v2.6` live  
- [ ] **同步**：目錄 i2v `wan/v2.6/image-to-video` 已存在（無 fal-ai/）—審 #i2v 時對齊  

**L0 結論**：死 path 已修；契約 aspect 綠；**P0** default 1080p vs 720p 估點。  
**未做：** live、改 points。
