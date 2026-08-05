# fal-ai/minimax/voice-clone

> 審計：R5 · index **#219** · 模式 **static+research（零 live / 禁止 --yes）** · 2026-08-05  
> slug：`fal-ai__minimax__voice-clone` · 單一真相：`shared/models.ts`  
> **L0 input 契約 ok**（required 僅 `audio_url`）；**P0 產品缺口**：輸出主產物 `custom_voice_id` 站內未抽取、未串 MiniMax TTS。未改 `verified`／`points`。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| **index** | 219 |
| **id** | `fal-ai/minimax/voice-clone` |
| **endpoint** | 同 id（`endpointOf`＝id，無 alias） |
| **label** | MiniMax 語音克隆 |
| **category** | `text-to-speech` |
| **tier** | `flagship` |
| **kind** | `audio` |
| **verified** | **`false`**（目錄 ⚠︎） |
| **needs** | **`audio`**（樣音；OpenAPI **required** `audio_url`） |
| **recommended** | `false` |
| **sourceHint** | 10 秒以上樣音網址(mp3/wav) |
| **strengths** | 10 秒樣音複製中文聲線;承襲 MiniMax 旗艦品質 |
| **bestFor** | 建立會方專屬旁白聲線 |
| **供應商／底層** | **MiniMax Voice Clone** via fal.ai（產出可複用 `custom_voice_id`，再餵 MiniMax TTS） |
| **角色定位** | 旗艦 **註冊／永久聲線** 路徑；`sc-voice-clone` pickIds[0]；showdown「專屬聲線克隆」**winner**（runner-up＝Qwen 3 clone-voice 1.7b） |

**L0 靜態契約：** **ok**  
- 必填欄完整；`category ∈ CATEGORIES`；id 唯一。  
- `input: (p,_f,s) => ({ audio_url: s, text: p })` → 樣例含 required `audio_url`；`text` 為可選預覽稿（官方有 default）。  
- **無缺必填 → 有樣音時無 422 風險**（與 #218 Index TTS 修前不同）。

**一句話：** 付 **$1.50／次** 換一把可重複取用的 **custom_voice_id**（7 天內須再用一次 MiniMax TTS 才永久保留）；預覽音另計 **$0.30／千字**。站內扁平 **47 點**≈實價；**真正賣點是 voice_id，不是單次預覽 MP3**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| **points（目錄扁平）** | **47** |
| **cost** | **`克隆 $1.50/次+預覽音 $0.30/千字;克隆後 7 天內需用一次 TTS 以永久保留`** |
| **官方價與單位** | fal 模型頁／learn：**$1.5 per voice clone**；preview inputs **$0.3 per 1000 characters**（WebSearch／生態文 **✅已查證** 一致） |
| **匯率假設** | USD×**31** ≈ NT$（`USD_TO_TWD`） |
| **`parseRealCost`** | usdMid=**1.5**；首單位「／次」→ multiplier=**1**（`×1（每次一件）`） |
| **`realPricePoints`** | `round(1.5×1×31)=round(46.5)=`**47** → 與目錄扁平 **一致** |
| **動態估點 `estimatePoints`** | **無** ttsUsdPerKChar（**首個** `$…/單位` 是「／次」不是「／千字」——`models.ts` 註解刻意避免把預覽千字當主價）→ **一律扁平 47**；**不**隨 `promptChars` 上升 |
| **`docs/點數校準報告.md`** | 46.5 → **≈**（表列旗艦 MiniMax 語音克隆） |
| **校準判定** | **≈（克隆本體）**；預覽字數加價 **未進估點**（見下風險） |

**結論：**  
- **不建議改扁平 points**（47 已對 $1.50／次）。  
- **P2 毛利：** 站內 `input` **一律送 `text: p`** → fal 幾乎每次都產預覽並加收 **$0.30／千字**；短稿可忽略（百字 ≈ $0.03），若使用者把**整段旁白**當 prompt（schema **maxLength 1000**）→ 額外最多 ≈ **$0.30 ≈ 9 點**未估入，47 點略低估總帳單。  
- 與「免來源旗艦 TTS」比：克隆是**一次性高價註冊**；日後用 `speech-02-hd`／`speech-2.6-hd` 才走 $0.10／千字量產。

