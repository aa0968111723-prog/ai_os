# fal-ai/qwen-3-tts/clone-voice/1.7b

> 審計：R5 · index **#220** · 模式 **static+research（零 live / 禁止 --yes）** · 2026-08-05  
> slug：`fal-ai__qwen-3-tts__clone-voice__1.7b` · 單一真相：`shared/models.ts`  
> **L0 required 契約 ok**（僅 `audio_url`）；**P0 產品缺口**：產出是 **safetensors embedding**（非 MP3），`extractResult` 不認 `speaker_embedding`、未串 Qwen TTS；**cost／points 依錯誤「~\$0.09/千字」推定**（官方實為 **\$0.0008/分**）。未改 `verified`／`points`／`input` 寫入。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| **index** | 220 |
| **id** | `fal-ai/qwen-3-tts/clone-voice/1.7b` |
| **endpoint** | 同 id（`endpointOf`＝id，無 alias） |
| **label** | Qwen 3 語音克隆 |
| **category** | `text-to-speech`（站內）；OpenAPI **`x-fal-metadata.category`＝`audio-to-audio`** |
| **tier** | `economy` |
| **kind** | `audio` |
| **verified** | **`false`**（目錄 ⚠︎；models 註解：端點推定未親驗 → **本回合 OpenAPI 已實存 200**） |
| **needs** | **`audio`**（樣音；OpenAPI **required** 僅 `audio_url`） |
| **recommended** | `false` |
| **sourceHint** | 參考樣音網址(mp3/wav) |
| **strengths** | 阿里 zero-shot 中文克隆;自然度好、性價比高 |
| **bestFor** | 低成本試克隆聲線再決定正式版 |
| **供應商／底層** | 阿里 **Qwen3-TTS Clone-Voice 1.7B**（OpenAPI about＝「Clone Voice 17B」）via fal.ai |
| **角色定位** | 經濟 **試克隆／embedding 註冊** 路徑；`sc-voice-clone` pickIds[1]；showdown「專屬聲線克隆」**runner-up**（winner＝MiniMax voice-clone） |

**L0 靜態契約：** **ok（required）**／**input 語意落差**  
- 必填欄完整；`category ∈ CATEGORIES`；id 唯一；與 TTS 1.7b／0.6b 為獨立端點。  
- `input: (p,_f,s) => ({ text: p, audio_url: s })` → 有樣音時送出 **required `audio_url`** → **無缺必填 → 無 422 風險**。  
- 幽靈欄 **`text`**（官方無此 property；可選欄是 **`reference_text`**＝樣音逐字稿，非旁白正文）。  
- **產物型態錯位：** 官方 required 輸出 **`speaker_embedding`（File／safetensors）**；站內當「會出語音的 TTS」用。

**一句話：** 用短樣音換一把 **可餵給 Qwen TTS 的 speaker embedding**（**\$0.0008／分樣音**、幾乎免費）；**不是**按千字合成旁白，也**不會**直接吐 MP3。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| **points（目錄扁平）** | **3** |
| **cost（目錄現值）** | **`推估同 1.7B 級距 ~$0.09/千字`** |
| **官方價與單位（✅本回合查證）** | fal 模型頁：**\$0.0008 per minute**（樣音／請求分鐘；**非**千字） |
| **匯率假設** | USD×**31** ≈ NT$（`USD_TO_TWD`） |
| **估值 NT$（假設）** | 10 秒樣音 ≈ \$0.00013 ≈ **NT\$0.004**；1 分 ≈ **NT\$0.025**；上限 5 分樣音 ≈ \$0.004 ≈ **NT\$0.12** → 機械下限皆 **1 點** |
| **`parseRealCost`（現 cost）** | 吃到 `~\$0.09` 與「／千字」→ usdMid=**0.09**；multiplier=**null**（千字需人工）— 表列「需人工」且**單位假設錯** |
| **`estimatePoints`** | 現 cost 首報價單位「千字」→ 會進 **`ttsUsdPerKChar`=0.09** 動態；**但本端點不按旁白字數計費**（prompt 應是可選 reference_text）→ **估點語意錯誤** |
| **`docs/點數校準報告.md`** | 經濟列「推估 ~\$0.09/千字」→ 需人工（沿用舊推定） |
| **`docs/fal生態研究.md`** | 🔸推定同 1.7B 千字 → **應升 ✅已查證 \$0.0008/分** |
| **校準判定** | **偏貴（扁平 3 vs 實價≈1）**；**cost 字串錯誤**（千字推估應廢） |

