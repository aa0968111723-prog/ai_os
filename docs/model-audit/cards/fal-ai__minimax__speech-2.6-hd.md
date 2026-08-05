# fal-ai/minimax/speech-2.6-hd

> 審計：R5 · index **216** · static+research · 2026-08-05  
> slug：`fal-ai__minimax__speech-2.6-hd` · 單一真相：`shared/models.ts`  
> **本輪已修 input**（`text`→`prompt` + `output_format:"url"` 防 422／防 hex）；**未**改 verified／points。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id | `fal-ai/minimax/speech-2.6-hd` |
| label | MiniMax Speech 2.6 HD |
| category | `text-to-speech` |
| tier | flagship |
| kind | audio |
| verified | **false** |
| needs | 無（免來源；純文生語音） |
| recommended | false |
| endpoint | 同 id（無 alias） |
| strengths | MiniMax 最新旗艦;情感/停頓/語氣控制最完整,300+ 聲線 |
| bestFor | 見證故事、開示重配的中文旁白首選 |
| 供應商／底層 | MiniMax **Speech 2.6 HD** via fal.ai（02 HD 升級代） |

**一句話**：中文旁白情感旗艦——300+ 聲線＋emotion／停頓標記；站內「中文最自然/情感」showdown **winner**；本輪修齊 OpenAPI 必填欄後可 ready-static-only。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **3** |
| cost | `推估同 02 HD 約 $0.10/千字` |
| 官方價與單位 | 生態／清查對齊 02 HD **$0.10／千字**（2.6 頁面定價多被擋；目錄標 ⚠︎ 推估） |
| 匯率 | USD×31 ≈ NT$ |
| 估值 | 1000 字 ≈ $0.10 × 31 = **NT$3.1** → 扁平 3 點對齊「約千字」 |
| 動態估點 `estimatePoints` | cost 字串含 `$0.10/千字` → `ttsUsdPerKChar` 命中 → 有 `promptChars` 時 `max(1, round(0.10×rate×chars/1000))` |
| `parseRealCost`／校準表 | usdMid=0.100；「/千字」→ **需人工**（表列不改扁平）；動態路徑才是真扣點 |
| 校準判定 | **≈**（扁平 3≈千字緩衝；短稿動態常 1 點） |

**結論：** **維持 points=3**；勿因「需人工」誤改。動態按字已覆蓋長／短稿。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0（修後） | **ok** |
| OpenAPI Queue | `endpoint_id=fal-ai/minimax/speech-2.6-hd` → **HTTP 200** |
| 修前 input | `{ text: p }` → **缺 required `prompt`** → **422 風險**；且與 02-hd schema 不同 |
| 修後 input | `{ prompt: p, output_format: "url" }` |
| dry-run / live | 本輪**未**跑（無 FAL_KEY；零 --yes） |
| 結論 | **ready-static-only**（契約已修；verified 仍 false 待 L2） |

### OpenAPI 摘要（2026-08-05）

- **Input** `MinimaxSpeech26HdInput`  
  - **required：`prompt` only**（**不是** `text`——對照 `speech-02-hd` 仍為 `text`）  
  - order：prompt → voice_setting → audio_setting → language_boost → output_format → pronunciation_dict → normalization_setting  
  - `prompt`：string 1–10000；段落換行；停頓標記 `<#x#>`（x∈[0.01,99.99] 秒）  
  - `voice_setting` default：`{ voice_id: "Wise_Woman", pitch:0, speed:1, vol:1, english_normalization:false }`  
    - emotion：happy|sad|angry|fearful|disgusted|surprised|neutral  
    - voice_id 例：Wise_Woman、Deep_Voice_Man、Calm_Woman、Abbess…  
  - `output_format`：**default `hex`**｜`url` —— 站內 `extractResult` 認 `audio.url` → **必須送 `url`**  
  - `language_boost`：Chinese、Chinese,Yue、English…  
  - `audio_setting`：sample_rate／bitrate／format(mp3|pcm|flac)／channel  
  - `pronunciation_dict.tone_list`：中文拼音校正例 `['燕少飞/(yan4)(shao3)(fei1)']`  
  - `normalization_setting`：響度正規化（default enabled）  
- **Output** `MinimaxSpeech26HdOutput`：required `audio`（File）+ `duration_ms`  
- metadata category：`text-to-speech`；about：Text To Speech 2 6 Hd  

### 對照 speech-02-hd

| | 02 HD | 2.6 HD |
|--|-------|--------|
| required 文本欄 | **`text`** | **`prompt`** |
| 站內 input（02） | `{ text: p }` | 修後 `{ prompt, output_format:"url" }` |
| 價位敘事 | $0.10/千字 已查證 | 推估同 02 |

---

## 4. 底層邏輯

### 4.1 產品

- MiniMax 最新 HD TTS；中文（國語／可 boost 粵語）主場；情感／停頓／語氣最完整敘事。  
- 內建聲線例 17+ 公開於 schema examples；生態稱 300+（完整列表在 MiniMax 控制台，fal 未全列 enum）。  
- 姊妹：`speech-02-hd`（成熟旗艦）、`voice-clone`、`voice-design`。

