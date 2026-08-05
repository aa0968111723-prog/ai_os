# fal-ai/thinksound

> 審計：R5 · index **#246** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__thinksound`  
> OpenAPI **200**；**needs=video** → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **246** |
| 站內 id | `fal-ai/thinksound` |
| endpoint | **同 id** |
| label | ThinkSound 影生音效 |
| category / kind | **text-to-audio** · audio |
| tier | **economy** |
| points（目錄） | **2** |
| cost | 官方價未查到(同型約 `$0.05/次`) |
| verified | **false** |
| needs | **video** |
| recommended | false |
| strengths | 帶推理的影生音效;可用提示詞引導要什麼聲音 |
| bestFor | 指定「只要木魚聲與誦經迴響」式的音效方向 |
| sourceHint | 要配音效的影片網址 |
| 姊妹 | MMAudio V2、Hunyuan Foley |

**一句話**：**ThinkSound** 影生音——required 僅 **`video_url`**；`prompt` 可選（空則從影片推）；output **video**（嵌音）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **2** |
| cost | 未明碼；同型約 $0.05 ≈ NT$1.6 → **2** 可 |
| `estimatePointsFor` | 扁平 **2** |

**結論：** **維持 points=2**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `ThinksoundInput` |
| required | **`video_url` only** |
| optional | `prompt` def ""、seed、steps def24、cfg def5 |
| output | **`video` + `prompt`**（回傳實際用 prompt） |
| L2 | 未跑（needs） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (p, _f, s) => ({ prompt: p, video_url: s }),
```

| 檢查 | 結果 |
|------|------|
| `video_url` | **綠** required |
| `prompt` | 可選；站內有送 ✅ |

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `video_url` required | ✅ | |
| `prompt` optional | ✅ 有送 | 空亦可 |
| output `video` | ⚠ kind=audio | 同 MMAudio **P2** |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 推理式影生音效；prompt 引導「要什麼聲」 |
| vs MMAudio | 類似；本檔 prompt 可空自動抽 |
| vs Foley | 混元更旗艦 Foley |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 2
→ falSubmit({ video_url, prompt })
→ 失敗 refund(2)
```

| 檢查 | 結果 |
|------|------|
| needs=video | 不進經濟 live |
| verified false | **正確** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 | ✅ | 來源影片 |
| probe | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 指定音效方向的片 | ✅ | bestFor |
| 無片 | ❌ | → 純文 T2A |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #246 · needs=video |
| OpenAPI 本輪 | required video_url |
| fal 模型頁 | https://fal.ai/models/fal-ai/thinksound |

---

## 9. 建議動作

- [x] 升 stub→完整九章  
- [x] 契約綠；維持 points=2  
- [ ] P2 kind vs output video  
- [x] **不**改 verified  

**裁決：維持**
