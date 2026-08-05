# fal-ai/dia-tts

> 審計：R5 · index **213** · static+research（**零 live / 禁止 --yes**）· 2026-08-05  
> slug：`fal-ai__dia-tts` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id | `fal-ai/dia-tts` |
| label | Dia 對話語音 |
| category | `text-to-speech` |
| tier | economy |
| kind | audio |
| verified | **false** |
| needs | 無（免來源） |
| recommended | false |
| endpoint | `fal-ai/dia-tts`（`endpointOf`＝id，無 alias） |
| strengths | 多角色對話生成(含笑聲、停頓等非語言聲) |
| bestFor | 情境短劇、雙人對談 |
| 供應商／底層 | Nari Labs **Dia 1.6B**（open weights）via fal.ai |
| 角色定位 | 經濟檔 **英文雙人對話 TTS**；站內「多人對談」軸 **runner-up**（winner＝VibeVoice 7B） |

**L0 靜態契約：** ok  
- 必填欄完整；`category ∈ CATEGORIES`；id 唯一；端點無兄弟共用。  
- `input: (p) => ({ text: p })` 存在且可呼叫。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **2** |
| cost | **$0.04/千字** |
| 官方價與單位 | fal 公開標價 **$0.04 per 1000 characters**（與目錄字串一致；OpenAPI 頁／學習文多次交叉） |
| 匯率假設 | USD×31 ≈ NT$（與 `USD_TO_TWD`／`audit-model-pricing` 同基準） |
| 估值 NT$（假設） | 500 字 ≈ NT$0.62；**1000 字 ≈ NT$1.24**；2000 字 ≈ NT$2.48 |
| 動態估點 `estimatePoints` | 有 `promptChars` 時：`max(1, round(0.04×rate×chars/1000))` → 100–1000 字≈**1 點**、2000 字≈**2 點**、5000 字≈**6 點**；無字數時退回扁平 **2** |
| `parseRealCost`／校準表 | usdMid=0.04；multiplier=null → **需人工**（腳本不對「/千字」套固定單次用量） |
| 校準判定 | **≈（動態路徑）**／表列「需人工」不代表錯價；扁平 2 點≈中長稿緩衝，短稿實扣常 1 點 |

**結論：** 不建議為對齊表列「需人工」而改 points；真正扣點走 `estimatePoints`＋字元長度，與官方按字計費同向。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| OpenAPI Queue | `GET …/openapi.json?endpoint_id=fal-ai/dia-tts` → **HTTP 200**（openapi 3.0.4） |
| 模型頁／API 頁 HTML | 本回合 WebFetch/curl 受 Vercel checkpoint／429；**不計連通失敗**（schema 已通） |
| dry-run probe | `probe-fal-endpoints.ts` 乾跑會列入 252 fal 端點計畫；**未** `--yes` |
| live probe | **未跑**（本回合零 live；環境亦可能無 FAL_KEY） |
| 結論 | **ready-static-only**（文件＋契約就緒；待 L1 空輸入探＋可選 L4 真生成後可升 ready／建議 verified） |

**輸出契約（OpenAPI）：** `DiaTtsOutput.audio` → `File.url`（例 mp3）。站內 `extractResult` 認 `result.audio`／`audio_file`／`audio_url` → **對得上**。

---

## 4. 底層邏輯

### 4.1 模型能力（公開資料）

- **Dia 1.6B**（Nari Labs）：text-to-**dialogue**，開源權重；公開說明以 **English generation** 為主。  
- 講者標籤：**`[S1]` / `[S2]`** 切換雙人。  
- 非語言標記：`(laughs)`、`(clears throat)`、`(sighs)`、`(coughs)` 等（官方列表另含 gasps／singing 等，結果可能不穩）。  
- 姊妹端點：`fal-ai/dia-tts/voice-clone`（index 225，`needs: audio`，本卡不涵蓋）。

### 4.2 官方 OpenAPI vs 站內

| 官方 property | 約束 | 站內 | 備註 |
|---------------|------|------|------|
| `text` | string **required** | ✅ `input(p)→{ text: p }` | 唯一輸入欄；order 僅 text |
| （其他） | 無 | — | 無 voice／speed／language／seed 等旋鈕 |

- **required 對齊：** 僅 `text` ↔ 站內只送 `text` → **無缺欄／無幽靈欄**。  
- **category：** fal metadata `text-to-speech` ＝ 站內。  
- **世界觀／卡片錨點：** `WORLDVIEW_INJECT_CATEGORIES` **刻意排除 TTS**（避免把基調字唸出聲）；`CARD_ANCHOR_CATEGORIES` 不含 TTS → 選角色卡會 warning「不會使用設定卡」（合理）。  
- **negative／seed：** TTS 不適用；allowlist 不影響。

### 4.3 風險／落差

1. **語種：** 上游英文主場；站內 strengths／bestFor **未標「英文為主、中文非強項」**（`docs/fal生態研究.md` 已寫，目錄文案未跟）。  
2. **腳本格式：** 多角色需使用者自備 `[S1]`/`[S2]`；與 ElevenLabs v3 站內自動拆行配 voice **不同**，UI 無引導。  
3. **`modelMechanicsFor`：** 無 TTS／Dia 家族敘述（family 多為 unknown）——文件層缺口，不阻生成。

---

## 5. 站內扣點／退點

