# fal-ai/minimax-music/v2

> 審計：R5 · index **#238** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__minimax-music__v2`  
> OpenAPI **200**；**!needs**；R 禁 --yes → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **238** |
| 站內 id | `fal-ai/minimax-music/v2` |
| endpoint | **同 id** |
| label | MiniMax Music v2 |
| category / kind | **text-to-audio** · audio |
| tier | **economy** |
| points（目錄） | **1** |
| cost | 約 `$0.03/次`（**推定**） |
| verified | **false** |
| needs | **無**（但雙文字 required——見 P0） |
| recommended | false |
| strengths | 風格+歌詞雙輸入、可開器樂模式;44.1kHz |
| bestFor | 精準指定曲風的中文演唱 |
| 姊妹 | #233 Music（needs=audio 樣曲）、#237 v2.6、Lyria2 |

**一句話**：**MiniMax Music v2**——OpenAPI **硬 required** `prompt`+`lyrics_prompt`；站內只送 `prompt` → **P0 必 422**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | 約 **$0.03/次（推定）** |
| USD→TWD | 0.03×31≈**NT$0.93** → flat **1** |
| `estimatePointsFor` | 扁平 **1** |

**結論：** **維持 points=1**；推定價不改。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **P0 斷**（缺 lyrics_prompt） |
| fal OpenAPI | **200** `MinimaxMusicV2Input` / `…Output` |
| required | **`prompt` + `lyrics_prompt`**（雙硬必填） |
| optional | `audio_setting`（sample_rate/bitrate/format） |
| output | **`audio`** |
| 空輸入 probe | cancel_unconfirmed（P text-to-audio 輪） |
| L2 | 未跑（契約未修前禁止 --yes） |
| 結論 | **broken-contract** 直到 input 補 lyrics |

### 站內 input（現況）

```ts
input: (p) => ({ prompt: p }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | ✅ 有；minLength 10 需產品注意短稿 |
| `lyrics_prompt` | ❌ **未送** → 對 OpenAPI **必 422** |
| audio_setting | 未送 → 44100／256k／mp3 預設 |

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required 10–2000 | 部分 | 僅一欄 |
| `lyrics_prompt` required 10–3000 | **缺** | **P0** |
| `audio_setting` optional | 未送 | 44.1kHz 預設 OK |
| output `audio` | ✅ | |

### 建議修法（本輪不改碼）

| 方案 | 作法 |
|------|------|
| A | `input: (p) => ({ prompt: p, lyrics_prompt: p })` 暫複用（可生成但風格／詞同文） |
| B | UI 第二欄歌詞 → source 或 options |
| C | 下架／隱藏至契約修 |

vs **#237 v2.6**：v2.6 schema 僅 required prompt，歌詞為條件；**v2 更硬** 雙 required。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 風格描述 + **獨立歌詞** 的經濟演唱曲 |
| strengths 文案 | 「風格+歌詞雙輸入」——與 schema 一致、與 input **不一致** |
| 器樂 | OpenAPI v2 **無** is_instrumental 欄（與 v2.6 不同） |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit({ prompt })  // 缺 lyrics_prompt → 422
→ refund(1)
```

| 檢查 | 結果 |
|------|------|
| verified false | **正確** |
| 經濟 live | **勿**在修前 probe |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 | ✅ | 使用者一鍵會踩 422 |
| 歌詞 UI | ❌ | 放大 P0 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 有曲風+歌詞兩段文 | △ | API 可；站內不能分送 |
| 現況單 prompt | ❌ | **必敗** |
| 僅樣曲遷移 | — | → #233 needs=audio |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #238 · input 僅 prompt |
| OpenAPI 本輪 | required 雙欄 |
| fal 模型頁 | https://fal.ai/models/fal-ai/minimax-music/v2 |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [ ] **P0：** 補 `lyrics_prompt`（暫複用 p 或 UI）  
- [ ] 修後再 L2  
- [x] **維持** points=1；**不**改 verified  

**裁決：維持＋P0 契約斷裂**（深卡完成）
