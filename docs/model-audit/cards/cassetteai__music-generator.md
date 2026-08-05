# cassetteai/music-generator

> 審計：R5 · index **#241** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`cassetteai__music-generator`  
> OpenAPI **200**；**!needs**；R 禁 --yes → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **241** |
| 站內 id | `cassetteai/music-generator` |
| endpoint | **同 id**（`cassetteai/` 第三方） |
| label | Cassette 音樂 |
| category / kind | **text-to-audio** · audio |
| tier | **budget** |
| points（目錄） | **1** |
| cost | `$0.02/輸出分鐘`（**推定**） |
| verified | **false** |
| needs | **無** |
| recommended | false |
| strengths | 極快極便宜的純器樂;一次生十版讓組員挑 |
| bestFor | 批量候選背景樂、短片墊底樂 |
| 姊妹 | Cassette SFX、ACE-Step、Stable Audio、Sonilo |

**一句話**：**Cassette 音樂** 極省器樂——required `prompt`+`duration`；站內 **duration=60**；output **`audio_file`**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | 推定 **$0.02／輸出分鐘** |
| 站內 60s | ≈$0.02 ≈ NT$0.62 → flat **1** 可 |
| duration 範圍 | **10–180** s |
| 180s | ≈$0.06 ≈ NT$1.9 → flat1 略低估 **P2** |
| `estimatePointsFor` | 扁平 **1** |

**結論：** **維持 points=1**（推定價；預設 60s 可）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `MusicGeneratorInput` / `…Output` |
| required | **`prompt` + `duration`** |
| output | **`audio_file`**（非 `audio`） |
| extract | 應認 `audio_file`（同 Cassette SFX） |
| L2 | **live success** · `019fd07b` |
| 結論 | **ready-live**（本輪 success；verified 維持 false） |

### 站內 input

```ts
input: (p) => ({ prompt: p, duration: 60 }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** |
| `duration: 60` | **綠** 10–180 |
| 幽靈欄 | 無 |

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ | |
| `duration` required int 10–180 | ✅ **60** | |
| output `audio_file` | extract 應 ✅ | |

**P2：** duration 寫死 60；strengths「一次生十版」API 無 batch 欄——文案誇飾。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 極快極省 **純器樂** 候選 |
| vs Cassette SFX | SFX 用 duration 1–30；本檔 10–180 音樂 |
| vs ACE-Step | 同 budget；欄位 tags vs prompt+duration |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ falSubmit({ prompt, duration: 60 })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| verified false | **正確** |
| !needs | 可進經濟 live |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | budget |
| duration UI | ❌ | 寫死 60 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 短片 1 分鐘墊底樂 | ✅ | bestFor |
| 批量多版 | △ | 需多次呼叫；非單次十版 API |
| 完整帶詞歌 | ❌ | 器樂向 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #241 · prompt+duration60 |
| OpenAPI 本輪 | required 雙欄；audio_file |
| fal 模型頁 | https://fal.ai/models/cassetteai/music-generator |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [x] 契約綠；維持 points=1  
- [ ] L2 可選  
- [ ] **P2：** duration 旋鈕；strengths 文案對齊 API  

**裁決：維持**

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd07b-e1ba-7a53-96e1-076140633396` |
| 結果 | **success** · wav |
| artifact | https://v3b.fal.media/files/b/0aa514c9/rs5-jn9vagd2d5HL4rDnZ_generated.wav |
| pointsEst | 1 |
| verified | **維持 false** |
