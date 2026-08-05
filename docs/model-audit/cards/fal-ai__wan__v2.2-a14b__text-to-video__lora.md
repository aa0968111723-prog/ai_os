# fal-ai/wan/v2.2-a14b/text-to-video/lora

> 審計：R3 · index **#128** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__wan__v2.2-a14b__text-to-video__lora`  
> OpenAPI **200**（本輪直拉）；**needs=zip** → 經濟 live 佇列不進；零 live。  
> **P1-FIXED**：無 source 時不送 `loras:[{path:undefined}]`。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **128** |
| 站內 id | `fal-ai/wan/v2.2-a14b/text-to-video/lora` |
| endpoint | **同 id** |
| label | Wan 2.2 掛 LoRA 成片 |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points（執行時） | **16**（`$0.1/秒` ×5 ×31） |
| cost | `$0.1/秒(Wan 2.2 掛 LoRA;基底 480p $0.04、580p $0.06、720p $0.08/秒);按秒計費,點數為 6 秒基準` |
| verified | **false** |
| needs | **zip**（LoRA 檔；UI 來源欄） |
| recommended | false |
| sourceHint | 訓練成果 LoRA 檔網址(.safetensors) |
| strengths | Wan 2.2 訓練成果的文生影端點;與站內主力工作流同底模 |
| bestFor | 用自家影像風 LoRA 出片(提示詞含觸發詞) |
| 姊妹 | Wan 2.2 t2v 基底、i2v、訓練器 |

**一句話**：**Wan 2.2 A14B + LoRA** 文生影——required 僅 `prompt`；LoRA 走 `loras[].path`；aspect **含 1:1**；`$0.1/s ×5 ≈ 16 點`；**needs=zip** 不可空 probe。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **16** |
| cost 首價 | **$0.1／秒**（LoRA 檔） |
| 基底對照（文案） | 480p $0.04／580p $0.06／720p $0.08／秒（無 LoRA 他端） |
| `parseRealCost` | usdMid=**0.1** · multiplier=`PRICE_VIDEO_SECONDS`=**5** |
| `realPricePoints` | `0.1 × 5 × 31 = 15.5` → **round 16** |
| 預設解析 | OpenAPI resolution def **720p** |
| 預設幀 | num_frames **81** · fps **16**（+ film 插幀 def 1 → 有效 fps 可×2） |
| cost「6 秒基準」 | **P2** vs 機械 ×5 |

### 校準對照

| 設定 | USD | NT$ | vs 16 點 |
|------|-----|-----|----------|
| **5s × $0.1（LoRA 錨）** | 0.50 | 15.5 | **≈** |
| 6s × $0.1（文案） | 0.60 | 18.6 | 文案略高 |
| 5s × $0.08（若只吃 720p 基底價） | 0.40 | 12.4 | 則 16 偏高 |
| 長幀 161 | 更高 | | 扁平 16 **低估** |

**結論：** **維持 points=16**；對齊 LoRA 首價 ×5。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok**（needs=zip） |
| fal OpenAPI | **200** `WanV22A14bTextToVideoLoraInput`／Output |
| about | text→video **with LoRA support** |
| required（schema） | **`prompt` only**（loras **非** formal required，def `[]`） |
| 產品 required | **needs=zip** → 無 LoRA 不應出隊 |
| output | **`video`** + seed（+ prompt 回顯） |
| L2 | 未跑（needs；無 KEY） |
| 結論 | **ready-static-only**（需素材） |

### 站內 input（本輪 P1-FIXED）

```ts
input: (p, f, s) => ({
  prompt: p,
  aspect_ratio: aspect(f),
  ...(s ? { loras: [{ path: s, scale: 1 }] } : {}),
}),
```

| format | aspect | OpenAPI |
|--------|--------|---------|
| 16:9 | `"16:9"` | ✅ |
| 9:16 | `"9:16"` | ✅ |
| 1:1 | `"1:1"` | ✅ **綠** |

| 欄 | 站內 | 官方 | 備註 |
|----|------|------|------|
| prompt | ✅ | required | 應含觸發詞 |
| aspect_ratio | ✅ 三比例 | 16:9｜9:16｜**1:1** | **健康** |
| loras[].path | ✅ via source | LoRAWeight required path | URL／HF／safetensors |
| loras[].scale | **1** | 0–4 def 1 | |
| loras[].transformer | 未送 | def **high** | high/low/both |
| resolution | 未送 | def **720p** | 480/580/720 |
| 無 source | 不送 loras | def [] | **修後**；修前 path:undefined |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **loras**: `LoRAWeight[]`，def `[]`；每項 **path** required；scale／transformer／weight_name
- **aspect_ratio**: `16:9`｜`9:16`｜`1:1`，def `16:9`
- **resolution**: `480p`｜`580p`｜`720p`，def **`720p`**
- **num_frames**: 17–161，def **81**
- **frames_per_second**: 4–60，def **16**
- **acceleration**: none｜regular，def regular
- **interpolator**: none｜film｜rife，def film；num_interpolated_frames def 1
- **output**: video + seed

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 站內 **Wan 2.2 訓練 → 推論** 閉環的 t2v 出口 |
| vs 基底 t2v | 同家族無 LoRA 更便宜；本檔吃 **$0.1/s** |
| needs=zip | UI 類型；path 實為 **URL 字串**（.safetensors 亦可） |
| 觸發詞 | 產品責任；schema 不驗證 |

---

## 5. 站內扣點／退點

```
realPricePoints → 16
→ reserveQuota(16)
→ falSubmit("…/wan/v2.2-a14b/text-to-video/lora",
            { prompt, aspect_ratio, loras:[{path, scale:1}] })
→ 失敗 refund(16)
```

| 檢查 | 結果 |
|------|------|
| 16 ≈ $0.1×5×31 | **對齊** |
| needs=zip | 空 probe **拒**（正確） |
| verified false | **正確**（無 live） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-video | ✅ | 需來源 LoRA |
| 來源欄 | ✅ | sourceHint safetensors |
| 無 LoRA 純文 | ❌ | 應走基底 Wan 2.2 t2v |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 自家影像風 LoRA 出片 | ✅ | bestFor |
| 無 LoRA 草稿 | ❌ | → `…/text-to-video` 基底 |
| 1:1 方片 | ✅ | aspect 綠 |
| 最長幀省錢 | △ | 扁平 16 不利長片 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #128 · needs=zip · loras path · **P1 空 path 不送** |
| OpenAPI 本輪 | prompt required；loras 可選；aspect 含 1:1；def 720p |
| fal 模型頁 | https://fal.ai/models/fal-ai/wan/v2.2-a14b/text-to-video/lora |

---

## 9. 建議動作

- [x] 升 stub→九章；OpenAPI 直核  
- [x] 確認 aspect **全綠**、loras 結構對  
- [x] **P1-FIXED**：無 s 不送髒 loras  
- [x] **維持** points=16／verified false  
- [ ] **P2：** cost「6 秒」→5；可選鎖 resolution 對價  
- [ ] **P2：** needs=zip vs .safetensors URL 文案對齊  
- [ ] L2：有 KEY + 真實 LoRA URL 再人工 verified  

**裁決：維持＋P1 髒 payload 已修**（needs 正確；零 live）