**結論：**  
- **建議改 cost** → **`$0.0008/分(參考樣音長度；上限 5 分)`**（與模型頁一致）。  
- **建議改 points** → **`1`**（`realPricePoints`：\$0.0008×1 分×31≈0.025 → floor **1**）。  
- **本回合不寫入 models.ts**（審計卡只建議；調點另 PR）。  
- 勿再當「同 1.7B TTS \$0.09/千字」估毛利；真正量產旁白費在 **TTS 1.7b／0.6b** 按字。

---

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0** | **ok（required）** | `audio_url`＋needs audio；幽靈 `text` 不擋連通 |
| **OpenAPI Queue** | **HTTP 200** | `GET …/openapi.json?endpoint_id=fal-ai/qwen-3-tts/clone-voice/1.7b` → openapi **3.0.4**；`Qwen3TtsCloneVoice17bInput`／`Output` |
| **模型頁／標價** | ✅ | **\$0.0008／minute**；about／標題：zero-shot clone → 再餵 TTS |
| **L1 歷史** | 端點曾 **連通 200** | `docs/fal端點連通報告.md`：`✅ 連通(誤排佇列已取消)` |
| **dry-run probe** | 可列 fal 計畫 | **未** `--yes` |
| **live probe** | **未跑** | 本回合零 live；**禁止 `--yes`**；`needs: audio` → `verify-models --probe` 預設拒探 |
| **結論** | **ready-static-only（端點）／broken-product（站內閉環）** | schema 綠；成功回應亦可能整單「無法解析輸出」 |

### OpenAPI 摘要（2026-08-05）

**Input `Qwen3TtsCloneVoice17bInput`（Qwen3CloneVoiceInput）**

| property | 約束 | 站內 |
|----------|------|------|
| **`audio_url`** | string **required**；**最多 300 秒（5 分）**；短乾淨人聲即可 | ✅ `sourceUrl` → `audio_url` |
| **`reference_text`** | optional string｜null；樣音對應文稿可改善後續合成 | ❌ 未送；誤用 **`text`** |

**Output `Qwen3TtsCloneVoice17bOutput`**

| property | 約束 | 站內 |
|----------|------|------|
| **`speaker_embedding`** | File **required** — safetensors（例 `content_type: application/octet-stream`，~16KB，`*.safetensors`） | ❌ **`extractResult` 完全不認** |

**輸出抽取（現況）：**  
`extractResult` 認 `audio`／`audio_file`／`audio_url`／`file`／`model_file`／LoRA… — **無 `speaker_embedding` 分支**。  
成功克隆 → 無 url／無 text → generation **failed「無法解析模型輸出」**（供應商可能已收 \$0.0008 級費用）。

**x-fal-metadata：** endpointId 本 id；category=**`audio-to-audio`**；playground／documentation 齊；about=「Clone Voice 17B」。

---

## 4. 底層邏輯

### 4.1 模型能力（公開資料）

- **兩段式產品：** (1) 本端點：樣音 → **speaker embedding（safetensors）**；(2) `fal-ai/qwen-3-tts/text-to-speech/1.7b`（或 0.6b）以 **`speaker_voice_embedding_file_url`** 引用該檔合成旁白。  
- **Zero-shot：** 無需 fine-tune；短 clip 即可（官方：clean speech sufficient；**≤5 分**）。  
- **`reference_text`：** 可選；描述寫「建立 embedding 時用的參考文稿，提供可改善合成品質」。  
- **姊妹端點：** `clone-voice/0.6b` Input／Output **同構**（僅 06B 線）；站內**未列** 0.6b clone。  
- **TTS 側：** embedding 提供後 **忽略** 預設 `voice` enum 與風格 `prompt`；旁白正文仍是 TTS 的 required **`text`**。  
- **與 MiniMax voice-clone 差異：** MiniMax 付 **\$1.50** 換可複用 **custom_voice_id**＋可選預覽 MP3；本模 **極低價換 embedding 檔**，量產費在 Qwen TTS 千字價。

### 4.2 官方 OpenAPI vs 站內

| 官方 | 站內 | 備註 |
|------|------|------|
| required `audio_url` | ✅ + needs audio | 契約 ok |
| optional `reference_text` | ❌ | 改送幽靈 **`text`**（prompt 當旁白） |
| 輸出 **speaker_embedding.url** | ❌ | **P0** 解析失敗 |
| fal category audio-to-audio | 站內 text-to-speech | 目錄分組可接受；勿當「直接 TTS」文案 |
| 計費 \$0.0008/分 | cost 推估千字、points=3 | **P1 校準** |

- **世界觀／卡片錨點：** TTS **排除**注入 → 合理。  
- **negative／seed：** 不適用。

### 4.3 風險／落差

