# fal-ai/orpheus-tts

> 審計：R5 · index **#229** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__orpheus-tts`  
> OpenAPI **200**（本輪直拉 queue openapi）；**!needs** · L2 live **success**（本輪）。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **229** |
| 站內 id | `fal-ai/orpheus-tts` |
| endpoint | **同 id** |
| label | Orpheus(英文) |
| category / kind | **text-to-speech** · audio |
| tier | **economy** |
| points（目錄） | **1** |
| cost | `按字計費(fal 頁未明列)` |
| verified | **false** |
| needs | **無** |
| recommended | false |
| strengths | Llama 基底高表現力開源 TTS;支援情感標記 |
| bestFor | 英文旁白、國際版內容 |
| 姊妹 | Chatterbox、Kokoro、Dia、Gemini TTS |
| 情境 | 英文經濟旁白；**非**中文主力 |

**一句話**：**Orpheus** 英文開源 TTS——required 僅 `text` 綠；可選 voice／溫度／情感 tag；價未明、points=1 試驗向。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | 按字計費；**無 parseable $** |
| 校準 | 無 $ → 無法機械 realPrice；扁平 **1** ＝最低檔 |
| 長稿 | 若真按字 → flat 1 可能 **低估**（**P2**） |
| `estimatePointsFor` | 扁平 **1** |

**結論：** **維持 points=1**；不自動改。明碼價後再校。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `OrpheusTtsInput` / `OrpheusTtsOutput` |
| required | **`text` only** |
| optional props | `temperature`（預設 0.7）、`repetition_penalty`（預設 1.2）、`voice`（預設 `tara`） |
| voice enum | `tara` · `leah` · `jess` · `leo` · `dan` · `mia` · `zac` · `zoe` |
| output | **`audio`**（File） |
| L2 | **2026-08-05 live success** · req `019fd069-4f87-7ed1-9c00-dbc084c66f9a` · artifact wav |
| 結論 | **ready-live**（探測「測試」成功；**未**改 models.ts verified） |

### 站內 input

```ts
input: (p) => ({ text: p }),
```

| 檢查 | 結果 |
|------|------|
| `text` | **綠** required |
| voice / temperature / repetition_penalty | 不送 → 官方預設（tara / 0.7 / 1.2） |
| 幽靈欄 | 無 prompt 誤送 |
| 情感標記 | 文案寫在 **text 內**：`<laugh>` `<chuckle>` `<sigh>` 等（OpenAPI description） |

### OpenAPI 對照（本輪 200）

| 官方 | 站內 | 備註 |
|------|------|------|
| `text` required | ✅ | 可嵌 emotive tags |
| `voice` optional | 未送 | 預設 tara；產品未暴露選聲 |
| `temperature` / `repetition_penalty` | 未送 | 預設穩定向 |
| output `audio` | extract 認 ✅ | |

**P2 產品：** 8 聲線 enum 與情感 tag 未在 UI 暴露——能力表寫了、契約未接旋鈕。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | Llama 基底 **英文** 高表現力開源 TTS |
| vs Chatterbox | 同經濟英文向；Chatterbox 情感強度旋鈕不同系 |
| vs Kokoro 中文 | Kokoro 中文草稿；Orpheus **英文** bestFor |
| vs Dia | Dia 雙人對話＋非語言；Orpheus 單人旁白＋ tag |
| 語種 | 標籤即「英文」；勿當中文首選 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/orpheus-tts", { text })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| flat 1 vs 按字未知價 | **P2** |
| verified false | **正確** |
| !needs | L2 live **OK** · spent 計 1 點 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 TTS | ✅ | economy · !needs |
| recommended | ❌ | |
| sc 旁白 pick | ❌ | 中文線不靠本檔 |
| 聲線選擇 UI | ❌ | voice enum 未接 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 英文旁白／國際版 | ✅ | bestFor |
| 短情感台詞（laugh/sigh） | ✅ | text 內 tag |
| 中文見證旁白 | ❌ | → Qwen／MiniMax／Kokoro |
| 需指定非 tara 聲線 | △ | API 可；站內未送 voice |
| 長稿量產控費 | △ | 價未明＋flat1 **P2** |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #229 · input 僅 text |
| OpenAPI 本輪 | `OrpheusTtsInput` required text；voice enum×8 |
| fal 模型頁 | https://fal.ai/models/fal-ai/orpheus-tts |
| 前序 stub | bulk-all 已記 required text |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [x] 確認 input `{ text }` **綠**  
- [x] 維持 points=1；verified=false；!needs  
- [ ] **P2**：補 fal 明碼價後重校 points  
- [ ] **P2 產品**：可選暴露 `voice` enum／文案提示 emotive tags  
- [ ] **L2**（有 KEY）：短英文＋`<laugh>` 探活  

**L0 結論：** 契約最簡綠；英文定位清楚；價與聲線 UI 待補。  
**未做：** live、改 points、改 verified、加 voice 預設。

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| 指令 | `verify-models --probe fal-ai/orpheus-tts --yes` |
| 輸入 | 「測試」 |
| requestId | `019fd069-4f87-7ed1-9c00-dbc084c66f9a` |
| 結果 | **success** · audio/wav |
| artifact | https://v3b.fal.media/files/b/0aa51461/dG0aDnyAWD8-VsdmSDWKS_output.wav |
| pointsEst | 1 · budget 已入帳 |
| verified | **維持 false**（禁止自動改 true；待人工） |
