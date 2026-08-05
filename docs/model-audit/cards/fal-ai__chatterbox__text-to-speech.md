# fal-ai/chatterbox/text-to-speech

> 審計：R5 · index **214** · static+research（**零 live / 禁止 --yes**）· 2026-08-05  
> slug：`fal-ai__chatterbox__text-to-speech` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id | `fal-ai/chatterbox/text-to-speech` |
| label | Chatterbox |
| category | `text-to-speech` |
| tier | economy |
| kind | audio |
| verified | **false** |
| needs | 無（免來源；見 §4 可選 `audio_url` 未接） |
| recommended | false |
| endpoint | `fal-ai/chatterbox/text-to-speech`（`endpointOf`＝id，無 alias） |
| strengths | 開源;情感強度可調 |
| bestFor | 預算型旁白 |
| 供應商／底層 | **Resemble AI Chatterbox**（開源 SoTA TTS 家族；fal 標「first tts from resemble ai」＝原版英文向 0.5B 級）via fal.ai |
| 角色定位 | 經濟檔 **表達力／情感可調** 預算旁白；比 Kokoro（$0.02）略貴、遠低於 ElevenLabs／MiniMax 旗艦；**非**中文日更首選 |

**L0 靜態契約：** ok  
- 必填欄完整；`category ∈ CATEGORIES`；id 唯一；端點無兄弟共用。  
- `input: (p) => ({ text: p })` 存在且可呼叫 → 樣例 `{ text: "hello world" }`。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **1** |
| cost | **$0.025/千字** |
| 官方價與單位 | fal 公開標價 **$0.025 per 1000 characters**（與目錄字串一致；learn／模型頁交叉） |
| 匯率假設 | USD×31 ≈ NT$（與 `USD_TO_TWD`／`audit-model-pricing` 同基準） |
| 估值 NT$（假設） | 500 字 ≈ NT$0.39；**1000 字 ≈ NT$0.78**；2000 字 ≈ NT$1.55；5000 字 ≈ NT$3.88 |
| 動態估點 `estimatePoints` | 有 `promptChars` 時：`max(1, round(0.025×rate×chars/1000))` → 100–1000 字≈**1 點**、2000 字≈**2 點**、5000 字≈**4 點**、8000 字最壞≈**6 點**；無字數時退回扁平 **1** |
| `parseRealCost`／校準表 | usdMid=0.025；multiplier=null → **需人工**（腳本不對「/千字」套固定單次用量） |
| 校準判定 | **≈（動態路徑）**／表列「需人工」不代表錯價；扁平 1 點≈千字以內緩衝，長稿隨 `estimatePoints` 升 |

**結論：** 不建議為對齊表列「需人工」而改 points；真正扣點走 `estimatePoints`＋字元長度，與官方按字計費同向。扁平 1 與 $0.025×31≈0.78 的千字成本一致（四捨五入最低 1 點）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| OpenAPI Queue | `GET …/openapi.json?endpoint_id=fal-ai/chatterbox/text-to-speech` → **HTTP 200**（openapi 3.0.4） |
| 模型頁 HTML | 本回合 curl 受 **429**；**不計連通失敗**（schema 已通；公開標價與 WebSearch 快照一致） |
| dry-run probe | `probe-fal-endpoints.ts` 乾跑會列入 fal 端點計畫；**未** `--yes` |
| live probe | **未跑**（本回合零 live；禁止 `--yes`） |
| 結論 | **ready-static-only**（文件＋契約就緒；待 L1 空輸入探＋可選 L4 真生成後可升 ready／建議 verified） |

**輸出契約（OpenAPI）：** `ChatterboxTextToSpeechOutput.audio` → `File.url`（例 wav）。站內 `extractResult` 認 `result.audio`／`audio_file`／`audio_url` → **對得上**。

**x-fal-metadata：** category=`text-to-speech`（與站內一致）；playground／api 文件 URL 齊。

---

## 4. 底層邏輯

### 4.1 模型能力（公開資料）

- **Resemble AI Chatterbox** 開源家族：原版強調 **English zero-shot TTS**、**emotion exaggeration**、CFG 微調；另有 Multilingual（23 語含中文）與 Turbo／HD 產品線——**本端點 id 為 `fal-ai/chatterbox/text-to-speech`（「first tts」原版）**，勿與 `resemble-ai/chatterboxhd/...`（$0.04/千字）或 Multilingual 專端混淆。  
- 情感：**`exaggeration`** 0–1（官方 default 0.25；開源文檔常建議中性 ~0.5、戲劇更高並降 cfg）。  
- 參考聲：**`audio_url`** 可選，匹配參考音風格／語氣（zero-shot 克隆向）。OpenAPI **default** 為 demo `male_rickmorty.mp3`——是否在 queue 省略欄時仍套用 default **待 live 確認**。  
- 非語言標記（寫入 text）：`<laugh>`、`<chuckle>`、`<sigh>`、`<cough>`、`<sniffle>`、`<groan>`、`<yawn>`、`<gasp>`（**尖括號**；與 Dia 的 `(laughs)` 不同）。  
- 長度：**maximum 5000 characters**（OpenAPI text description）。  
- 其他旋鈕：`temperature`（0.05–2，default 0.7）、`cfg`（0.1–1，default 0.5）、`seed`（可 null／0=random）。

