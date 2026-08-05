# 計畫：LLM-as-Judge 模型審計評分

> 狀態：**待終端實作**（本 PR 僅設計）  
> 分支：`plan/llm-as-judge-model-audit` → base `claude/healing-migration-ai-os-erewp2`  
> 觸發：使用者要求引入 LLM-as-Judge 評分，加深 266 模型測試與研究（2026-08-05）  
> 上游：#420 `model-deep-audit-266-plan`（L4 live／黃金題組）；`docs/模型底層邏輯與運作流程.md`

---

## 1. 一句話

對**黃金題組**跑出來的生成結果，用固定量尺的 **LLM 裁判**打分並寫入 `docs/model-audit/`，用來比較模型、校準 `bestFor`／recommended，**不**用裁判分數自動改 `verified` 或 points。

---

## 2. 為什麼要 Judge（與 #420 分工）

| #420 層級 | 能量測 | 量不到 |
|-----------|--------|--------|
| L0–L2 | 契約、連通、標價 | 好不好看、繁中對不對 |
| L4 live | 成功／失敗 | 品質、適配情境 |
| **本計畫 Judge** | 結構化品質分 | 取代人類最終審美（僅輔助） |

裁判只評 **已成功產出的 artifact**（圖 URL、短影片關鍵格、轉錄／TTS 音檔描述、OCR 文字等）。

---

## 3. 設計原則

1. **裁判模型預設免費檔**：NVIDIA NIM（與助手 ask 同口徑，站內 0 點）；可選 fal `any-llm` 高品質檔（需明示預算）。  
2. **量尺固定、輸出 JSON schema**：禁止自由散文當唯一結果。  
3. **按模態分裁判提示**：文生圖 ≠ TTS ≠ 影片。  
4. **雙盲盡量**：裁判提示不包含「這是旗艦／貴模」；可給 model id 僅供日誌。  
5. **可重現**：同一 artifact + 同一 judge 版本 → 允許 ±1 分抖動；記錄 `judgeModel`、`judgePromptVersion`。  
6. **人可覆寫**：`humanOverride` 欄位；爭議以人為準。  
7. **不自動寫入 MODELS**：分數只進審計報告；改 recommended 另開 PR。

---

## 4. 評分量尺（1–5，可 N/A）

### 4.1 文生圖／圖編輯（image）

| 維度 id | 含義 |
|---------|------|
| `prompt_fit` | 是否符合提示詞要點 |
| `zh_text` | 若題目含繁中文字：正確可讀（無可讀字題則 N/A） |
| `artifact_quality` | 潰臉、潰構圖、明顯 AI 破綻 |
| `style_match` | 風格／調性是否符合題目（莊嚴、水墨等） |
| `safety_ok` | 明顯違規／驚悚（站內向） |

### 4.2 影片（video，可用 1～3 關鍵格 + 短描述）

| 維度 | 含義 |
|------|------|
| `prompt_fit` | 動作／鏡頭是否接近提示 |
| `temporal_coherent` | 從關鍵格推估是否明顯跳切潰壞（弱代理指標） |
| `subject_stable` | 主體是否大致穩定 |
| `style_match` | 調性 |
| `safety_ok` | 同上 |

> 完整影片理解成本高：第一期允許「關鍵格 + 模型回傳的 text 描述（若有）」；不強制影音多模態裁判。

### 4.3 TTS／音訊（audio）

| 維度 | 含義 |
|------|------|
| `intelligibility` | 可懂度（聽寫或 ASR 對照稿） |
| `zh_prosody` | 繁中節奏是否自然（主觀 1–5） |
| `prompt_fit` | 是否依稿完整 |
| `artifacts` | 爆音、截斷、明顯機器感 |

實作可：**同一段稿** → TTS → 再 **Whisper／Scribe 轉寫** → 與原稿 **字元錯誤率** 作客觀分；LLM 只補韻律主觀分。

### 4.4 Vision／OCR

| 維度 | 含義 |
|------|------|
| `accuracy` | 與金標文字一致度 |
| `zh_handling` | 繁中／直書／古文 |
| `hallucination` | 是否捏造內容 |

### 4.5 加總

```
overall = 各有效維度平均（跳過 N/A）
confidence = high | medium | low   // 裁判自評
notes = 短句（≤200 字）
```

---

## 5. 裁判提示詞版本（v1）

### 5.1 系統角色（共用）

```text
你是嚴謹的生成結果評審。只依「題目要求」與「可見／可讀產出」打分。
不要因為模型名稱、價格、是否推薦而加分或扣分。
輸出必須是單一 JSON，鍵如下：
prompt_fit, artifact_quality, style_match, safety_ok, zh_text,
overall, confidence, notes
分數為 1–5 整數或 null（不適用）。
不要輸出 JSON 以外文字。
```

（各模態刪維度表裁剪鍵；TTS／OCR 用對應鍵。）