---

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0** | **ok** | required 僅 `audio_url`；站內有 `needs: audio`＋送 `audio_url` |
| **OpenAPI Queue** | **HTTP 200** | `GET …/openapi.json?endpoint_id=fal-ai/minimax/voice-clone` → openapi **3.0.4**；`MinimaxVoiceCloneInput`／`Output` |
| **模型頁／標價** | ✅ | $1.5／clone + $0.3／1k preview chars；about：Clone from audio URL；optional TTS preview |
| **L1 歷史** | 端點曾 **連通 200** | `docs/fal端點連通報告.md`：`✅ 連通(誤排佇列已取消)` |
| **dry-run probe** | 可列 fal 計畫 | **未** `--yes` |
| **live probe** | **未跑** | 本回合零 live；**禁止 `--yes`**；`needs: audio` → `verify-models --probe` 預設拒探（需素材） |
| **結論** | **ready-static-only** | 契約綠；待 L4 帶樣音最小預覽後可建議 verified（**仍須先解 voice_id 抽取**，否則 verified 只證明「能出預覽音」） |

### OpenAPI 摘要（2026-08-05）

**Input `MinimaxVoiceCloneInput`（VoiceCloneRequest）**

| property | 約束 | 站內 |
|----------|------|------|
| **`audio_url`** | string **required**；≥10 秒；7 天內須用 TTS 永久保留否則刪 | ✅ `sourceUrl` → `audio_url` |
| `noise_reduction` | bool default **false** | ❌ |
| `need_volume_normalization` | bool default **false** | ❌ |
| `accuracy` | number 0–1 或 null（text validation threshold） | ❌ |
| **`text`** | optional；default 英文預覽句；**maxLength 1000** | ✅ 送 `positivePrompt`（可空稿？表單通常擋；空時上游 default） |
| `model` | enum preview TTS：`speech-02-hd`（**default**）／`speech-02-turbo`／`speech-01-hd`／`speech-01-turbo` | ❌ 吃 default **02-hd**（**非** 2.6-hd） |

**Output `MinimaxVoiceCloneOutput`**

| property | 約束 | 站內 |
|----------|------|------|
| **`custom_voice_id`** | string **required** — *The cloned voice ID for use with TTS* | ❌ **`extractResult` 完全不認** |
| `audio` | File \| null — 預覽音（if requested） | △ 有則走 `audio.url` → 當一般音訊素材 |

**輸出抽取（現況）：**  
`extractResult` 優先 `result.audio.url` → 成功時使用者只拿到**預覽 MP3**；**`custom_voice_id` 丟棄**。  
若 `audio` 為 null 且無其他 media／text → `falStatus` 回 **failed**「無法解析模型輸出」——連 $1.50 的 ID 也救不回來。

**x-fal-metadata：** endpointId 本 id；category=`text-to-speech`；playground／documentation 齊；about=「Clone a voice from an audio URL. Optionally, generate a TTS preview…」

---

## 4. 底層邏輯

### 4.1 模型能力（公開資料）

- **兩段式產品：** (1) 本端點註冊克隆 → `custom_voice_id`；(2) 任意 MiniMax TTS（站內 `speech-02-hd`／`speech-2.6-hd` 等）的 `voice_setting.voice_id` 引用該 ID 量產旁白。  
- **樣音：** 官方描述至少 **10 秒**（與 sourceHint／目錄一致）；MiniMax 自家產品頁常見 10–60 秒乾淨人聲建議。  
- **保留規則：** 描述寫明 **7 天內**至少用一次 TTS 端點，否則自動刪除——**站內無「首次 TTS 激活」工作流／提醒**。  
- **預覽：** `text`＋`model` 控制預覽合成；計費與克隆本體分離（$0.30／千字）。  
- **可選品質：** noise_reduction／volume_normalization／accuracy——站內全 default。  
- **與 zero-shot 即時克隆差異：** Qwen／F5／Index 是「每次帶參考音就唸」；本模是「**付註冊費換可複用 ID**」——`docs/模型指南研究補遺.md` 已改 sc 理由：優勢是 **可重複取用聲線 ID**，非單次相似度冠軍。

### 4.2 官方 OpenAPI vs 站內

| 官方 | 站內 | 備註 |
|------|------|------|
| required `audio_url` | ✅ + needs audio | 契約 ok |
| optional `text` | ✅ 當「生成 prompt」送出 | 產品語意：使用者以為在「配音」，實際是「註冊＋預覽稿」 |
| `model` 預覽引擎 | ❌ default 02-hd | 2.6-hd 不在本端點 enum |
| 降噪／音量／accuracy | ❌ | |
| 輸出 **custom_voice_id** | ❌ | **P0** |
| 輸出 preview **audio** | △ 當唯一成品 | 掩蓋 ID 遺失 |