### 4.2 官方 OpenAPI vs 站內

| 官方 property | 約束 | 站內 | 備註 |
|---------------|------|------|------|
| `text` | string **required**；max 5000 chars | ✅ `input(p)→{ text: p }` | 唯一送出欄 |
| `audio_url` | optional string／null；有 playground default | ❌ 未送 | `input` 簽名忽略 `sourceUrl`；`needs` 亦未標 audio |
| `exaggeration` | 0–1，default 0.25 | ❌ 未送 | **產品賣點「情感強度可調」站內不可調** → 吃上游 default |
| `temperature` | 0.05–2，default 0.7 | ❌ 未送 | 吃 default |
| `cfg` | 0.1–1，default 0.5 | ❌ 未送 | 吃 default |
| `seed` | int／null | ❌ 未送 | 無可重現旋鈕 |

- **required 對齊：** 僅 `text` ↔ 站內只送 `text` → **無缺必填欄**；可選旋鈕全棄 = 功能降級非契約錯誤。  
- **幽靈欄：** 無。  
- **category：** fal metadata `text-to-speech` ＝ 站內。  
- **世界觀／卡片錨點：** `WORLDVIEW_INJECT_CATEGORIES` **刻意排除 TTS**；`CARD_ANCHOR_CATEGORIES` 不含 TTS → 選角色卡會 warning「不會使用設定卡」（合理）。  
- **negative／seed allowlist：** TTS 不適用。

### 4.3 風險／落差

1. **文案 vs 能力：** strengths 寫「情感強度可調」，但站內 **無 exaggeration UI／payload**——使用者無法體驗賣點（永遠 default 0.25）。  
2. **克隆未接：** 官方可 `audio_url` 零樣本風格匹配；站內 `input` 丟棄 `sourceUrl`，且無 `needs: audio`，無法從素材庫帶參考音（與 F5／Zonos／Dia-clone 路徑不同）。  
3. **語種：** 原版 Chatterbox 主場 **英文**；`docs/fal生態研究.md` 寫「23 語含中文」較像 **Multilingual 產品線** 文案——本 id 不宜當成中文主力。中文旁白應走 MiniMax／Qwen／Index／Kokoro。  
4. **5000 字上限：** 站內估點可到 8000 字最壞工作流；超長稿可能被 fal 拒——應在 UI／help 或截斷策略標明（待 L4）。  
5. **`modelMechanicsFor`：** 無 Chatterbox／exaggeration 家族敘述——文件層缺口，不阻生成。  
6. **demo default 參考音：** 若 queue 省略時仍套用 rickmorty sample，音色會固定成 demo 男聲——**待 live 驗證**；若屬實可考慮顯式送 `audio_url: null`（若上游接受）或接可選來源。

---

## 5. 站內扣點／退點

| 環節 | 行為 |
|------|------|
| 估點 | `generationCore` → `estimatePointsFor(model, { promptChars: positivePrompt.length, usdToTwdRate })` |
| 扣點 | `reserveQuota(user, group, est, …, gen.id)`；成功後 `pointsActual` 對齊 `pointsEst`（BYOK 使用者 key 可 0） |
| 退點 | 失敗／陳屍回收走 `refund`；與 est 對稱 |
| UI 顯示 | 目錄扁平 **1**；有 prompt 時估點可隨字數變（≤~1000 字多為 1、2000→2、5000→4） |
| 工作流 | 含「按千字」TTS 步時以 **8000 字最壞**估總點（本模 ≈6 點／步），避免低估斷鏈 |

**一致性：** 顯示／預留／退點同一 `estimatePoints` 路徑 → **架構 ok**。  
**本模無 live 對帳：** 未驗證 fal 實際帳單字元計數（含 emotive tags／空白）是否與 `prompt.length` 完全一致——標 **待 L4／月帳單抽樣**。

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填 | 使用者 prompt → 送出前 `positivePrompt`；空稿應被站內生成表單擋下 |
| 欄位名 | 官方／站內皆 **`text`**（非 `prompt`）— 與 Kokoro（`prompt`+voice）、VibeVoice（`script`）不同 |
| 長度 | OpenAPI **max 5000**；估點按 **JS 字串 length**（UTF-16 code unit） |
| needs | 無 → 不要求音訊來源；缺來源攔截 **不適用** |
| 注入 | 不注入世界觀／卡片（見 §4）→ 使用者寫什麼就唸什麼 |
| 建議腳本形 | 英文旁白正文；可選尖括號情緒標：`Hello! <laugh> That was unexpected.` |
| 可選（未接） | `audio_url` 參考音、`exaggeration`／`temperature`／`cfg`／`seed` |

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|------|------|
| 英文預算旁白／個性口白草稿 | ✅ 對位 | 低價＋開源情感控制（API 層）；站內僅 default 情感 |
| 誇張表情／meme／遊戲角色腔 | △ 能力在上游 | 需 `exaggeration`／參考音；站內目前調不到 |
| 參考音克隆固定聲線 | ❌ 站內路徑斷 | 未接 `audio_url`／`sourceUrl` |
| **中文**日更旁白／見證／開示 | ❌ 不宜主力 | 原版英文向；中文應 Qwen／MiniMax／Index／Kokoro |
| 雙人對談短劇 | ❌ | 無 `[S1]`/`[S2]` 多講者契約；用 Dia／VibeVoice／EL dialogue |
| 助手自動挑選 | ❌ | `verified=false` → `modelIsOperationallyReady` 否 |
| 手動台選模 | ✅ 可選 | text-to-speech 清單；economy 1 點檔 |
| recommended | 否 | 合理（非中文主力、旋鈕未暴露、未 verified） |
| 站內 PK／playbook | 未入選 | `sh-tts`／情境選單以 Qwen／MiniMax／Index／EL 為主——正確 |

