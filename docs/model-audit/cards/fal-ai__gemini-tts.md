# fal-ai/gemini-tts

> 審計：R5 · index **#227** · static+research · 2026-08-05  
> slug：`fal-ai__gemini-tts` · 單一真相：`shared/models.ts`  
> OpenAPI **200** · active · input 契約綠（`prompt` + 合法 `language_code`／`output_format`）。  
> **未**改 verified／points／cost。零 live。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **227** |
| 站內 id / endpoint | `fal-ai/gemini-tts`（無 alias；`fal-ai/gemini/tts` 等 → 404） |
| label | Gemini TTS |
| category / kind | 站內 **text-to-speech** · audio |
| fal metadata category | **`text-to-audio`**（tags 含 text-to-speech） |
| tier | economy |
| points | **2**（人工；cost 無 $） |
| cost | `依 Gemini TTS 用量` |
| verified | **false** |
| needs | 無（純文生語音） |
| recommended | false |
| strengths | 多語、自然語言控制語氣/速度/口音;支援多人聲 |
| bestFor | 中文旁白、快速批次生成、主持人對談 |
| 供應商 | Google **Gemini 2.5 Flash／Pro TTS** via fal |
| 角色 | 多語＋自然語言風格控制；台語境預設 **Chinese Mandarin (Taiwan)** |

**一句話**：Gemini 原生 TTS——**30 聲線**、可選 Flash／Pro、可多人 `speakers`；站內只送 prompt＋台灣華語＋mp3，吃 **Kore**／**flash** 預設。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **2** |
| cost | `依 Gemini TTS 用量`（**無 $ 金額**） |
| `parseRealCost` | usdMid=**null** → `realPricePoints`=null → **保留手填 2** |
| `ttsUsdPerKChar` | **未入**（無 `$…/千字`） |
| `estimatePoints` | 一律扁平 **2**（與字數無關） |
| 校準報告 | 需人工 |
| 結論 | **維持 2**；真價待 playground／帳單 live 後再校（P1） |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| OpenAPI | **HTTP 200** · `GeminiTtsInput`／`GeminiTtsOutput` |
| Platform | status **active** · display Gemini TTS · updated 2026-07 |
| L1 歷史 | `docs/fal端點連通報告.md`：**✅ 連通** |
| live | **未跑**（無 FAL_KEY；禁止 --yes） |
| 結論 | **ready-static-only** |

### OpenAPI 摘要（2026-08-05）

- **required**：`prompt`（1–**50000** chars）
- **order**：prompt → style_instructions → voice → model → language_code → speakers → temperature → output_format
- `voice`：30 預設聲線；default **`Kore`**
- `model`：`gemini-2.5-flash-tts`（default）｜`gemini-2.5-pro-tts`
- `language_code`：大量 BCP 風格標籤；含 **`Chinese Mandarin (Taiwan)`**／`(China)` 等
- `output_format`：`wav`｜`mp3`｜`ogg_opus`；default **mp3**
- `style_instructions`：可選自然語言風格（max 4000）
- `speakers`：2–10 × `{ voice, speaker_id }`；prompt 行首別名
- `temperature`：0–2，default 1
- **Output**：`audio` → File.url

### 站內 input vs 官方

```ts
input: (p) => ({
  prompt: p,
  language_code: "Chinese Mandarin (Taiwan)",
  output_format: "mp3",
})
```

| 欄位 | 站內 | OpenAPI | 判定 |
|------|------|---------|------|
| `prompt` | ✅ | required | **綠** |
| `language_code` | 台灣華語 | enum **含** | **綠**（非幽靈） |
| `output_format` | `mp3` | enum 含 | **綠** |
| `voice`／`model` | 未送 | default Kore／flash | OK |
| `speakers`／style | 未送 | 可選 | 能力未暴露（P2） |

**無 422 風險**（required 滿足；enum 合法）。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 模型 | Gemini **2.5 Flash TTS**（預設低延遲）／**Pro TTS**（播客／有聲書） |
| 風格 | prompt 內可嵌「Say cheerfully:…」或 `style_instructions`；inline `[slowly]` 等 |
| 多人 | `speakers` + 行首 `Host:`／`DrChen:`；站內 strengths 寫「支援多人聲」但 **input 未組 speakers** → 單人旁白路徑 |
| 中文 | language_code 明確台／中；bestFor 中文旁白合理 |
| 世界觀 | TTS 不注入 worldview（合理） |
| vs Eleven／MiniMax | Gemini 強在多語＋NL 控制；中文情感旗艦仍可能 MiniMax／Qwen |

---

## 5. 站內扣點／退點

```
estimatePoints → 2（扁平）
→ falSubmit("fal-ai/gemini-tts", { prompt, language_code, output_format })
→ 失敗 refund(2)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 皆 2 → 內部一致 |
| 對官方實帳 | **未知**（cost 無 $）→ 長稿／Pro 可能倒貼 |
| verified false | 正確 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| TTS 選擇器 | ✅ | economy · 無 needs |
| 多人對談情境 | ❌ | pick 為 VibeVoice／Eleven／Dia |
| voice／model UI | ❌ | 吃 Kore＋flash |
| speakers UI | ❌ | strengths 略超前於 input |
| MCP | ✅ | 可直送中文 prompt |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 台灣華語旁白草稿 | ✅ | language_code 預設對齊 |
| 快速批次多語 | ✅ | 多 language enum |
| 正式中文情感旗艦 | △ | 人工 2 點；品質待 live vs MiniMax |
| 主持人雙人 Podcast | △ | schema 支援；站內未組 speakers |
| 需樣音克隆 | ❌ | 無 ref audio → Zonos／F5／MiniMax clone |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=fal-ai/gemini-tts`（**200**） |
| Platform | active · Gemini TTS |
| Playground | https://fal.ai/models/fal-ai/gemini-tts |
| 連通報告 | ✅ 連通 |
| 目錄／校準 | 2 點 · 需人工 |
| 站內碼 | `shared/models.ts` #227 列 |

---

## 9. 建議動作

- [x] 親驗 endpoint 200／active；input 三欄合法  
- [x] **維持** points=2／verified=false／cost 文案  
- [ ] **P1**：查官方 $/千字或 $/字 寫入 cost，接 `ttsUsdPerKChar`  
- [ ] **P2**：可選暴露 voice（Kore／Puck／Charon…）與 model flash｜pro  
- [ ] **P2**：多人模式：解析腳本 → `speakers` + 行首 alias  
- [ ] **L2**（有 KEY）：短中文句 live 出 mp3 校實帳  

**L0 結論**：契約綠、中文路徑合理、價人工 2；**無 422**。  
**未做：** live、改 points、改 verified。

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| 指令 | `verify-models --probe fal-ai/gemini-tts --yes` |
| 輸入 | 「測試」 + language_code TW + mp3 |
| requestId | `019fd07e-a004-7eb3-a554-4071b5e8c991` |
| 結果 | **success** · mp3 |
| artifact | https://v3b.fal.media/files/b/0aa514eb/gxHEpm53gkJpaPSBceyfe_gemini_tts_output.mp3 |
| pointsEst | 2 |
| verified | **維持 false** |