### 4.2 官方 vs 站內（修後）

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ 已送 | **本輪修復** |
| `output_format` default hex | ✅ 強制 `url` | 否則 extract 無 url |
| `voice_setting` 可選 | ❌ 未暴露 | 吃 Wise_Woman 預設 |
| emotion／speed／pitch | ❌ | 產品債 P3 |
| language_boost | ❌ | 中文預設尚可；粵語未 boost |
| pronunciation_dict | ❌ | 佛學術語破音未接 |
| `<#x#>` 停頓 | 使用者可寫入 prompt | 無 UI 引導 |

- 世界觀：**TTS 不注入** WORLDVIEW（避免把基調字唸出聲）——正確。  
- 無 negative／seed 語意。

### 4.3 風險

1. **修前 422**：送 `text` 缺 `prompt`——**已修**。  
2. **hex 輸出**：預設 hex 時站內可能拿不到媒體 URL——**已強制 url**。  
3. **預設聲線 Wise_Woman**：旁白調性未必「莊嚴長者」——可選 P3 換 default 或 UI 選聲。  
4. **cost 推估**：價簽未親驗 2.6 專頁；與 02 同 $0.10 假設——L4 帳單抽樣。  
5. **verified false**：自動選模／operational ready 受限——待 live。

---

## 5. 站內扣點／退點

```
prepare → estimatePoints(model, { promptChars, usdToTwdRate })
  → ttsUsdPerKChar 自 cost 擷取 $0.10/千字
  → est = max(1, round(0.10×rate×chars/1000))  // 有字數
  → 無字數 → 扁平 3
→ reserveQuota(…, est) → falSubmit → 失敗 refund(est)
```

| 檢查 | 結果 |
|------|------|
| 顯示 | 目錄 3；有稿時 UI 估點隨字數 |
| 扣／退 | 同 est → 對稱 |
| 工作流最壞 | TTS 步常以長稿上限估總點（既有邏輯） |
| BYOK | 可略過平台扣點 |

**一致性：** 架構 ok。未 live 對帳 fal 字元計數（含 `<#x#>` 標記是否計費）。

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填 | 使用者旁白稿 → `prompt` |
| 欄位名 | **`prompt`**（異於 02-hd／ElevenLabs／Dia 的 `text`；異於 Kokoro 的 `prompt`+voice） |
| 長度 | maxLength **10000** |
| 停頓 | 稿內 `<#0.5#>` 等（夾在可讀片段之間，不可連續） |
| needs | 無 |
| 注入 | 無世界觀／卡片錨點 |

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|:----:|------|
| 見證故事／開示重配中文旁白 | ✅ 首選 | bestFor；showdown「中文最自然/情感」**winner** |
| 長篇朗讀情感起伏 | ✅ | 2.6 情感控制敘事 |
| 佛學術語密集／對嘴時長 | △ | 咬字軸 winner 為 Index TTS 2；本卡次之／情感向 |
| 日常短旁白省點 | △ | 可；Turbo 2.5／Kokoro 更省 |
| 多語版本 | △ | language_boost 未暴露；EL Multilingual 更對位 |
| 英文雙人短劇 | ❌ | 走 Dia／VibeVoice／EL |
| 克隆會方專屬聲 | ❌ 本端點 | `minimax/voice-clone` |
| 助手自動選 | △ | verified=false 限制 operational ready |
| 手動選模 | ✅ | flagship TTS 列表 |

bestFor **恰當**。playbook 部分情境仍鎖 02-hd——可選將見證線升 2.6。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/minimax/speech-2.6-hd`（200） |
| Playground | https://fal.ai/models/fal-ai/minimax/speech-2.6-hd |
| API | https://fal.ai/models/fal-ai/minimax/speech-2.6-hd/api |
| 站內 | `shared/models.ts`；recipes `sc-*` pickIds 含本 id；`STYLE_SHOWDOWNS` 中文情感 winner |
| 生態 | `docs/fal生態研究.md`、`docs/模型目錄.md`、`docs/點數校準報告.md` |
| MCP | 同 `submitGenerationCore`；傳 modelId 全路徑；稿入 prompt 即可 |
| **MCP 陷阱** | 勿送 `text`（2.6 會 422）；勿期望預設 hex 回傳可下載 URL |

---

## 9. 建議動作

- [x] **修 input**：`text` → **`prompt`** + **`output_format: "url"`**（本輪；防 422／防 hex）
- [x] **維持** points=3、cost 推估字串、verified=false、id＝endpoint
- [ ] **verified true** — **勿擅自改**；L2 `--probe` + 最小中文 live 成功後人審
- [ ] **可選 P2**：playbook 見證／開示線 modelIds 首選改本 id（現多 02-hd）
- [ ] **可選 P3**：暴露 voice_id／emotion UI；預設可改 `Deep_Voice_Man` 或 `Abbess` 莊嚴向
- [ ] **可選 P3**：language_boost=`Chinese` 明送；pronunciation_dict 接術語表
- [ ] **可選 P3**：cost 字串改正式 `$0.10/千字`（若官頁確認 2.6 同價）
- [ ] **勿**把 02-hd 的 `{ text }` 複製回 2.6
- [ ] **L2**（有 KEY）：`verify-models --probe "fal-ai/minimax/speech-2.6-hd"` 再單次 `--yes`

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅（已修） | 📄 OpenAPI | 未跑 | **已修 input**；維持 points／verified=false |

**未做：** 任何 `--yes` live、任何自動 `verified: true`、任何改 points。
