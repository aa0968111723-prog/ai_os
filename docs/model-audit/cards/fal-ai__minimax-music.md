# fal-ai/minimax-music

> 審計：R5 · index **#233** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__minimax-music`  
> OpenAPI **200**（本輪直拉 queue openapi）；**needs=audio** → 探測模式不受理；零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **233** |
| 站內 id | `fal-ai/minimax-music` |
| endpoint | **同 id** |
| label | MiniMax Music |
| category / kind | **text-to-audio** · audio |
| tier | **economy** |
| points（目錄） | **1** |
| cost | `$0.03/首` |
| verified | **false**（`models.ts`；index 舊值 true 視為過期） |
| needs | **audio**（`reference_audio_url`） |
| recommended | **true** |
| strengths | 參考曲風格遷移的完整歌曲(可含人聲);需>15s 樣曲 |
| bestFor | 有參考曲的主題曲 demo、風格遷移配樂 |
| sourceHint | 參考歌曲網址(.wav/.mp3，須長於 15 秒，含音樂與人聲) |
| 姊妹 | MiniMax Music v2／v2.6、Lyria2、ElevenLabs Music |
| 情境 | 經濟配樂＋風格遷移；**非**純文字即曲 |

**一句話**：**MiniMax Music** 歌詞／提示＋**必填參考曲**——OpenAPI required `prompt`+`reference_audio_url`；**$0.03/首 → points=1**；站內 `needs=audio` 正確。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | **$0.03/首** |
| USD→TWD | 0.03 × 31 ≈ **NT$0.93** |
| 校準 | flat **1** ≈ 一次成曲；**維持** |
| `estimatePointsFor` | 扁平 **1** |

**結論：** **維持 points=1**；明碼價貼最低檔。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok**（models.ts needs=audio） |
| fal OpenAPI | **200** `MinimaxMusicInput` / `MinimaxMusicOutput` |
| required | **`prompt` + `reference_audio_url`** |
| optional | （無其他 props） |
| prompt 約束 | maxLength **600**；歌詞格式（`##` 伴奏、換行分句） |
| reference | .wav/.mp3 · **>15s** · 應含音樂與人聲 |
| output | **`audio`**（File；例 mp3） |
| L2 | 未跑（needs=audio；verify-models 拒絕） |
| 結論 | **ready-static-only**（需素材；站內實測） |

### 站內 input

```ts
input: (p, _f, s) => ({ prompt: p, reference_audio_url: s }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** required |
| `reference_audio_url` | **綠** required ← source |
| 幽靈欄 | 無 |

### OpenAPI 對照（本輪 200）

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ | 歌詞／描述 ≤600 |
| `reference_audio_url` required | ✅ via `needs=audio` | 缺則 422 |
| output `audio` | extract 認 ✅ | |

### thin／index 漂移（本輪發現）

| 來源 | needs | verified |
|------|-------|----------|
| **models.ts（真相）** | **audio** | **false** |
| models-index.json | null（舊） | true（舊） |
| 前序 thin card | 無 | true |

**P1 文件：** 重跑 `gen-model-docs`／重建 index 可消漂移；**不**在本輪改 points／verified。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 參考曲 **風格遷移** 完整歌曲（可含人聲） |
| vs Lyria2 | Lyria **!needs** 純 prompt 30s 器樂；本檔 **要樣曲** |
| vs MiniMax v2 | 同族迭代；本檔為 recommended 經濟入口 |
| 無樣曲 | 不可走 probe；應改用 Lyria／Stable Audio／ACE-Step 等 !needs |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/minimax-music", { prompt, reference_audio_url })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| flat 1 vs $0.03 | **對齊** |
| needs=audio | 經濟 live 佇列 **不進**（正確） |
| verified false | **正確**（無本輪 live） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | economy · recommended |
| 來源欄 | ✅ | sourceHint 參考曲 |
| probe --yes | ❌ | needs 擋 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 有 >15s 樣曲做風格 demo | ✅ | bestFor |
| 純文字即 BGM（無參考） | ❌ | → Lyria2／ACE-Step／Stable Audio |
| 長歌詞 | △ | prompt ≤600 字 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #233 · needs=audio · input prompt+ref · points=1 · verified false · recommended |
| OpenAPI 本輪 | required prompt + reference_audio_url |
| fal 模型頁 | https://fal.ai/models/fal-ai/minimax-music |
| 前序 thin | bulk 誤標 needs 無／verified true |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核
- [x] 確認 **needs=audio** 與 models.ts 一致（thin／index 漂移記 P1）
- [ ] 站內以 >15s 參考曲實測後再人工 verified
- [x] **維持** points=1／endpoint／input；**不**自動改 verified

**裁決：維持**（契約綠；needs 正確；深卡完成）
