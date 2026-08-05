# fal-ai/kokoro/mandarin-chinese

> 審計：R5 · index **215** · static+research（**零 live / 禁止 --yes**）· 2026-08-05  
> slug：`fal-ai__kokoro__mandarin-chinese` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id | `fal-ai/kokoro/mandarin-chinese` |
| label | Kokoro 中文 |
| category | `text-to-speech` |
| tier | budget |
| kind | audio |
| verified | **true** |
| needs | 無（免來源） |
| recommended | false／未標 |
| endpoint | `fal-ai/kokoro/mandarin-chinese`（`endpointOf`＝id，無 alias） |
| strengths | 極低成本中文語音;82M 小模型、速度快 |
| bestFor | 草稿配音、內部預覽 |
| 供應商／底層 | **Kokoro TTS** 開源輕量（約 **82M** 參數）Mandarin 變體 via fal.ai；姊妹線另有 American English 等語言端點（本卡只涵蓋 mandarin-chinese） |
| 角色定位 | **站內最低成本中文 TTS**；草稿／試聽／代理預設旁白；正式成品應升 Qwen／MiniMax／Index |

**L0 靜態契約：** ok  
- 必填欄完整；`category ∈ CATEGORIES`；id 唯一；端點無兄弟共用。  
- `input: (p) => ({ prompt: p, voice: "zf_xiaoxiao" })` 存在且可呼叫 → 樣例 `{ prompt: "…", voice: "zf_xiaoxiao" }`。  
- **verified 已 true**（與 Dia／Chatterbox 不同；本回合不改 code）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **1** |
| cost | **$0.02/千字** |
| 官方價與單位 | fal 公開標價 **$0.02 per 1000 characters**（模型頁／llms.txt／learn 工具文與目錄字串一致） |
| 匯率假設 | USD×31 ≈ NT$（與 `USD_TO_TWD`／`audit-model-pricing` 同基準） |
| 估值 NT$（假設） | 500 字 ≈ NT$0.31；**1000 字 ≈ NT$0.62**；2000 字 ≈ NT$1.24；5000 字 ≈ NT$3.10 |
| 動態估點 `estimatePoints` | 有 `promptChars` 時：`max(1, round(0.02×rate×chars/1000))` → 100–2000 字≈**1 點**、5000 字≈**3 點**、8000 字最壞≈**5 點**；無字數時退回扁平 **1** |
| `parseRealCost`／校準表 | usdMid=0.02；multiplier=null → **需人工**（腳本不對「/千字」套固定單次用量） |
| 校準判定 | **≈（動態路徑）**／表列「需人工」不代表錯價；扁平 1 點＝千字以內四捨五入下限（0.62→1） |

**結論：** 不建議為對齊表列「需人工」而改 points；真正扣點走 `estimatePoints`＋字元長度，與官方按字計費同向。扁平 1 與 $0.02×31≈0.62 的千字成本一致（四捨五入最低 1 點）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| OpenAPI Queue | `GET …/openapi.json?endpoint_id=fal-ai/kokoro/mandarin-chinese` → **HTTP 200**（openapi 3.0.4） |
| 模型頁／API 頁 HTML | 本回合 curl 受 **429**；**不計連通失敗**（schema 已通；公開標價與 WebSearch／llms 摘要一致） |
| dry-run probe | `probe-fal-endpoints.ts` 乾跑會列入 fal 端點計畫；**未** `--yes` |
| live probe | **未跑**（本回合零 live；禁止 `--yes`） |
| 結論 | **ready-static-only**（文件＋契約就緒；`verified` 已 true；待 L1 空探＋可選 L4 真生成對帳品質／帳單） |

**輸出契約（OpenAPI）：** `KokoroMandarinChineseOutput.audio` → `File.url`（例 wav）。站內 `extractResult` 認 `result.audio`／`audio_file`／`audio_url` → **對得上**。

**x-fal-metadata：**  
- `endpointId`＝`fal-ai/kokoro/mandarin-chinese`  
- fal 官方 category＝**`text-to-audio`**（站內歸 **`text-to-speech`**）→ 產品分桶刻意不同：站內 TTS＝旁白配音；`text-to-audio`＝配樂／音效。**勿為對齊 fal 標籤改 category**（會掉出 TTS 選單與估點路徑）。  
- playground／api 文件 URL 齊。

---

## 4. 底層邏輯

### 4.1 模型能力（公開資料）

- **Kokoro**：開源輕量 TTS（約 **82M** 參數），強調小體積、高吞吐、**$0.02/千字** 級成本；公開文案稱可比肩 10–50× 更大模型的品質帶，但 Mandarin 實務敘事多為 **可用、偏機械、情感平**——適合草稿層。  
- **本端點**專職 **普通話／Mandarin**（簡體 example 文案）；勿與 `fal-ai/kokoro/american-english` 等語種變體混淆。  
- **聲線 enum（8）**  
  - 女 `zf_*`：`zf_xiaobei`、`zf_xiaoni`、`zf_xiaoxiao`、`zf_xiaoyi`  
  - 男 `zm_*`：`zm_yunjian`、`zm_yunxi`、`zm_yunxia`、`zm_yunyang`  