| 環節 | 行為 |
|------|------|
| 估點 | `generationCore` → `estimatePointsFor(model, { promptChars: positivePrompt.length, usdToTwdRate })` |
| 扣點 | `reserveQuota(user, group, est, …, gen.id)`；成功後 `pointsActual` 對齊 `pointsEst`（BYOK 使用者 key 可 0） |
| 退點 | 失敗／陳屍回收走 `refund`；與 est 對稱 |
| UI 顯示 | 目錄扁平 **2**；有 prompt 時估點可隨字數變（短稿 1、長稿 >2） |
| 工作流 | 含「按千字」TTS 步時以 **8000 字最壞**估總點，避免低估斷鏈 |

**一致性：** 顯示／預留／退點同一 `estimatePoints` 路徑 → **架構 ok**。  
**本模無 live 對帳：** 未驗證 fal 實際帳單字元計數（含 tag／空白）是否與 `prompt.length` 完全一致——標 **待 L4／月帳單抽樣**。

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填 | 使用者 prompt → 送出前 `positivePrompt`；空稿應被站內生成表單擋下（與其他 TTS 同） |
| 欄位名 | 官方／站內皆 **`text`**（非 `prompt`／`script`）— 與 Kokoro（`prompt`+voice）、VibeVoice（`script`）不同 |
| 長度 | 無 OpenAPI maxLength；實務受 fal 佇列與費用約束。估點按 **JS 字串 length**（UTF-16 code unit；中日文大致 1 字元≈1 計費字，仍待 live 對帳） |
| needs | 無 → 不要求音訊來源；缺來源攔截 **不適用** |
| 注入 | 不注入世界觀／卡片（見 §4）→ 使用者寫什麼就唸什麼 |
| 建議腳本形 | `[S1] … [S2] … (laughs)`（官方 example 同構） |

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|------|------|
| 英文雙人短劇／Podcast 對談 | ✅ 對位 | `[S1]`/`[S2]`＋非語言聲是產品賣點 |
| 多人對談（站內 PK） | △ runner-up | `STYLE_SHOWDOWNS.sh-tts`：winner VibeVoice 7B，本 id 次選 |
| `sc-panel-podcast` 選單 | △ 第三順位 | pickIds: VibeVoice 7B → ElevenLabs v3 → **Dia**；why 已把高情感英文推 EL |
| **中文**旁白／弘法問答 | ❌ 不宜 | 英文主場；中文應 MiniMax／Qwen TTS／Index TTS |
| 日常單人旁白 | ❌ | 非強項；Turbo 2.5／Kokoro 更合適 |
| 助手自動挑選 | ❌ | `verified=false` → `modelIsOperationallyReady` 否 |
| 手動台選模 | ✅ 可選 | 在 text-to-speech 清單；economy 2 點檔 |
| recommended | 否 | 合理（非中文主力、非日更預設） |

**文案審（L6）：** bestFor「情境短劇、雙人對談」方向對，但應加 **「英文腳本為主」**；strengths 可補 `[S1]/[S2]` 與非語言標記，避免使用者把中文對話稿丟進來期望母語級。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| 文件 | Playground：`https://fal.ai/models/fal-ai/dia-tts` |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/dia-tts`（本回合 200） |
| API 文檔 URL | `https://fal.ai/models/fal-ai/dia-tts/api` |
| MCP | `generate_into_scene` 等寫入工具走同一 `submitGenerationCore`／目錄模型；**可調用**（權限＋點數允許時） |
| 助手 | 自動選模偏好 verified；本 id 僅手動或未強制 verified 的候選池 |
| 檢視者 | 唯讀，不送生成（既有權限模型） |

---

## 9. 建議動作

- [x] **維持** id／endpoint／category／points 扁平 2／cost `$0.04/千字`／`input→{text}`（契約已對齊官方）
- [ ] **調 points** — 不需要（動態按字估點已覆蓋；勿為校準表「需人工」誤降／誤升）
- [ ] **修 input/id** — 不需要
- [ ] **verified true** — **僅建議，勿擅自改**：待 L1 `--yes` 空探＋可選 L4 最小英文對話稿 live 成功後再人工開
- [ ] **下架或隱藏** — 不需要；保留作英文對話經濟檔
- [ ] **文案／可發現性（建議 follow-up，非本卡必改 code）**
  - strengths／bestFor 標明 **英文為主、中文非強項**
  - UI 或 help：提示 `[S1]`/`[S2]`、`(laughs)` 寫法
  - 中文對談路由繼續以 VibeVoice／MiniMax／Qwen 為先（現 playbook 已大致正確）
- [ ] **Live 佇列（可選，控費）**  
  - 估點：`npx tsx scripts/verify-models.ts --probe "fal-ai/dia-tts"`  
  - 真跑一次（單次、需 FAL_KEY）：加 `--yes`；腳本預設 TTS 測試字「測試」偏中文短句——建議改英文雙人短句更貼能力（若 probe 文案固定，仍可當連通煙測）

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄 OpenAPI | 未跑 | **維持**（補英文限制文案；live 後再 verified） |

### 研究來源（static+research）

- `shared/models.ts`（entry、estimatePoints、playbook、showdown）  
- `server/services/generationCore.ts`／`fal.ts`（估點、扣點、audio 抽取）  
- `server/services/aiModelPolicy.ts`（operational ready）  
- fal OpenAPI `DiaTtsInput`／`DiaTtsOutput`（200）  
- 公開：fal 標價 $0.04/1k chars；Nari Labs Dia 英文／`[S1]`/`[S2]`／nonverbal tags  
- 站內：`docs/fal生態研究.md`、`docs/點數校準報告.md`  

**未做：** 任何 `--yes` live、任何改 `verified`／points 寫入 `models.ts`。
