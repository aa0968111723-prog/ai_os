# fal-ai/minimax/voice-design

> 審計：R5 · index **#221** · 模式 **static+research（零 live / 禁止 --yes）** · 2026-08-05  
> slug：`fal-ai__minimax__voice-design` · 單一真相：`shared/models.ts`  
> **L0 input 契約落差**：OpenAPI **required**＝`prompt`＋**`preview_text`**；站內只送 `{ prompt }` → **缺必填 → 422 風險**。  
> **P0 產品缺口**：輸出主產物 **`custom_voice_id`** 站內未抽取、未串 MiniMax TTS。  
> **標價錯誤**：官方 **\$3／聲**＋預覽 **\$0.03／千字**；目錄 cost「推估按字」／points=**3** 嚴重低估。未改 `verified`／`points`／`input` 寫入。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| **index** | 221 |
| **id** | `fal-ai/minimax/voice-design` |
| **endpoint** | 同 id（`endpointOf`＝id，無 alias） |
| **label** | MiniMax 聲音設計 |
| **category** | `text-to-speech`（站內＝OpenAPI `x-fal-metadata.category`） |
| **tier** | `flagship` |
| **kind** | `audio` |
| **verified** | **`false`**（目錄 ⚠︎） |
| **needs** | **`null`**（免來源；靠文字描述造聲，不需樣音） |
| **recommended** | `false` |
| **sourceHint** | （無） |
| **strengths** | 文字描述訂做全新聲線(如溫暖沉穩中年男聲) |
| **bestFor** | 不克隆真人的專屬旁白聲、規避授權 |
| **供應商／底層** | **MiniMax Voice Design** via fal.ai（文字→`custom_voice_id`，再餵 MiniMax TTS 量產） |
| **角色定位** | 旗艦 **文字造聲／免真人授權** 路徑；**非** sc-voice-clone pick（該配方只列 clone）；與 #219 voice-clone 同為 **ID 產物型**，但本模 **不需 audio** |

**L0 靜態契約：** **欄位 ok**／**input 缺 required → 落差**  
- 必填欄完整；`category ∈ CATEGORIES`；id 唯一。  
- `input: (p) => ({ prompt: p })` → 只送 **`prompt`**；官方 **required 另有 `preview_text`** → **幾乎每次生成 422**（與 #218 Index TTS 修前同類）。  
- **無 `needs`** → 站內可選、估點可走 probe 路徑（但本回合禁止 `--yes`；且缺 preview 真跑亦會失敗）。

**一句話：** 付 **\$3／次** 用文字描述「設計」一把可複用 **`custom_voice_id`**（不克隆真人、規避授權），並附預覽音（**\$0.03／千字**）；站內現況 **缺 preview_text、丟 voice_id、只收 3 點**——契約與帳單皆未閉環。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| **points（目錄扁平）** | **3** |
| **cost（目錄現值）** | **`推估按字計費(量級同 MiniMax TTS)`** |
| **官方價與單位（✅本回合查證）** | fal 模型頁／learn／llms.txt：**Designing a voice will cost \$3 per created voice, with 0.03 per 1000 preview characters**；OpenAPI `preview_text` 描述：**\$30 per 1M characters**（＝**\$0.03／千字**） |
| **匯率假設** | USD×**31** ≈ NT$（`USD_TO_TWD`） |
| **估值 NT$（假設）** | 造聲本體 \$3 → **NT\$93**；預覽 100 字 ≈ \$0.003（≪1 點）；預覽上限 500 字 ≈ \$0.015 ≈ **NT\$0.47** |
| **`parseRealCost`（現 cost）** | **無 \$ 金額** → usdMid=null → **`realPricePoints`=null** → 保留手填 **3** |
| **若 cost 改為 `\$3/次+預覽音 \$0.03/千字`** | 首報價「／次」→ multiplier=**1** → `round(3×1×31)=`**93**；**不**進 `ttsUsdPerKChar`（與 voice-clone 同：首單位非「千字」→ 扁平） |
| **動態估點 `estimatePoints`** | 現況一律 **扁平 3**（無 per-k 快取）；**不**隨 prompt 字數變 |
| **`docs/點數校準報告.md`** | 「推估按字…」→ **需人工**（無 \$） |
| **`docs/fal生態研究.md`** | 仍寫「推估按字…MiniMax TTS」→ **應升 ✅ \$3／聲＋\$0.03／1k 預覽** |
| **校準判定** | **偏便宜（極嚴重）**：實價 **≈93 點** vs 目錄 **3**（約 **31× 低估**）；預覽加價可忽略 |