- **語速 `speed`**：0.1–5，default **1.0**。  
- 非克隆、無多講者腳本契約、無 emotive tag 家族（與 Dia／Chatterbox 不同）。

### 4.2 官方 OpenAPI vs 站內

| 官方 property | 約束 | 站內 | 備註 |
|---------------|------|------|------|
| `prompt` | string **required** | ✅ `input(p)→{ prompt: p, … }` | 欄位名是 **`prompt`**（非多數 TTS 的 `text`） |
| `voice` | string **required**；enum 8 聲 | ✅ 固定 **`zf_xiaoxiao`** | 必填已滿足；**使用者無法換聲** |
| `speed` | number 0.1–5，default 1 | ❌ 未送 | 吃上游 default 1.0 |

- **required 對齊：** `prompt`+`voice` 皆有 → **無缺必填欄**；可選 `speed` 未暴露＝功能降級非契約錯誤。  
- **幽靈欄：** 無。  
- **category：** fal metadata `text-to-audio` ≠ 站內 `text-to-speech`——見 §3；站內 TTS 分桶正確。  
- **世界觀／卡片錨點：** `WORLDVIEW_INJECT_CATEGORIES` **刻意排除 TTS**；`CARD_ANCHOR_CATEGORIES` 不含 TTS → 選角色卡會 warning「不會使用設定卡」（合理，避免把基調字唸出聲）。  
- **negative／seed allowlist：** TTS 不適用。

### 4.3 風險／落差

1. **聲線鎖死：** 官方 8 聲可選，站內永遠 `zf_xiaoxiao`（女聲）。分鏡／代理大量預設此 id 時，產品音色單一——**P2** 可暴露 voice 選單或角色卡綁定 voice_id。  
2. **語速未接：** `speed` 可調 0.1–5；短影音對嘴節奏可能需快／慢，目前只能改稿長。  
3. **品質定位：** strengths 未寫「情感平／草稿向」；若使用者當正式旁白會失望。`docs/fal生態研究.md` 已標「偏機械」——目錄文案可跟。  
4. **語種／字形：** 端點為 Mandarin；example 為簡體。繁中輸入通常可唸，破音／專名（佛學術語）不如 Index TTS——playbook 日更正式軸不以本 id 為 winner 正確。  
5. **預設依賴面廣：** `SceneStudio` `DEFAULT_TTS_MODEL`、`agentRunner.AGENT_TTS_MODEL`、`agentPlanning` TTS 偏好、`wf/draft-minimal` 草稿旁白步皆綁本 id——連通／計費回歸優先級高。  
6. **`modelMechanicsFor`：** 無 Kokoro／voice enum 家族敘述——文件層缺口，不阻生成。  
7. **OpenAPI 文案瑕疵：** output `audio` description 寫 “The generated **music**”——copy-paste 噪音，以 TTS 行為為準。

---

## 5. 站內扣點／退點

| 環節 | 行為 |
|------|------|
| 估點 | `generationCore` → `estimatePointsFor(model, { promptChars: positivePrompt.length, usdToTwdRate })` |
| 扣點 | `reserveQuota(user, group, est, …, gen.id)`；成功後 `pointsActual` 對齊 `pointsEst`（BYOK 使用者 key 可 0） |
| 退點 | 失敗／陳屍回收走 `refund`；與 est 對稱 |
| UI 顯示 | 目錄扁平 **1**；有 prompt 時估點可隨字數變（≤~2000 字多為 1、5000→3、8000→5） |
| 工作流 | `wf/draft-minimal` 含本模「按千字」步；載入時以 **8000 字最壞**估總點（本模 ≈5 點／步），避免低估斷鏈 |