**文案審（L6）：** bestFor「預算型旁白」方向對，宜標 **英文／草稿**；strengths「情感強度可調」在站內現況為 **過度承諾**（應改為「上游支援情感強度；站內目前用預設」或真的接旋鈕後再恢復）。`docs/fal生態研究.md` 的「23 語」宜註明是否指 Multilingual 變體，避免與本 id 綁死。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| 文件 | Playground：`https://fal.ai/models/fal-ai/chatterbox/text-to-speech` |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/chatterbox/text-to-speech`（本回合 200） |
| API 文檔 URL | `https://fal.ai/models/fal-ai/chatterbox/text-to-speech/api` |
| MCP | `generate_into_scene` 等寫入工具走同一 `submitGenerationCore`／目錄模型；**可調用**（權限＋點數允許時） |
| 助手 | 自動選模偏好 verified；本 id 僅手動或未強制 verified 的候選池 |
| 檢視者 | 唯讀，不送生成（既有權限模型） |

---

## 9. 建議動作

- [x] **維持** id／endpoint／category／points 扁平 **1**／cost `$0.025/千字`／`input→{text}`（必填契約已對齊官方；估點動態正確）
- [ ] **調 points** — 不需要（動態按字估點已覆蓋；勿為校準表「需人工」誤改）
- [ ] **修 input/id** — 非阻擋；**可選 follow-up（P2）**：  
  - `input: (p, _f, sourceUrl) => ({ text: p, ...(sourceUrl ? { audio_url: sourceUrl } : {}) })` 以接通可選克隆  
  - 或獨立「Chatterbox 克隆」條目 `needs: audio`（避免強迫所有旁白上傳音）  
  - 進階：暴露 `exaggeration`（及可選 temperature／cfg／seed）使 strengths 名實相符
- [ ] **verified true** — **僅建議，勿擅自改**：待 L1 `--yes` 空探＋可選 L4 最小英文短句 live 成功後再人工開
- [ ] **下架或隱藏** — 不需要；保留作英文預算／表達力經濟檔
- [ ] **文案／可發現性（建議 follow-up，非本卡必改 code）**  
  - strengths／bestFor 標明 **英文為主、草稿／預算**；弱化未接線的「情感可調」或接線後再寫  
  - help：尖括號 emotive tags 與 5000 字上限  
  - 中文路由繼續避開本 id（現 playbook 已正確）
- [ ] **Live 佇列（可選，控費）**  
  - 估點：`npx tsx scripts/verify-models.ts --probe "fal-ai/chatterbox/text-to-speech"`  
  - 真跑一次（單次、需 FAL_KEY）：加 `--yes`；建議英文短句（腳本預設「測試」偏中文——可當連通煙測，非能力代表）  
  - 另測：省略 vs 顯式 `audio_url`／`exaggeration` 差異（控費各 1 次）

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄 OpenAPI | 未跑 | **維持**（補英文／草稿文案；旋鈕與 audio_url 為 P2；live 後再 verified） |

### 研究來源（static+research）

- `shared/models.ts`（entry、estimatePoints、ttsUsdPerKChar、WORLDVIEW／CARD 排除）  
- `server/services/generationCore.ts`／`fal.ts`（估點、扣點、audio 抽取）  
- `server/services/aiModelPolicy.ts`（operational ready）  
- fal OpenAPI `ChatterboxTextToSpeechInput`／`Output`（200）  
- 公開：fal 標價 $0.025/1k chars；Resemble Chatterbox 開源／exaggeration／emotive tags  
- 站內：`docs/fal生態研究.md`、`docs/點數校準報告.md`、`docs/模型目錄.md`  

**未做：** 任何 `--yes` live、任何改 `verified`／points 寫入 `models.ts`。

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| 指令 | `verify-models --probe fal-ai/chatterbox/text-to-speech --yes` |
| 輸入 | 「測試」 |
| requestId | `019fd072-e762-7293-9c7e-7cd97d1c697d` |
| 結果 | **failed 422** — Text must contain at least one ASCII character；非 ASCII 不支援；請用 multilingual 端點 |
| pointsEst | 0（validation） |
| 建議 | PROBE_PROMPTS TTS 改英文 `test`；或站內標 English-only；產品走 multilingual 姊妹端 |
| verified | **維持 false** |