1. **P0 — embedding 管線斷：** 扣點後即使 fal 200，站內解析失敗；無 safetensors URL 可複製。  
2. **P0 — 未串 Qwen TTS：** 1.7b／0.6b 站內 input 僅 `{ text: p }`，**未暴露** `speaker_voice_embedding_file_url`／`reference_text`。sc／showdown「試克隆」**執行層未閉環**。  
3. **P1 — cost／points 錯：** 目錄與生態研究沿用 🔸千字推定；官方 **\$0.0008/分**；扁平 3 **偏貴**；動態千字估點 **誤導**。  
4. **P2 — 幽靈 `text`：** 多半被忽略；若上游嚴格校驗可能警告；語意上使用者以為在「克隆後唸稿」，實際只註冊 embedding。  
5. **P2 — 樣音過長：** >300s 上游拒；sourceHint 未寫上限。  
6. **授權／敏感：** 克隆真人需同意——與 MiniMax 卡同。  
7. **verified=false：** 助手不優先；配方仍可點到 → 體驗更糟（付點失敗）。  
8. **models 註解「未親驗」：** 端點 OpenAPI＋歷史 L1 已證明存活；待修的是**產品與標價**。

### 4.4 與家族／情境配方

| id／配方 | 角色 | 與本卡 |
|----------|------|--------|
| `sc-voice-clone` | 建立會方專屬旁白聲線 | pickIds[1]=本 id；why：更省、相似度可先試 |
| showdown 專屬聲線克隆 | runner-up=本 id | winner MiniMax（永久 voice_id） |
| `…/text-to-speech/1.7b` | 旗艦中文量產 | **應**吃 embedding；站內未接 |
| `…/text-to-speech/0.6b` | 經濟 TTS | 官方接 `clone-voice/0.6b` embedding；1.7b embedding 跨線相容**待 live** |
| `…/clone-voice/0.6b` | 輕量克隆（站外） | 同構；站內無條目 |
| MiniMax voice-clone (#219) | 旗艦註冊 ID | 型態不同；同屬 sc-voice-clone |
| F5-TTS / Index / Dia clone | 每次帶樣音即時合成 | 本模是 **預先 embedding**，非單次 zero-shot 出音 |

---

## 5. 站內扣點／退點

| 環節 | 行為 |
|------|------|
| 估點 | cost 含「\$…/千字」→ **`ttsUsdPerKChar`=0.09**；有 `promptChars` 時 `max(1, round(0.09×31×chars/1000))`；無字 → 扁平 **3** |
| 扣點 | `reserveQuota(…, est, …)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／陳屍 `refund` 與 est 對稱（解析失敗路徑應退點） |
| UI 顯示 | 目錄 **3**；若使用者填長「旁白」prompt，估點可被**錯誤抬高**（實價與字數無關） |
| 缺來源 | `needs: audio` → 生成前 BAD_REQUEST，不進 fal |
| 工作流 | 含本步時按千字 8000 最壞會把本步估成 **22 點級** → **嚴重高估** |

**一致性：** 顯示／預留／退點同一 est 路徑 → **架構對稱 ok**。  
**帳單落差：** fal ≈ \$0.0008×樣音分；站內收 3+（或錯誤按字）→ ** systematically 超收**（P1）。  
**本模無 live 對帳。**

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填來源 | 素材庫音訊／URL → **`audio_url`**（建議短乾淨人聲；**≤300s**） |
| 「正文」prompt | 站內 → 幽靈 **`text`**；官方可選是 **`reference_text`**（樣音逐字稿，**不是**要合成的旁白） |
| 空稿 | 僅音即可（required 僅 audio）；空 prompt 不影響官方契約 |
| 長度 | 樣音 ≤5 分；reference_text 無 OpenAPI max |
| 估點字數 | 誤用 prompt.length × \$0.09/千字（應改扁平 1） |
| 注入 | 不注入世界觀／卡片 |
| 建議用法 | 上傳授權樣音 → 取得 embedding URL → **另一步** Qwen TTS 餵 embedding＋真正旁白稿 |
| 可選（未接） | `reference_text` |

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|:----:|------|
| 低成本試克隆像不像 | △ 意圖／❌ 現況 | 官方極便宜；**站內解析＋TTS 斷鏈** → 試聽閉環不成立 |
| 建立可重複會方聲線 | △ | 產物是 embedding 檔（可存 URL）；**非** MiniMax voice_id；需產品保存＋TTS 引用 UI |
| 克隆後量產中文旁白 | ❌ 斷鏈 | 需 `speaker_voice_embedding_file_url` → Qwen TTS |
| 日更短口白（免克隆） | ❌ | 用 Qwen TTS 1.7b／0.6b 預設聲 |
| 旗艦永久聲線註冊 | ❌ 主力 | MiniMax voice-clone（47 點） |
| 不克隆真人的專屬聲 | ❌ | MiniMax／Qwen voice-design |
| 助手自動挑選 | ❌ | verified=false |
| 手動台／sc-voice-clone | ✅ 可選到 | 需音訊；**成功體驗破碎** |
| recommended | 否 | 合理（管線未閉環；標價錯） |

**文案審（L6）：**  
- bestFor「低成本試克隆再決定正式版」**產品意圖對**；執行未兌現。  
- strengths「zero-shot 中文克隆」易被理解成「一次出克隆旁白」——宜改為 **「樣音→embedding，再接 Qwen TTS」**。  
- cost「~\$0.09/千字」**誤導**；應改 \$0.0008/分並註明量產另計 TTS。  
- sc why「更省、相似度」方向可留；help 須寫：無預覽 MP3、產物 safetensors、需第二步。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| Playground | `https://fal.ai/models/fal-ai/qwen-3-tts/clone-voice/1.7b` |
| API 文檔 | `https://fal.ai/models/fal-ai/qwen-3-tts/clone-voice/1.7b/api` |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/qwen-3-tts/clone-voice/1.7b`（本回合 **200**） |
| 標價 | **\$0.0008／minute** |
| MCP | `generate_into_scene` 等同路徑；**可調**但需 audio＋點數；成品語意破碎（無 embedding 抽取） |
| 助手 | 偏好 verified；配方仍可指向本 id |
| 檢視者 | 唯讀，不送生成 |
| 連通史 | `docs/fal端點連通報告.md` 已標連通 |
| 生態／校準／清查 | 生態 🔸推定千字 → **應改**；校準需人工列應改 \$0.0008/分；清查需素材 |

---

## 9. 建議動作

- [ ] **維持 points=3／現 cost** — **不建議維持標價**；端點 id／category／needs／verified=false **可暫維**  
- [x] **本回合書面建議（不寫入 models.ts）**  
  - **調 cost** → **`$0.0008/分(參考樣音長度；上限5分)`**  
  - **調 points** → **`1`**（實價 floor；勿再吃 ttsUsdPerKChar）  
  - **修 input** → `{ audio_url: s, reference_text: p || undefined }`（或 p 空則省略；**刪幽靈 text**）  
- [ ] **P0 修 output 解析** — `extractResult` 應認 **`speaker_embedding.url`**（比照 LoRA：`resultText` 標「聲線 embedding」＋ URL；可選 url 並存方便下載）  
- [ ] **P0 產品閉環** — 專案保存 embedding URL；Qwen TTS 1.7b／0.6b 暴露 `speaker_voice_embedding_file_url`（＋可選 reference_text）；UI 標「兩步：克隆→合成」  
- [ ] **verified true** — **僅建議，勿擅自改**：待 L4 樣音成功 **且** embedding 可讀 **且** 串 TTS 出音後再人工開  
- [ ] **下架或隱藏** — 管線修好前可考慮 help「進階／需第二步」或配方降級，避免 sc 把使用者導入必失敗路徑；**不建議直接下架端點**（OpenAPI 存活、價優）  
- [ ] **文案** — 生態研究升 ✅；目錄 strengths／cost；sourceHint 加「≤5 分」  
- [ ] **Live 佇列（可選，控費）**  
  - 估點：`npx tsx scripts/verify-models.ts --probe "fal-ai/qwen-3-tts/clone-voice/1.7b"`（needs → 可能拒探）  
  - 真跑：**單次**、FAL_KEY＋短樣音；**禁止批次 --yes**（費用極低但禁自動）  
  - 對帳：帳單 ≈\$0.0008×分 vs 扣 3；JSON 含 `speaker_embedding.url`  
  - 串測：embedding → TTS 1.7b `speaker_voice_embedding_file_url`＋短中文 `text`

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅required | 📄OpenAPI | 未跑(needs) | **調點／cost＋P0 embedding 抽取與 TTS 串**；ready-static-only；verified=false；**勿**當 \$0.09/千字 |

### 研究來源（static+research）

- `shared/models.ts`（entry #220 註解「推定」、input `{text,audio_url}`、sc-voice-clone、showdown runner-up、estimatePoints／ttsUsdPerKChar）  
- `server/services/fal.ts` `extractResult`（無 `speaker_embedding`）  
- fal OpenAPI `Qwen3TtsCloneVoice17bInput`／`Output`（HTTP 200）；TTS 1.7b 的 `speaker_voice_embedding_file_url`  
- 公開標價：**\$0.0008 per minute**（模型頁）  
- 對照：`clone-voice/0.6b` 同構；`docs/fal端點連通報告.md`、`docs/fal生態研究.md`、`docs/點數校準報告.md`、`docs/模型目錄.md`、#217／#219 卡  

**未做：** 任何 `--yes` live、任何改 `verified`／`points`／`cost`／`input` 寫入 `models.ts`。
