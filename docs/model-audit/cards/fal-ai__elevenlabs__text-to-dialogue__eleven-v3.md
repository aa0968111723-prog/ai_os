# fal-ai/elevenlabs/text-to-dialogue/eleven-v3

> 審計：R5 · index **#226** · static+research · **零 live** · 2026-08-05  
> slug：`fal-ai__elevenlabs__text-to-dialogue__eleven-v3` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id / endpoint | `fal-ai/elevenlabs/text-to-dialogue/eleven-v3` |
| label | ElevenLabs v3 多人對話 |
| category | `text-to-speech` |
| tier | **flagship** |
| points | **3** |
| cost | **`按字計費`**（目錄未寫死單價） |
| verified | **false** |
| needs | 無 |
| strengths | 情感化多人對話、角色聲線與非語言提示控制 |
| bestFor | 兩人對談、訪談式見證、Podcast |
| 底層 | **ElevenLabs Text-to-Dialogue · eleven-v3** via fal |
| 角色定位 | 站內「多人對談」**旗艦**；`sc-panel-podcast` pickIds **第二**（VibeVoice 7B → **本 id** → Dia） |

**L0：** **ok** — OpenAPI required **`inputs`**（array of {text, voice}）；站內由 prompt 按行拆成 inputs + 輪替 Aria／Charlotte。

**一句話：** 多段對話各綁 voice 的旗艦 TTS；免來源；扁平 **3 點**（官方按字，長稿可能低估）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **3** |
| cost | 模糊「按字計費」— `parseRealCost` **難機械化** |
| 生態 | ElevenLabs 對話／v3 通常高於 Turbo 檔；精準 $/char 以 fal 帳單為準 |
| 結論 | **維持 3**（短對話緩衝）；**長稿／多輪 P2 估點風險**；建議 cost 字串後續寫明官方單位 |

---

## 3. 連通

| 項目 | 結果 |
|------|------|
| OpenAPI | **200** · `ElevenlabsTextToDialogueElevenV3Input`／`Output` |
| L2 | 未跑；禁止 `--yes` |
| 結論 | **ready-static-only** |
| Output | `audio` File + `seed` → extract **OK** |

### OpenAPI vs 站內

| Property | OpenAPI | 站內 |
|----------|---------|------|
| **`inputs`** | **required** array；每項 text + voice | ✅ 按行 split → `{ text, voice: Aria\|Charlotte }` |
| `stability` | optional | ❌ |
| `language_code` | optional ISO 639-1 | ❌ |
| `use_speaker_boost` | optional | ❌ |
| `seed` | optional | ❌ |
| `pronunciation_dictionary_locators` | optional | ❌ |

**input 組裝（models.ts）：**

```ts
inputs: (p.split(/\r?\n+/).map(trim).filter(Boolean).length
  ? lines : [p]
).map((text, i) => ({ text, voice: i % 2 === 0 ? "Aria" : "Charlotte" }))
```

- 空 prompt：站內表單應擋；若落到 `[p]` 空字串可能 422。  
- **單行長稿** → 全程同一 voice（Aria）— 多角色需使用者 **換行分段**。  
- voice 名 **Aria／Charlotte** 為站內硬編碼；若 fal 改名 enum 會 422（P2 風險，OpenAPI 本輪未展開 voice enum 細節）。

---

## 4. 風險

1. **cost 過糊** — 無法 realPricePoints；長 Podcast 3 點可能嚴重低估。  
2. **僅雙固定英系声** — 中文對話非主場（對談中文應 VibeVoice／MiniMax）。  
3. **無 language_code** — 中英混雜靠模型自行。  
4. 世界觀不注入 TTS — 合理。  
5. verified=false — 助手不自動首選（手動／recipe 可）。

---

## 5. 點數

扁平 3；無 tts 千字動態（cost 無可解析單位）。**未改 points／verified**。

---

## 6. 情境

| 情境 | 適配 |
|------|------|
| 英文雙人訪談／Podcast | ✅ |
| 中文對談 | △／❌ 優先 VibeVoice 7B |
| 單人旁白 | ❌ 用 Turbo／MiniMax／Qwen |
| sc-panel-podcast | ✅ 第二順位 |
| 情感／非語言控制 | ✅ 產品強項（進階旋鈕未暴露） |

---

## 7. 文件

- https://fal.ai/models/fal-ai/elevenlabs/text-to-dialogue/eleven-v3  
- OpenAPI 200

---

## 8. 建議動作

- [x] 維持 id／input 拆行配音／points=3  
- [ ] 補 cost 官方單價字串（對帳後）  
- [ ] 可選暴露 voice 對／language_code  
- [ ] UI 提示「一行一角、換行換人」  
- [ ] live 後 verified  

**總建議標籤：** `維持；input inputs[] 契約綠；3點扁平長稿風險；英文對談旗艦；ready-static-only`

### 狀態燈

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ok | 📄OpenAPI | 未跑 | 維持 |

---

## 9. 來源

1. OpenAPI ElevenlabsTextToDialogueElevenV3Input  
2. `shared/models.ts` input 拆行  
3. `sc-panel-podcast` / showdown 多人對談  
4. 姊妹 Dia／VibeVoice 卡  

**未做：** live、改 points／verified／cost 精價。