**結論：**  
- **建議調 points→93** 並改 cost 為官方字串（對齊 #219 voice-clone 的「\$／次＋預覽千字」寫法）。  
- **勿**寫成「同 MiniMax TTS \$0.10／千字」——本端點是**一次性造聲註冊**，不是朗讀計費。  
- 與 clone（\$1.50／次→47 點）比：design **貴一倍**（文字造聲 vs 樣音克隆）。

---

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0** | **落差** | 缺 required `preview_text` |
| **OpenAPI Queue** | **HTTP 200** | `GET …/openapi.json?endpoint_id=fal-ai/minimax/voice-design` → openapi **3.0.4**；`MinimaxVoiceDesignInput`／`Output` |
| **模型頁／標價** | ✅ 公開資料一致 | \$3／voice + \$0.03／1k preview chars；about：Design personalized voice from text description → voice_id for TTS |
| **L1 歷史** | 端點曾 **連通 200** | `docs/fal端點連通報告.md`：`✅ 連通(誤排佇列已取消)` |
| **dry-run probe** | 本環境 **無 FAL_KEY** | `verify-models --probe` 僅提示需 KEY；**未** `--yes` |
| **live probe** | **未跑** | 本回合零 live；**禁止 `--yes`**；單次實費 ≈ **\$3+**（93 點級） |
| **結論** | **ready-static-only（契約待修）** | 端點存活；**修 input 後**方可 live；**verified 仍須等 ID 可讀** |

### OpenAPI 摘要（2026-08-05）

**Input `MinimaxVoiceDesignInput`（VoiceDesignRequest）**

| property | 約束 | 站內 |
|----------|------|------|
| **`prompt`** | string **required**；voice description；**maxLength 2000**；例：*Bubbly and excitable female pop star…* | ✅ 送 `positivePrompt` → `prompt` |
| **`preview_text`** | string **required**；預覽朗讀稿；**maxLength 500**；預覽費 \$30／1M chars | ❌ **未送** → **422** |

**Output `MinimaxVoiceDesignOutput`**

| property | 約束 | 站內 |
|----------|------|------|
| **`custom_voice_id`** | string **required** — *The voice_id of the generated voice* | ❌ **`extractResult` 完全不認** |
| **`audio`** | File **required** — 預覽音 | △ 有則走 `audio.url` → 當一般音訊素材 |

**輸出抽取（現況）：**  
`extractResult` 優先 `result.audio.url` → 若上游成功且有預覽，使用者只拿到 **預覽 MP3**；**`custom_voice_id` 丟棄**。  
（本端點 audio 為 required，較不易「只有 ID 整單 failed」；但 **真正賣點 ID 仍遺失**——同 #219。）

**x-fal-metadata：** endpointId 本 id；category=`text-to-speech`；playground／documentation 齊；about＝文字描述生成個人化聲線，並可用 voice_id 走 Text-to-Speech API。

---

## 4. 底層邏輯

### 4.1 模型能力（公開資料）

- **兩段式產品：** (1) 本端點依 **音色描述** 註冊 → `custom_voice_id`＋預覽 MP3；(2) MiniMax TTS（`speech-02-hd`／`speech-2.6-hd` 等）的 `voice_setting.voice_id` 引用該 ID 量產旁白。  
- **與 voice-clone 差異：** clone 要 **≥10s 樣音**、\$1.50、預覽 \$0.30／千字；design **免樣音**、用文字訂音色、\$3、預覽僅 **\$0.03／千字**。  
- **授權優勢：** 不複製真人聲紋 → bestFor「規避授權」成立（仍須避免描述過度影射特定公眾人物之產品／法遵提示）。  
- **語意陷阱：** 使用者 prompt 應是 **聲線描述**（年齡／性別／氣質／口音），**不是**最終旁白腳本；朗讀稿屬 **`preview_text`**（試聽用）。站內單一「正文」欄若直接當 TTS 會誤導。  
- **保留規則：** 公開頁未在本回合 OpenAPI 重複「7 天 TTS 激活」句（clone 有）；MiniMax 生態慣例 custom voice 常需後續 TTS 保活——**待 live／文件交叉確認**，產品層宜比照 clone 提示。

### 4.2 官方 OpenAPI vs 站內

| 官方 | 站內 | 備註 |
|------|------|------|
| required **`prompt`**（音色描述） | ✅ 當生成 prompt | 產品語意：使用者以為在「配音」，實際應是「設計聲線」 |
| required **`preview_text`** | ❌ | **P0 契約** |
| 輸出 **custom_voice_id** | ❌ | **P0 管線** |
| 輸出 preview **audio** | △ 當唯一成品 | 掩蓋 ID 遺失 |
| needs 來源 | 無（正確） | 與 clone 不同 |

