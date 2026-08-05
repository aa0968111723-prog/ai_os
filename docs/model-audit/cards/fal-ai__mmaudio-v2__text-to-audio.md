# fal-ai/mmaudio-v2/text-to-audio

> 審計：R5 · index **#243** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__mmaudio-v2__text-to-audio`  
> OpenAPI **200**；**!needs**；R 禁 --yes → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **243** |
| 站內 id | `fal-ai/mmaudio-v2/text-to-audio` |
| endpoint | **同 id** |
| label | MMAudio V2 文字轉音 |
| category / kind | **text-to-audio** · audio |
| tier | **budget** |
| points（目錄） | **1** |
| cost | `$0.001/秒` |
| verified | **false** |
| needs | **無** |
| recommended | false |
| strengths | MMAudio 純文字版;描述即得環境音/音效 |
| bestFor | 低成本環境音床、Foley 試做 |
| 姊妹 | #242 mmaudio-v2（needs=video 影生音）、ThinkSound、Cassette SFX |

**一句話**：**MMAudio V2 T2A**——required `prompt` 綠；預設 duration **8s**；`$0.001/s` → 預設 ~NT$0.25 → points **1**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | **$0.001／秒** |
| 預設 duration | OpenAPI def **8**（1–30）→ $0.008 ≈ NT$0.25 |
| 站內 | **不送** duration → 吃預設 8s |
| 30s 上限 | $0.03 ≈ NT$0.93 → still flat1 OK |
| `estimatePointsFor` | 扁平 **1** |

**結論：** **維持 points=1**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `MmaudioV2TextToAudioInput` |
| required | **`prompt` only** |
| optional | negative_prompt、seed、num_steps、duration、cfg_strength、mask_away_clip |
| output | **`audio`** |
| L2 | **live success** · `019fd07d` |
| 結論 | **ready-live** |

### 站內 input

```ts
input: (p) => ({ prompt: p }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** |
| duration 等 | 不送 → 8s／steps25／cfg4.5 |

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ | |
| `duration` 1–30 def 8 | 未送 | 短環境音預設合理 |
| `negative_prompt` | 未送 | 未進 NEGATIVE allowlist |
| `seed` | 未送 | 未進 SEED allowlist |
| output `audio` | ✅ | |

**P2：** negative／seed／duration 未暴露。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | MMAudio **純文字** 環境音／Foley |
| vs #242 | #242 吃 **video** 對時；本檔 !needs |
| vs Cassette SFX | 同 budget 音效向；本檔 duration 預設 8s |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ falSubmit({ prompt })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| verified false | **正確** |
| !needs | 可經濟 live |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | budget |
| duration UI | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 短環境音床／Foley 試 | ✅ | bestFor |
| 對畫面同步 | ❌ | → #242 needs=video |
| 完整歌曲 | ❌ | |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #243 · input prompt |
| OpenAPI 本輪 | required prompt；duration def8 |
| fal 模型頁 | https://fal.ai/models/fal-ai/mmaudio-v2/text-to-audio |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [x] 契約綠；維持 points=1  
- [ ] L2 可選  
- [ ] P2 duration／negative／seed  

**裁決：維持**


## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd07d-1216-7210-8693-b7cc9f53c266` |
| 結果 | **success** · mp3 |
| artifact | https://v3b.fal.media/files/b/0aa514d2/jM2noPfMo_LQtF7XmmZCa_DKIfYIxo.mp3 |
| pointsEst | 1 |
| verified | **維持 false** |