- **世界觀／卡片錨點：** TTS **排除**注入 → 合理；音色來自音訊來源，不來自角色卡。  
- **negative／seed：** 不適用。

### 4.3 風險／落差

1. **P0 — voice_id 管線斷：** 扣 47 點後若有預覽音，素材庫只有 MP3，**沒有可複製的 voice_id**；無法在 `speech-2.6-hd` 的 `voice_setting` 使用（該端點站內也**未暴露** voice_id UI，見 #216 卡）。sc-voice-clone／showdown winner 的「專屬聲線」**在執行層未閉環**。  
2. **P0/P1 — 空 audio 解析失敗：** 僅 ID 無預覽時整單 failed＋可能退點，但供應商側可能已計克隆費（待 live／帳單確認）。  
3. **P2 — 預覽加價未估點：** 長 `text` 低估；`maxLength 1000` 過長稿可能上游拒。  
4. **P2 — 誤用為「貴版 TTS」：** 文案／UI 若未強調「註冊聲線」，使用者可能用 47 點換一次預覽（遠貴於 3 點旗艦 TTS）。  
5. **授權／敏感：** 生態文已寫克隆師父／志工聲需書面同意——產品層合規提示仍弱。  
6. **verified=false：** 助手不優先；配方仍可點到。  
7. **probe：** needs → 勿當免來源硬探。

### 4.4 與家族／情境配方