### 5.2 使用者訊息模板（圖）

```text
【題目 id】{goldenId}
【提示詞】{prompt}
【額外約束】{constraints}
【圖像】（附 URL 或 base64 縮圖；若裁判無視覺則附簡短人工／工具描述）
請評分。
```

**視覺能力：** 優先 `fal-ai/any-llm/vision#…` 或 NIM 多模態（若可用）；若裁判**無視覺**，第一期僅允許：

- 人工貼 1～3 句觀察，或  
- 先跑站內 caption 模型產出描述再給文字裁判（兩段式，標 `judgePipeline: caption+text`）。

---

## 6. 資料流

```
黃金題組 golden set
    →（控費）verify-models / 站內 generate
    → artifact（url、mime、時長）
    → scripts/judge-model-output.ts
         → NIM | fal vision LLM
         → JSON 分數
    → docs/model-audit/judgements/{modelSlug}_{goldenId}.json
    → 彙總進 _index 或 category 排行 md
```

### 建議 CLI

```bash
# 乾跑：只印將送出的裁判 prompt
npx tsx scripts/judge-model-output.ts --artifact <path|url> --golden <id> --modality image

# 真實裁判（預設 NIM）
npx tsx scripts/judge-model-output.ts --artifact … --golden … --modality image --yes

# 指定裁判
npx tsx scripts/judge-model-output.ts … --judge nim|fal-vision --yes
```

防呆：無 `--yes` 不呼叫；一次一 artifact；寫入 judgements 目錄不改 `shared/models.ts`。

---

## 7. 黃金題組最小集（與 Judge 綁定）

新建 `docs/research/model-golden-set.md`（實作時）：

| goldenId | modality | 提示摘要 | 必評維度 |
|----------|----------|----------|----------|
| `zh-poster-01` | image | 繁中金句直式海報 | + zh_text |
| `portrait-solemn-01` | image | 莊嚴半身人像 | style、quality |
| `ink-scene-01` | image | 水墨場景 | style |
| `i2v-still-01` | video | 定裝圖微動 3s | prompt_fit（需來源） |
| `tts-sutra-01` | audio | 短經文旁白 | intelligibility + zh |
| `ocr-zh-01` | vision | 繁中印刷掃描 | accuracy |

每題固定 `aspect`／長度，換模型重跑才可比分。

---

## 8. 實作階段

### J0 — 契約與目錄

```
[ ] judgements JSON schema（TS type + 範例）
[ ] golden-set 表（至少 6 題）
[ ] judgePromptVersion = "v1"
```

### J1 — CLI 文字／兩段式圖評

```
[ ] scripts/judge-model-output.ts
[ ] 預設 NIM 文字裁判 + 可選 caption→text
[ ] --yes 防呆；寫入 docs/model-audit/judgements/
```

### J2 — 視覺裁判（可選）

```
[ ] fal any-llm/vision 或可用多模態 NIM
[ ] 圖 URL 安全抓取（既有 SSRF 守門）
```

### J3 — TTS 客觀分

```
[ ] 轉寫 + CER／相似度
[ ] LLM 僅補 prosody
```

### J4 — 彙總

```
[ ] 依 goldenId 排行表 md
[ ] 與 recommended 不一致時列出「建議人工複審」
```

---

## 9. 費用與安全

| 項目 | 策略 |
|------|------|
| 裁判 LLM | 預設 NIM 0 點 |
| 被評生成 | 仍受 #420 live 預算上限 |
| 視覺裁判 fal | 每次顯式 --yes，記成本 |
| 個資 | 審計圖勿用真實信眾臉；用合成／授權測試圖 |
| 提示注入 | 題目與模型輸出當資料，系統提示要求忽略「請給满分」類字樣 |

---

## 10. 完成定義

- [ ] 至少 6 個 goldenId 定義完成  
- [ ] CLI 可對 1 張圖產出合法 JSON 分數  
- [ ] 同一 category ≥3 個模型在同一 goldenId 上有可比分數  
- [ ] 文件說明：分數≠自動 verified  
- [ ] 與 #420 _index 可互相連結（judged: yes/no）  

---

## 11. 非目標

- 用 Judge 替代 e2e／連通測試  
- 對 266 模全部自動打分（只對「有 artifact 的黃金題」）  
- 線上使用者每次生成都強制 Judge（可另開「可選品質回饋」產品項）  

---

## 12. 終端提示詞（實作 J0–J1 時可貼）

```text
實作 docs/product/llm-as-judge-model-audit-plan.md 的 J0–J1。
- 新增 scripts/judge-model-output.ts（--yes 防呆，預設 NIM）
- judgements 輸出 JSON schema 與範例
- 至少 2 個 image golden 題可跑通文字／兩段式評分
- 不修改 shared/models.ts 的 verified／points
- 測試：無 --yes 不呼叫網路；有破損 JSON 要重試或標記 failed
```
