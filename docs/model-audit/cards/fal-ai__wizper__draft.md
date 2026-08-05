# fal-ai/wizper#draft

> 審計：R4 · index **#203** · static+research · 2026-08-05  
> slug：`fal-ai__wizper__draft`（**正名**；bulk 誤檔 `fal-ai__wizper#draft.md` 僅 stub）  
> 共用 endpoint **`fal-ai/wizper`** + 精簡 input（`task=transcribe` only）。  
> **needs=audio** → 本輪無 live（無 FAL_KEY）。  
> **未**改 verified／points。  
> **R4 proper-slug 缺口清零**（#160–212 皆有 `cards/<slug>.md`）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **203** |
| 站內 id | `fal-ai/wizper#draft` |
| endpoint | **`fal-ai/wizper`**（`#draft` 為路由別名） |
| label | Wizper 快速草稿 |
| category / kind | **speech-to-text** · text |
| tier | **budget** |
| points（目錄） | **1** |
| cost | `≈$0.0008/運算秒(推定,官方未單列)` |
| verified | **true**（目錄既有；本輪無新 live 不覆寫） |
| needs | **audio** |
| recommended | false |
| strengths | 最快最省的初稿 |
| bestFor | 先看內容再決定精修 |
| 姊妹 | base Wizper（#199 flagship）、Whisper（#198）、Scribe |

**一句話**：**Wizper 最簡草稿**——同加速引擎、更瘦 input；1 點 budget；適「先瞄內容再決定是否精修」。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | ≈$0.0008/運算秒（推定） |
| 校準 | 短檔 **≈**；長檔運算秒實價可能 ≫ 1 點 → **P2**（Wizper／Whisper 共債） |
| `estimatePointsFor` | 扁平 **1** |

**結論：** 維持 1；不自動改。較 #199 同點更「草稿」定位（input 更簡）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | `fal-ai/wizper` bulk **200** |
| required | `audio_url` |
| props（bulk） | `task`, `version`, `audio_url`, `max_segment_len`, `merge_chunks`, `language`, `chunk_level` |
| 站內 input | `{ audio_url, task: "transcribe" }` **僅兩欄** |
| vs base #199 | base 另送 **`language: "zh"`**；draft **不鎖語言** |
| L2 | 未跑 |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (_p, _f, s) => ({ audio_url: s, task: "transcribe" })
```

| 檢查 | 結果 |
|------|------|
| audio_url | **綠** required |
| task | **綠** |
| 無 language | 吃官方／模型預設（多語草稿） |
| 幽靈欄 | 無 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 引擎 | fal **Wizper**＝加速 Whisper v3 |
| vs #199 | 同 endpoint／同 1 點；#199 固定 zh 長稿快出；本檔最簡 draft |
| vs Scribe | 準度／商用長檔 → Scribe；本檔＝便宜瞄一眼 |
| 長檔 | 目錄 #199 已警示改 Scribe；本檔同等風險 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/wizper", { audio_url, task: "transcribe" })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| flat 1 vs 長檔運算秒 | **P2** |
| verified true | 目錄既有；不改 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 speech-to-text | ✅ | budget |
| recommended | ❌ | Scribe |
| 草稿預覽路徑 | ✅ | bestFor |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 先看內容再精修 | ✅ | bestFor |
| 最快最省初稿 | ✅ | strengths |
| 中文開示高準 | △ | #199 鎖 zh 或 Scribe |
| 一小時+ 商用 | ❌ | 估點與準度皆弱 |
| 無音訊 | ❌ | needs=audio |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #203 · 精簡 input |
| fal 模型頁 | https://fal.ai/models/fal-ai/wizper |
| 姊妹 | `fal-ai__wizper.md`（#199 bulk） |
| bulk stub | `cards/fal-ai__wizper#draft.md`（`#` 誤名；以本卡為準） |

---

## 9. 建議動作

- [x] 正名九章卡（`#` → `__` slug）  
- [x] 澄清 vs base：無 `language: zh`  
- [x] 維持 points=1；不改 verified  
- [x] **R4 proper-slug 全齊**  
- [ ] **P2**：Wizper 長檔扁平估點  
- [ ] 清理 bulk `#` 誤檔  
- [ ] 下一階段：他號段 **thin bulk→九章**（R3/R5 thin 最多）或有 KEY 則 P/L  

**L0 結論：** 契約綠；budget draft 定位清楚；R4 slug 缺口關閉。  
**未做：** live、改 points、改 verified。