| id／配方 | 角色 | 與本卡 |
|----------|------|--------|
| `sc-voice-clone` | 建立會方專屬旁白聲線 | pickIds[0]=本 id；why 已強調可複用 ID |
| showdown 專屬聲線克隆 | winner=本 id | runner-up Qwen clone 1.7b（試聽／相似度） |
| MiniMax speech-02-hd / 2.6-hd | 量產旁白 | **應**吃 `custom_voice_id`；站內 voice_setting **未接** |
| MiniMax voice-design (#221) | 文字造聲（不克隆真人） | 同家族 ID 產物型；$3／聲（外部） |
| Qwen clone-voice 1.7b | 經濟試克隆 | 型態不同（多為即時參考／embedding，非 MiniMax voice_id） |
| Index TTS / F5 | 每次帶樣音 | 無永久 MiniMax ID |

---

## 5. 站內扣點／退點

| 環節 | 行為 |
|------|------|
| 估點 | `estimatePoints` → **扁平 47**（無 per-k；與字數無關） |
| 扣點 | `reserveQuota(…, est=47, …)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／陳屍 `refund` 與 est 對稱 |
| UI 顯示 | 目錄 **47**；有 prompt 亦 47 |
| 缺來源 | `needs: audio` → 生成前 BAD_REQUEST，不進 fal |
| 工作流 | 本步固定 +47；非千字 8000 字最壞路徑 |

**一致性：** 顯示／預留／退點同為 47 → **架構對稱 ok**。  
**帳單落差：** fal = $1.50 + preview $0.30×chars/1000；站內只收 47 → 預覽段 **略低收**（P2）。  
**本模無 live 對帳。**

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填來源 | 素材庫音訊／URL → **`audio_url`**（≥10s 建議） |
| 「正文」 | 使用者 prompt → **`text`**＝**預覽稿**（非「永久旁白腳本」）；官方 default 英文預覽句 |
| 空稿 | 若站內放行空 prompt，上游可走 default text 仍產預覽；缺音則 needs 擋 |
| 長度 | `text` **maxLength 1000**；估點**不**隨字數變 |
| 注入 | 不注入世界觀／卡片 |
| 建議用法 | 短句預覽（中文亦可）＋乾淨樣音；成功後**應**保存 voice_id（待產品修）再轉 TTS 量產 |
| 可選（未接） | noise_reduction、need_volume_normalization、accuracy、model |

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|:----:|------|
| 建立會方固定旁白聲（有授權樣音） | △／✅ 意圖 | 官方能力完整；**站內缺 ID 保存與 TTS 串接** → 現況僅「貴預覽」 |
| 克隆後量產開示／見證旁白 | ❌ 斷鏈 | 需 voice_id → MiniMax TTS；兩端 UI／解析皆未接 |
| 低成本試音色像不像 | ❌ 主力 | 用 Qwen clone／F5（3／2 點）；本模 47 點太重 |
| 日更短口白 | ❌ | 用 Qwen／Kokoro；勿每次克隆 |
| 不克隆真人的專屬聲 | ❌ | `voice-design` |
| 英文短劇角色一致 | △ | 可克隆；Dia clone 更對話向 |
| 助手自動挑選 | ❌ | verified=false |
| 手動台／sc-voice-clone | ✅ 可選到 | 需音訊來源；成功體驗不完整 |
| recommended | 否 | 合理（未 verified；管線未閉環） |

**文案審（L6）：**  
- bestFor／sc why 方向正確（可複用 ID）。  
- strengths「承襲旗艦品質」易被理解成「單次克隆音質最好」——補遺已指出 **相似度 Qwen 可能更高**；宜強調 **永久 voice_id + MiniMax 合成鏈**。  
- UI help 應寫：費用＝註冊；預覽字另計；7 天內須 TTS 激活；需本人授權。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| Playground | `https://fal.ai/models/fal-ai/minimax/voice-clone` |
| API 文檔 | `https://fal.ai/models/fal-ai/minimax/voice-clone/api` |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/minimax/voice-clone`（本回合 **200**） |
| 標價 | $1.5／clone；$0.3／1k preview chars |
| MCP | `generate_into_scene` 等同路徑；**可調**但需 audio＋47 點；成品語意破碎（缺 ID） |
| 助手 | 偏好 verified；配方仍可指向本 id |
| 檢視者 | 唯讀，不送生成 |
| 連通史 | `docs/fal端點連通報告.md` 已標連通 |
| 生態／校準／清查 | `docs/fal生態研究.md` ✅；$1.50→47≈；清查需素材實測 |

---

## 9. 建議動作

- [x] **維持** points=**47**、cost 字串、verified=**false**、id／endpoint／category、`needs: audio`、input `{ audio_url, text }`（**L0 契約對齊**；禁止自動 verified true）  
- [ ] **調 points** — **不需要**（≈$1.50／次）；可選 P2：預覽字數併入 est 或限制預覽稿長度／固定短預覽句  
- [ ] **修 input** — **不需要**（無 422 風險）  
- [ ] **P0 修 output 解析** — `extractResult`（或 generation 特判）應保留 **`custom_voice_id`**：  
  - 建議比照 LoRA：`resultText` 明確寫出 ID＋使用說明；有 `audio` 時 **url 與 text 並存**  
  - 避免「只有 ID、無 audio」整單 failed  
- [ ] **P0 產品閉環** — 站內保存 voice_id（專案 props／聲線庫）；MiniMax TTS（02-hd／2.6-hd）暴露 `voice_setting.voice_id`；7 天激活提醒  
- [ ] **verified true** — **僅建議，勿擅自改**：待 L4 樣音成功 **且** ID 可讀可複製後再人工開  
- [ ] **下架或隱藏** — 不需要；管線修好前可在 help 標「進階／需保存 voice_id」避免當普通 TTS  
- [ ] **文案** — strengths／UI：可複用 ID、授權、7 天、非最低成本試聽  
- [ ] **Live 佇列（可選，控費）**  
  - 估點：`npx tsx scripts/verify-models.ts --probe "fal-ai/minimax/voice-clone"`（needs → 可能拒探）  
  - 真跑：**單次**、需 FAL_KEY＋≥10s 樣音＋短預覽句；**禁止批次 --yes**（單次 ≈$1.5+，47 點級）  
  - 對帳：帳單 $1.50+preview vs 扣 47；回應 JSON 含 `custom_voice_id`  

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄OpenAPI | 未跑(needs) | **維持** points=47／verified=false／input；ready-static-only；**P0** custom_voice_id 未抽取＋TTS 未串（預覽加價估點 P2） |

### 研究來源（static+research）

- `shared/models.ts`（entry #219、estimatePoints 首報價／次註解、sc-voice-clone、showdown winner、realPricePoints）  
- `shared/models.test.ts`（voice-clone 扁平估點）  
- `server/services/fal.ts` `extractResult`（無 custom_voice_id 分支）  
- `server/services/generationCore.ts`（needs、空輸出失敗）  
- fal OpenAPI `MinimaxVoiceCloneInput`／`Output`（HTTP 200）  
- 公開標價：$1.5／clone、$0.3／1k preview；7 日 TTS 保留規則  
- 站內：`docs/fal生態研究.md`、`docs/點數校準報告.md`、`docs/fal端點連通報告.md`、`docs/模型目錄.md`、`docs/模型指南研究補遺.md`  

**未做：** 任何 `--yes` live、任何改 `verified`／`points`／`input` 寫入 `models.ts`。
