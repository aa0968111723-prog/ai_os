# cassetteai/sound-effects-generator

> 審計：R5 · index **#235** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`cassetteai__sound-effects-generator`  
> OpenAPI **200**（本輪直拉 queue openapi）；**!needs** 但無 FAL_KEY → 零 live。  
> 目錄 **verified=true**（歷史）— **本輪不改** verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **235** |
| 站內 id | `cassetteai/sound-effects-generator` |
| endpoint | **同 id**（非 `fal-ai/` 前綴） |
| label | Cassette 音效 |
| category / kind | **text-to-audio** · audio |
| tier | **economy** |
| points（目錄） | **1** |
| cost | **`≈$0.005/次`** |
| verified | **true**（目錄既有；本輪無新 live 複驗） |
| needs | **無** |
| recommended | false |
| strengths | 1 秒生成 30 秒內音效 |
| bestFor | 批量音效試做 |
| 姊妹 | ElevenLabs SFX v2（#234 稍貴）、ACE-Step、Cassette music-generator |

**一句話**：**Cassette SFX** 極省 text→音效——required `prompt`+`duration` 綠；站內 duration=**10**；output **`audio_file`**（extract 已認）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | ≈**$0.005／次** |
| 換算 | 0.005×31≈**NT$0.16** → 扁平 **1** 為下限（略高估） |
| 時長 | duration 1–30；站內 **10**；價標「／次」→ 未必按秒 |
| `estimatePointsFor` | 扁平 **1** |

**結論：** **維持 points=1**；不自動改。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `SoundEffectsGeneratorInput` / `…Output` |
| required | **`prompt`**, **`duration`** |
| props | 僅上述兩欄 |
| output | **`audio_file`**（File）— 非 `audio` |
| extractResult | **綠**（`result.audio_file` 已支援） |
| L2 | 未跑（無 KEY） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (p) => ({ prompt: p, duration: 10 }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** required |
| `duration: 10` | **綠** 範圍 1–30 |
| 幽靈欄 | 無 text 誤送（本檔用 **prompt**，對照 EL SFX 的 text） |

### OpenAPI 對照（本輪 200）

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ | SFX 描述 |
| `duration` required int 1–30 | ✅ **10** | 未暴露 UI 旋鈕 |
| output `audio_file` | extract ✅ | 測試有覆蓋 |

**P2 產品：** duration 寫死 10——bestFor 批量試做可接受；要 1s／30s 需旋鈕。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | CassetteAI **快速 SFX**；文案「1 秒生成、30 秒內」 |
| vs EL SFX v2 | EL 用 `text`、可選 duration 0.5–22；本檔 **雙 required** prompt+duration |
| 供應商 | `cassetteai/…` 第三方 fal 上架，非 fal-ai 命名空間 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit("cassetteai/sound-effects-generator", { prompt, duration: 10 })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| ≈\$0.005 ↔ 1 | 下限高估可接受 |
| verified true | 歷史；**本輪不改** |
| !needs | 可進經濟 live（無 KEY 跳過） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | economy |
| recommended | ❌ | |
| duration UI | ❌ | 寫死 10 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 批量音效試做 | ✅ | bestFor · 極省 |
| 固定約 10s SFX | ✅ | 現況 |
| 需 1s 極短／30s 上限 | △ | 改 duration；UI 未開 |
| 品牌級 SFX | △ | → EL #234 |
| 音樂／歌曲 | ❌ | 錯類 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #235 · prompt+duration:10 |
| OpenAPI 本輪 | required 雙欄；output audio_file |
| `server/services/fal.ts` | extractResult audio_file |
| fal 模型頁 | https://fal.ai/models/cassetteai/sound-effects-generator |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [x] 確認 prompt+duration **綠**；audio_file extract **綠**  
- [x] 維持 points=1；verified 不改  
- [ ] **P2 產品：** 暴露 duration 1–30  
- [ ] **L2**（有 KEY）：短 prompt 探活複驗  

**L0 結論：** 契約完整綠；極省 SFX 定位清楚。  
**未做：** live、改 points、改 verified。