- **世界觀／卡片錨點：** TTS **排除**注入 → 合理；音色來自文字描述，不來自角色卡（未來可選：從角色卡「聲線」欄拼 prompt）。  
- **negative／seed：** 不適用。  
- **`modelMechanicsFor`：** path 含 `minimax` 會命中影片 DiT 家族正則——**與本音訊端點無關**（mechanics 多用於圖／影；本卡不依賴）。

### 4.3 風險／落差

1. **P0 — 缺 `preview_text`：** 現 input **無法通過 OpenAPI required** → 生成幾乎必 422；應 **先修 input 再談 verified**。  
2. **P0 — voice_id 管線斷：** 與 #219 同：扣點後若有預覽只剩 MP3；**無法**在 MiniMax TTS 引用（該端點站內也未暴露 `voice_setting.voice_id`）。  
3. **P0 — 點數嚴重低估：** 3 vs ≈93；若修 input 後 live 成功，平台 **每單貼 ≈ NT\$90**（外加預覽小額）。  
4. **P1 — 單欄語意：** 一欄無法同時表達「音色描述」與「試聽稿」；建議固定短預覽句，或 UI 雙欄。  
5. **P2 — 誤用為「貴版／便宜 TTS」：** 現 3 點看起來像經濟 TTS；修價後 93 點又像「超貴朗讀」——文案必須強調 **註冊聲線**。  
6. **verified=false：** 助手不優先；目錄仍可點到。  
7. **live 成本：** 單次 ≈\$3，控費佇列低優先。

### 4.4 與家族／情境配方