**一致性：** 顯示／預留／退點同一 `estimatePoints` 路徑 → **架構 ok**。  
**單測：** `shared/models.test.ts` 覆蓋 kokoro 1000 字→1、極短→1。  
**本模無 live 對帳：** 未驗證 fal 實際帳單字元計數（空白／標點／繁簡）是否與 `prompt.length` 完全一致——標 **待 L4／月帳單抽樣**。

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填 | 使用者 prompt → 送出前 `positivePrompt`；空稿應被站內生成表單擋下 |
| 欄位名 | 官方／站內皆 **`prompt`**（＋必填 **`voice`**）— 與 Chatterbox／Dia（`text`）、VibeVoice（`script`）不同 |
| 長度 | OpenAPI **無** maxLength；實務受 fal 佇列與費用約束。估點按 **JS 字串 length**（UTF-16 code unit） |
| needs | 無 → 不要求音訊來源；缺來源攔截 **不適用** |
| 注入 | 不注入世界觀／卡片（見 §4）→ 使用者寫什麼就唸什麼 |
| 建議腳本形 | 純中文旁白正文（無 `[S1]`／尖括號情緒標需求） |
| 可選（未接） | `speed`；`voice` 僅固定 `zf_xiaoxiao`，其餘 7 聲未暴露 |

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|------|------|
| 中文草稿旁白／腳本試聽節奏 | ✅ 對位 | 最低成本＋秒級小模型；bestFor 一致 |
| 代理／分鏡預設配音 | ✅ 現況 | AGENT／SceneStudio／draft-minimal 預設 |
| 社群日更「可過耳」量產 | △ 勉強 | 更宜 Qwen 0.6B／1.7B；本模省但機械 |
| 見證／開示正式成品 | ❌ | 情感平；升 MiniMax 2.6／02 HD |
| 佛學術語／對嘴時長 | ❌ | Index TTS 2.0 軸更準 |
| 雙人對談短劇 | ❌ | 無多講者；用 VibeVoice／Dia／EL dialogue |
| 英文旁白 | ❌ | 本端點 Mandarin；英文應 kokoro/american-english 或 EL／Chatterbox（目錄未收 EN Kokoro） |
| 助手自動挑選 | ✅ 路徑上可用 | `verified=true` → `modelIsOperationallyReady` 可過（仍受情境／playbook 偏好） |
| 手動台選模 | ✅ | text-to-speech 清單；budget 1 點檔 |
| recommended | 否 | 合理（草稿預設≠全站推薦旗艦） |
| 站內 PK／playbook | 非正式 winner | `sh-tts` 日更以 Qwen 為主；本 id 作成本底線／工作流草稿步——正確 |

**文案審（L6）：** bestFor「草稿配音、內部預覽」準確；strengths 可補「情感偏平、正式稿請升級」以免過度期待。voice 固定未在 UI 說明——若接多聲線再寫「可選聲線」。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| 文件 | Playground：`https://fal.ai/models/fal-ai/kokoro/mandarin-chinese` |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kokoro/mandarin-chinese`（本回合 200） |
| API 文檔 URL | `https://fal.ai/models/fal-ai/kokoro/mandarin-chinese/api` |
| llms.txt | 標價 $0.02/1000 characters（與目錄一致） |
| MCP | `generate_into_scene` 等寫入工具走同一 `submitGenerationCore`／目錄模型；**可調用**（權限＋點數允許時） |
| 助手／代理 | 規劃與 runner 預設 TTS＝本 id；自動選模因 verified 可入 operational 池 |
| 檢視者 | 唯讀，不送生成（既有權限模型） |

---

## 9. 建議動作

- [x] **維持** id／endpoint／category（`text-to-speech`）／points 扁平 **1**／cost `$0.02/千字`／`input→{prompt, voice:"zf_xiaoxiao"}`／**verified true**（必填契約已對齊官方；估點動態正確；預設依賴面廣不宜無 live 動刀）
- [ ] **調 points** — 不需要（動態按字估點已覆蓋；勿為校準表「需人工」誤改）
- [ ] **修 input/id** — 非阻擋；**可選 follow-up（P2）**：  
  - 暴露 `voice` 枚舉（8 聲）於生成選項／角色卡  
  - 可選暴露 `speed`（0.1–5）供對嘴節奏  
  - **不要**把站內 category 改成 fal 的 `text-to-audio`
- [ ] **verified** — **已 true，維持**；本回合無 live 不建議改 false。可選 L4 中文短句 live 作帳單／音質抽樣（控費 1 次）
- [ ] **下架或隱藏** — 不需要；草稿底線與代理預設核心檔
- [ ] **文案／可發現性（建議 follow-up，非本卡必改 code）**  
  - strengths／help：標明草稿向、情感偏平、固定 `zf_xiaoxiao`  
  - 正式中文路由繼續 Qwen／MiniMax／Index（現 playbook 已正確）
- [ ] **Live 佇列（可選，控費）**  
  - 估點：`npx tsx scripts/verify-models.ts --probe "fal-ai/kokoro/mandarin-chinese"`  
  - 真跑一次（單次、需 FAL_KEY）：加 `--yes`；建議短中文句（腳本預設「測試」可當連通煙測）  
  - 另測（可選）：換 `voice`／`speed` 差異（控費各 1 次）

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄 OpenAPI | 未跑 | **維持**（verified 已 true；voice／speed 為 P2；live 可選對帳） |

### 研究來源（static+research）

- `shared/models.ts`（entry、estimatePoints、ttsUsdPerKChar、WORLDVIEW／CARD 排除、`wf/draft-minimal`）  
- `shared/models.test.ts`（kokoro 估點單測）  
- `server/services/generationCore.ts`／`fal.ts`（估點、扣點、audio 抽取）  
- `server/services/agentRunner.ts`／`agentPlanning.ts`；`client/.../SceneStudio.tsx`（預設 TTS）  
- fal OpenAPI `KokoroMandarinChineseInput`／`Output`（200）  
- 公開：fal 標價 $0.02/1k chars；82M；Mandarin 8 聲 enum  
- 站內：`docs/fal生態研究.md`、`docs/點數校準報告.md`、`docs/模型目錄.md`  

**未做：** 任何 `--yes` live、任何改 `verified`／points／input 寫入 `models.ts`。
