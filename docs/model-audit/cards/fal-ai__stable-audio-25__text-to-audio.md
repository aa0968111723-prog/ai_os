# fal-ai/stable-audio-25/text-to-audio

> 審計：R5 · index **#232** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__stable-audio-25__text-to-audio`  
> OpenAPI **200**（本輪直拉 queue openapi）；**!needs** 但無 FAL_KEY → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **232** |
| 站內 id | `fal-ai/stable-audio-25/text-to-audio` |
| endpoint | **同 id** |
| label | Stable Audio 2.5 |
| category / kind | **text-to-audio** · audio |
| tier | **flagship** |
| points（目錄） | **6** |
| cost | **`$0.20/次`** |
| verified | **false** |
| needs | **無** |
| recommended | false |
| strengths | 長度與參數控制精細;音樂+音效兼修 |
| bestFor | 指定長度的配樂段落 |
| 姊妹 | Lyria2（#230）、ElevenLabs Music（#231）、#245 stable-audio（舊）、MiniMax Music |
| 情境 | 要 **可控秒數** 的配樂／音效段落 |

**一句話**：**Stable Audio 2.5** 旗艦 text→audio——required `prompt` 綠；站內固定 `seconds_total: 30`；\$0.20/次≈6 點。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **6** |
| cost | **$0.20／次**（flat） |
| 換算 | 0.20×31≈**NT$6.2** → 與 **6** **≈ 對齊** |
| 時長 | 站內鎖 **30s**；OpenAPI 預設 **190**、範圍 1–190 |
| 動態估點 | flat 按次 → **不**隨時長變（與 EL Music 按分不同） |
| `estimatePointsFor` | 扁平 **6** |

**結論：** **維持 points=6**。若日後開放長至 190s 仍 \$0.20/次則划算；若上游改按秒計需重校。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `StableAudio25TextToAudioInput` / `…Output` |
| required | **`prompt` only** |
| props | `prompt`, `seconds_total`, `seed`, `sync_mode`, `guidance_scale`, `num_inference_steps` |
| output | **`audio`** + **`seed`** |
| L2 | 未跑（無 KEY） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (p) => ({ prompt: p, seconds_total: 30 }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** required |
| `seconds_total: 30` | **綠** 範圍內（1–190）；**覆寫**官方預設 190 |
| guidance / steps / seed | 不送 → 預設 guidance=1、steps=8 |
| 幽靈欄 | 無 |

### OpenAPI 對照（本輪 200）

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ | |
| `seconds_total` default **190** min1 max190 | ✅ **30** | 產品選短段；控延遲／體感 |
| `guidance_scale` 1–25 def1 | 未送 | |
| `num_inference_steps` 4–8 def8 | 未送 | 上限僅 8 |
| `seed` / `sync_mode` | 未送 | |
| output audio+seed | extract 認 audio ✅ | |

**P2 產品：** UI 未暴露秒數旋鈕（寫死 30）— bestFor「指定長度」與固定 30 **略張力**。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | Stability **Stable Audio 2.5**；音樂＋音效 |
| vs Lyria2 | Lyria schema **無**時長；本檔有 `seconds_total` |
| vs EL Music | EL 授權歌曲高價；本檔 \$0.20/次中價可控長 |
| vs 舊 stable-audio | 目錄另有 #245 等舊端點；2.5 為現 flagship 路徑 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 6
→ reserveQuota(6)
→ falSubmit("fal-ai/stable-audio-25/text-to-audio", { prompt, seconds_total: 30 })
→ 失敗 refund(6)
```

| 檢查 | 結果 |
|------|------|
| \$0.20/次 ↔ 6 | **≈** |
| 固定 30s vs 可 190s | 產品選擇；價仍 flat 則加長不加点 |
| verified false | **正確** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | flagship |
| recommended | ❌ | |
| 秒數 UI | ❌ | 寫死 30 |
| guidance／steps | ❌ | 未送 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 指定約 30s 配樂段落 | ✅ | 現況 bestFor 實作 |
| 需 1–3 分鐘床景 | △ | 可改 seconds_total 至 190；UI 未開 |
| 音效 SFX 短句 | ✅ | 音樂+音效兼修 |
| 版權敏感對外歌 | △ | → EL Music |
| 極省 demo 歌 | ❌ | → MiniMax Music |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #232 · prompt+seconds_total:30 · 6 點 |
| OpenAPI 本輪 | required prompt；seconds 1–190 def190 |
| fal 模型頁 | https://fal.ai/models/fal-ai/stable-audio-25/text-to-audio |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [x] 確認 prompt+30s **綠**；價↔6 ≈  
- [x] 維持 points=6；verified=false  
- [ ] **P2 產品：** 暴露 `seconds_total`（對齊 bestFor「指定長度」）  
- [ ] **L2**（有 KEY）：短 prompt 30s 探活  

**L0 結論：** 契約綠；價點對齊；秒數產品層與文案可再貼。  
**未做：** live、改 points、改 verified、改預設秒數。