| id／配方 | 角色 | 與本卡 |
|----------|------|--------|
| MiniMax voice-clone (#219) | 樣音→ID | 同家族；本模免樣音、貴一倍 |
| MiniMax speech-02-hd / 2.6-hd | 量產旁白 | **應**吃 `custom_voice_id`；站內 voice_setting **未接** |
| `sc-voice-clone` | 會方專屬聲 | **未**列本 id（合理：配方意圖是樣音克隆；可另開 sc-voice-design） |
| showdown 專屬聲線克隆 | winner=clone | 本模不在軸上；「免授權造聲」可作新軸 |
| Qwen clone-voice 1.7b | 經濟試克隆 | 型態不同（embedding） |
| 內建 300+ 聲線 TTS | 免註冊 | 多數旁白應先挑內建，再 design |

---

## 5. 站內扣點／退點

| 環節 | 行為 |
|------|------|
| 估點 | `estimatePoints` → **扁平 3**（現 cost 無 \$／無 per-k） |
| 扣點 | `reserveQuota(…, est=3, …)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／陳屍 `refund` 與 est 對稱 |
| UI 顯示 | 目錄 **3** |
| 缺來源 | 無 needs → 不擋 |
| 工作流 | 若誤入 preset 步，固定 +3（與實費 \$3 嚴重脫節） |

**一致性：** 顯示／預留／退點同為 3 → **架構對稱 ok**。  
**帳單落差：** fal ≈ **\$3 + preview**；站內只收 **3 點** → **P0 毛利／補貼**。  
**422 失敗：** 現況多半在 fal 前失敗 → 退 3 點；**修 input 後**成功才會真吃 \$3。  
**本模無 live 對帳。**

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填來源 | **無**（文字即可） |
| 「正文」現況 | 使用者 prompt → **僅 `prompt`**＝應為**音色描述** |
| 缺欄 | **`preview_text`**（試聽稿，max 500）— **必須補** |
| 建議組裝（修 input） | 方案 A：`prompt: p`，`preview_text` 固定短中文句（如「您好，這是專屬旁白聲線試聽。」）；方案 B：UI 雙欄（描述＋試聽稿）；方案 C：進階把長稿截斷當 preview（**不建議**當量產旁白） |
| 長度 | `prompt` max **2000**；`preview_text` max **500** |
| 估點 | **不**隨字數（首價應為／次） |
| 注入 | 不注入世界觀／卡片 |
| 建議用法 | 精準描述氣質／年齡／性別／語速／口音；短試聽句；成功後**保存 voice_id** 再轉 TTS 量產 |

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|:----:|------|
| 不克隆真人的專屬旁白聲 | △／✅ 意圖 | 官方能力正確；**站內缺 preview＋ID＋TTS 串** → 現況不可用 |
| 規避師父／志工聲授權 | ✅ 意圖 | 文字造聲；仍需法遵（勿影射特定人） |
| 建立會方固定品牌聲（無樣音） | △ | 應用 design→ID→TTS；管線未閉環 |
| 有授權樣音 | ❌ 主力 | 用 **voice-clone**（\$1.50）較便宜且像本人 |
| 日更短口白 | ❌ | 用 Qwen／Kokoro／內建聲線 |
| 當普通 TTS 朗讀 | ❌ | 貴且語意錯；預覽非量產 |
| 助手自動挑選 | ❌ | verified=false |
| 手動台可選 | ✅ 可點到 | 現 input 幾乎必敗 |
| recommended | 否 | 合理（未 verified；契約／價皆錯） |

**文案審（L6）：**  
- strengths／bestFor **方向正確**（文字訂做、免克隆授權）。  
- cost「推估按字」**誤導** → 必須改官方 \$3／聲。  
- UI help 應寫：費用＝**造聲註冊**；正文＝**音色描述**；試聽稿另欄或系統預設；成功後保存 voice_id；量產走 MiniMax TTS。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| Playground | `https://fal.ai/models/fal-ai/minimax/voice-design` |
| API 文檔 | `https://fal.ai/models/fal-ai/minimax/voice-design/api` |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/minimax/voice-design`（本回合 **200**） |
| 標價 | **\$3／created voice**；**\$0.03／1000 preview characters** |
| MCP | `generate_into_scene` 等同路徑；**可調**但現 input 缺必填 → 實務失敗；成品語意破碎（缺 ID） |
| 助手 | 偏好 verified；本 id 非 sc pick |
| 檢視者 | 唯讀，不送生成 |
| 連通史 | `docs/fal端點連通報告.md` 已標連通 |
| 生態／校準／清查 | 生態價應更新；校準「需人工」→改 \$ 後可機械 93；清查 ⚠︎ 未 verified |

---

## 9. 建議動作

- [ ] **維持** points=3／現 cost — **不建議**（嚴重低估＋契約錯）  
- [x] **建議調 cost** → **`克隆式寫法：\`$3/次+預覽音 $0.03/千字\``**（對齊官方；首單位「／次」→ 扁平估點）  
- [x] **建議調 points** → **`93`**（`round(3×31)`；與 voice-clone 47 同一算法）  
- [x] **修 input（P0，優先於 live）** — 至少：  
  ```ts
  input: (p) => ({
    prompt: p,
    preview_text: "您好，這是為您設計的專屬旁白聲線試聽。", // 或 UI 雙欄
  })
  ```  
  - `prompt`＝音色描述（max 2000）；`preview_text` 必填（max 500）  
  - 可選：表單 placeholder 示例「溫暖、沉穩、帶慈悲感的中年男聲」  
- [ ] **P0 修 output 解析** — `extractResult`（或 generation 特判）應保留 **`custom_voice_id`**：  
  - 比照 LoRA：`resultText` 寫出 ID＋使用說明；**url（預覽）與 text（ID）並存**  
- [ ] **P0 產品閉環** — 聲線庫保存 voice_id；MiniMax TTS 暴露 `voice_setting.voice_id`；可選 sc-voice-design 配方  
- [ ] **verified true** — **僅建議，勿擅自改**：待 **input 修好**＋L4 成功 **且** ID 可讀可複製後再人工開  
- [ ] **下架或隱藏** — 不需要；修前可在 help 標「進階／契約待修／約 93 點註冊」避免當 3 點 TTS  
- [ ] **文案** — 改 cost；strengths 可補「產出可複用 voice_id」；強調非朗讀計費  
- [ ] **Live 佇列（可選，控費）**  
  - 估點：`npx tsx scripts/verify-models.ts --probe "fal-ai/minimax/voice-design"`  
  - 真跑：**單次**、需 FAL_KEY；**修 input 後**再跑；**禁止批次 --yes**（單次 ≈\$3+，93 點級）  
  - 對帳：帳單 \$3+preview vs 扣點；回應 JSON 含 `custom_voice_id`＋`audio.url`

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| 落差(缺 preview_text) | 📄OpenAPI | 未跑 | **建議調** cost→\$3/次 points=**93**；**修 input** 加 preview_text；**P0** custom_voice_id 未抽取＋TTS 未串；ready-static-only；verified=false |

### 研究來源（static+research）

- `shared/models.ts`（entry #221、`estimatePoints`／`realPricePoints`／`ttsUsdPerKChar` 首報價／次規則）  
- `server/services/fal.ts` `extractResult`（無 custom_voice_id 分支）  
- fal OpenAPI `MinimaxVoiceDesignInput`／`Output`（HTTP **200**，2026-08-05）  
- 公開標價：\$3／created voice、\$0.03／1k preview（模型頁／learn／llms.txt 交叉一致）  
- 站內：`docs/fal生態研究.md`、`docs/點數校準報告.md`、`docs/fal端點連通報告.md`、`docs/模型目錄.md`  
- 姊妹卡：`docs/model-audit/cards/fal-ai__minimax__voice-clone.md`（#219）  

**未做：** 任何 `--yes` live、任何改 `verified`／`points`／`input` 寫入 `models.ts`。
