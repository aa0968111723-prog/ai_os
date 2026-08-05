# fal-ai/dia-tts/voice-clone

> 審計：R5 · index **#225** · static+research · 2026-08-05（升 thin→九章）  
> slug：`fal-ai__dia-tts__voice-clone`  
> OpenAPI 本輪網路 **reset**；沿用 B9 直核 **200** `DiaTtsVoiceCloneInput` required **`["text"]` only**。  
> **!needs**（B9 已去 audio）；無 FAL_KEY → 零 live。  
> **P0 契約已修**（broken P0-FIXED）；**未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **225** |
| 站內 id | `fal-ai/dia-tts/voice-clone` |
| endpoint | **同 id**（真 path；alt `dia/voice-clone`／`nari-labs/…` → **404**） |
| label | Dia 語音克隆 |
| category / kind | **text-to-speech** · audio（fal metadata 曾標 **audio-to-audio**） |
| tier | **economy** |
| points（目錄） | **2** |
| cost | `≈同 Dia $0.04/千字` |
| verified | **false** |
| needs | **無**（公開 schema 不收樣音；models.ts B9 已去 `needs: audio`） |
| recommended | false |
| strengths | ⚠OpenAPI 僅 text、無樣音欄；**非真 zero-shot 克隆**（等同 Dia TTS 變體）;英文情境為主 |
| bestFor | 英文短劇對話 TTS（**勿當**會方中文樣音克隆） |
| 姊妹 | `fal-ai/dia-tts`（#213，純對話 text-only）、Qwen／MiniMax 真克隆 |
| 情境 | **未**入 sc-voice-clone（合理）；多人對談軸用 #213 Dia 作 runner-up，非本 path |

**一句話：** path 存活；**行為等同 Dia TTS 變體（僅 text→audio）**；產品名「克隆」與公開 schema **不符**——勿當中文樣音克隆。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **2** |
| cost | ≈同 Dia **$0.04／千字**（clone 路徑未另標價） |
| vs #213 | 同價帶；#213 cost 明示 `$0.04/千字`；本檔 `≈同 Dia` |
| 動態估點 | cost 含「千字」→ `estimatePoints` 有 `promptChars` 時按字；無字數退回扁平 **2** |
| 校準 | 短稿動態常 **1**；中長稿 ≈2；超長稿可 >2 → 扁平 UI 與實扣可能落差（**P2** 同 Dia 系） |
| `estimatePointsFor` | 扁平 **2**（無 ctx） |

**結論：** **維持 points=2**；不自動改。長稿動態估點與 UI 扁平差待 B9 估點統一。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok**（只送 `text`；曾 needs=audio+幽靈 ref → **P0-FIXED**） |
| fal OpenAPI | **200**（B9）`DiaTtsVoiceCloneInput` |
| required | **`text` only** |
| props | **`text`**（無 `ref_audio_url`／`audio_url`／`reference_*`） |
| output | `audio`（File） |
| metadata | about「Voice Clone」；category 曾 **audio-to-audio**（與站內 TTS 標籤略張力） |
| L2 | 未跑（無 KEY；且非真克隆優先度低） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
// 審計 B9：OpenAPI path 真（200）· required 僅 text（無樣音欄）
input: (p) => ({ text: p }),
```

| 檢查 | 結果 |
|------|------|
| `text` | **綠** required |
| 樣音欄 | **無** — 不得送 ref／audio_url |
| needs | **無** — 生成台不強制上傳音訊 |
| vs #213 | Input **同構**（僅 text） |
| 幽靈欄 | 已刪 `ref_audio_url` |

### 產品名落差

- label 仍「Dia **語音克隆**」但公開 schema **無 reference audio**。  
- learn／marketing 若寫 zero-shot 克隆 → **與 schema 矛盾**（broken 已註）。  
- 若日後官方補樣音欄 → 需再 live 對帳後改 input／needs（**禁止**未 live 就 verified true）。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | Dia 1.6B 系 **dialogue TTS** 的 voice-clone **路徑變體**；公開契約＝純 TTS |
| vs #213 | 同 required text；#213 角色＝多人對談 runner-up；本檔＝誤名「克隆」檔 |
| vs 真克隆 | MiniMax voice-clone、Qwen-3 clone-voice → 需樣音；本檔 **不進** sc-voice-clone |
| 腳本 | 建議仍用 **`[S1]`／`[S2]`** 與非語言標記（同 Dia） |
| 語種 | **英文主場**；中文樣音／旁白 → Qwen／MiniMax／Kokoro |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 2（無字數）或 max(1, round(0.04×rate×chars/1000))
→ reserveQuota(est)
→ falSubmit("fal-ai/dia-tts/voice-clone", { text })
→ 失敗 refund(est)
```

| 檢查 | 結果 |
|------|------|
| flat 2 vs 千字動態 | **P2**（短稿可能實扣 1） |
| verified false | **正確**（無 live；且非真克隆） |
| needs 已去 | 不擋 !needs 探活路徑（仍零 live） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 TTS | ✅ | economy；標籤易誤導「克隆」 |
| sc-voice-clone | ❌ | pick＝MiniMax／Qwen 1.7b |
| 多人對談 showdown | ❌ | runner-up 用 #213 非本 path |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 英文短劇／雙人對話 TTS | ✅ | 等同 Dia；自備 `[S1]`/`[S2]` |
| 會方中文樣音克隆 | ❌ | → MiniMax／Qwen clone |
| 固定旁白聲線（授權） | ❌ | 非真克隆 |
| 低成本英文對話草稿 | ✅ | points=2／$0.04 千字 |
| 當 audio-to-audio 管線 | △ | metadata 曾標 a2a；契約無音訊入 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #225 · B9 註解 · input 僅 text |
| OpenAPI（B9） | `DiaTtsVoiceCloneInput` required=`[text]` |
| `docs/model-audit/broken.json` | **P0-FIXED** 幽靈 needs/ref |
| 姊妹卡 | #213 `fal-ai__dia-tts.md` |
| fal 模型頁 | https://fal.ai/models/fal-ai/dia-tts/voice-clone |
| models-index | 曾殘 `needs=audio` → **本輪對齊 null** |

---

## 9. 建議動作

- [x] 升 thin→完整九章（5–7 展開）  
- [x] 確認 P0 text-only 已修、broken FIXED  
- [x] 維持 points=2；verified=false  
- [x] models-index `needs` 對齊 models.ts（null）  
- [ ] **P2 產品**：label 改「Dia TTS（clone 路徑）」免誤導  
- [ ] **P2**：千字動態估點 vs UI 扁平 2  
- [ ] **L2**（有 KEY）：短 `[S1]` 英文稿探活（**仍勿**當克隆驗收）  
- [ ] 若官方補 ref 欄 → 再核 schema 後才恢復 needs/input  

**L0 結論：** 契約綠（text-only）；**非真克隆**標註清楚；估點／標籤待打磨。  
**未做：** live、改 points、改 verified、恢復樣音欄。

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd08c-d1bc-7c32-b40d-47f5656fbe62` |
| 結果 | **failed 422** missing `ref_audio_url` + `ref_text` |
| 站內 input | 僅 `{ text }` · needs=null |
| **P0** | 應 `needs=audio` + input 補 ref_audio_url/ref_text（或改 endpoint 真僅 text） |
| verified | **維持 false** |
