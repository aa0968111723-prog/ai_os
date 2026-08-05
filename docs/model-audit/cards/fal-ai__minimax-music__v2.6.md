# fal-ai/minimax-music/v2.6

> 審計：R5 · index **#237** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__minimax-music__v2.6`  
> OpenAPI **200**（本輪直拉）；**!needs**；R 禁 --yes → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **237** |
| 站內 id | `fal-ai/minimax-music/v2.6` |
| endpoint | **同 id** |
| label | MiniMax Music 2.6 |
| category / kind | **text-to-audio** · audio |
| tier | **flagship** |
| points（目錄） | **5** |
| cost | 約 `$0.15/次`（**推定**） |
| verified | **false** |
| needs | **無** |
| recommended | false |
| strengths | 完整演唱歌曲;風格描述至 2000 字、可自動填詞、可切純器樂 |
| bestFor | 高品質中文主題曲、片尾曲 |
| 姊妹 | MiniMax Music（#233 needs=audio）、v2（#238）、Lyria2、EL Music |

**一句話**：**MiniMax Music 2.6** 旗艦文生歌——schema required 僅 `prompt`；**條件** 非器樂時要 lyrics／optimizer；站內只送 prompt → **P0 風險 422**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **5** |
| cost | 約 **$0.15/次（推定）** |
| USD→TWD | 0.15 × 31 ≈ **NT$4.65** → points **5** 貼邊 |
| 證據 | 推定價；**未**帳單核實 |
| `estimatePointsFor` | 扁平 **5** |

**結論：** **維持 points=5**；推定價不擅自改。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **有條件風險**（見下） |
| fal OpenAPI | **200** `MinimaxMusicV26Input` / `…Output` |
| required（schema） | **`prompt` only**（10–2000 chars） |
| optional | `lyrics`（max 3500）、`lyrics_optimizer` def false、`is_instrumental` def false、`audio_setting` |
| output | **`audio`** |
| 空輸入 probe | cancel_unconfirmed（本輪 P text-to-audio） |
| L2 | 未跑（R 禁 --yes；且估 5＞優先經濟檔） |
| 結論 | **ready-static-with-caveat** |

### 站內 input

```ts
input: (p) => ({ prompt: p }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** schema required |
| `is_instrumental` def **false** | 未送 |
| `lyrics` | 未送（空字串預設） |
| `lyrics_optimizer` def **false** | 未送 |

### 條件必填（OpenAPI description）

> `lyrics`：**Required when `is_instrumental` is false.**  
> `lyrics_optimizer`：When true and lyrics empty, auto-generates lyrics from prompt.

| 站內現況 | 推斷 |
|----------|------|
| 只送 prompt · instrumental=false · optimizer=false · lyrics 空 | 運行時可能 **422**（缺 lyrics） |
| 安全修法 A | `is_instrumental: true`（純器樂；與 strengths「可切純器樂」一致但改產品語意） |
| 安全修法 B | `lyrics_optimizer: true`（自動填詞；對齊 strengths） |
| 安全修法 C | 要求使用者填 lyrics 欄 |

**P0 契約：** 建議 `input` 補 `lyrics_optimizer: true`（最小改動、保留演唱向 bestFor）——**本輪不擅自改 models.ts**（需產品確認）；記 broken 候選。

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ | 風格／曲風 |
| `lyrics` 條件必填 | ❌ 未送 | **P0** |
| `lyrics_optimizer` | 未送 false | 建議 true |
| `is_instrumental` | 未送 false | |
| output `audio` | ✅ | |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | MiniMax **2.6** 旗艦完整歌曲 |
| vs #233 Music | #233 **needs=audio** 參考曲；2.6 **!needs** 純文 |
| vs #238 v2 | v2 schema **required prompt+lyrics_prompt**（更硬） |
| 自動填詞 | lyrics_optimizer 是純 prompt 路徑關鍵 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 5
→ reserveQuota(5)
→ falSubmit("fal-ai/minimax-music/v2.6", { prompt })  // 可能 422
→ 失敗 refund(5)
```

| 檢查 | 結果 |
|------|------|
| 5 ≈ $0.15 推定 | 可接受 |
| verified false | **正確** |
| !needs | 可 probe；**不建議**在修 input 前 live |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | flagship |
| lyrics／器樂 UI | ❌ | 未接 → 放大 P0 |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 高品質中文主題曲（有詞） | △ | 需 lyrics 或 optimizer |
| 純器樂片尾 | △ | 需 is_instrumental true |
| 現況一鍵 prompt | ⚠ | **可能 422** |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #237 · input 僅 prompt · points5 |
| OpenAPI 本輪 | required prompt；lyrics 條件必填文案 |
| fal 模型頁 | https://fal.ai/models/fal-ai/minimax-music/v2.6 |
| 前序 thin | bulk required: prompt only（未寫條件） |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [ ] **P0：** `input` 加 `lyrics_optimizer: true`（或 UI 收 lyrics／instrumental）  
- [ ] 修後 L2：`verify-models --probe`（估 5；spent 允可時）  
- [x] **維持** points=5；**不**改 verified  

**裁決：維持＋P0 契約風險**（深卡完成；禁止無證據改 points）
