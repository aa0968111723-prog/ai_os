# fal-ai/ace-step

> 審計：R5 · index **#236** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__ace-step`  
> OpenAPI **200**（本輪直拉）；**P0 契約已修**（`prompt`→**`tags`**）。  
> 目錄 verified=true **不改**；points=1 **不改**；零 live。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **236** |
| 站內 id | `fal-ai/ace-step` |
| endpoint | **同 id** |
| label | ACE-Step(開源) |
| category / kind | **text-to-audio** · audio |
| tier | **budget** |
| points（目錄） | **1** |
| cost | `$0.0002/秒`（另有 `$0.005/秒` 來源，以首帳單為準） |
| verified | **true**（歷史；本輪無 live 複驗） |
| needs | **無** |
| recommended | false |
| strengths | 全站最低成本音樂生成 |
| bestFor | 氛圍底噪、練習用 |
| 姊妹 | MiniMax Music 系、Lyria2、Stable Audio、Yue |

**一句話**：**ACE-Step** 開源預算音樂——required **`tags`**（genre 逗號列表）；站內已對齊；極低成本但秒價來源分歧。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost A | **$0.0002／秒** → 60s≈\$0.012≈NT\$0.4 → flat1 **足夠** |
| cost B | **$0.005／秒** → 60s≈\$0.30≈NT\$9 → flat1 **嚴重低估** |
| 預設時長 | OpenAPI `duration` 預設 **60**（5–240） |
| `estimatePointsFor` | 扁平 **1**（未按秒動態） |

**結論：** **維持 points=1**；標 **P2** 雙價源＋長時長低估，待帳單核實後再動。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約（修後） | **ok** |
| fal OpenAPI | **200** `AceStepInput` / `AceStepOutput` |
| required | **`tags` only** |
| 可選 | duration、lyrics、多種 guidance／scheduler／steps／seed… |
| output | **`audio`** + seed/tags/lyrics |
| L2 | **live success** · `019fd07a` |
| 結論 | **ready-static-only** |

### 站內 input（本輪 P0-FIXED）

```ts
// 原：input: (p) => ({ prompt: p })  // schema 無 prompt 為 required 欄
input: (p) => ({ tags: p }),
```

| 檢查 | 結果 |
|------|------|
| `tags` | **綠** required — comma-separated genre tags |
| 說明「可作 prompt」 | OpenAPI description 別名語意；**正式 required 名為 tags** |
| duration 等 | 不送 → 預設 60s、guidance 等官方預設 |
| lyrics | 不送 → 空＝偏器樂／無唱詞路徑 |

### OpenAPI 摘要（本輪 200）

| 欄 | 約束 | 站內 |
|----|------|------|
| `tags` | string **required** | ✅ 使用者文案當 tags |
| `duration` | 5–240 def **60** | 未送 |
| `lyrics` | 可選；`[inst]`/`[instrumental]`＝無詞 | 未送 |
| guidance_* / steps / scheduler | 多旋鈕 | 未送 |
| output `audio` | File | extract ✅ |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 開源 **ACE-Step** 低成本 text/tags→music |
| tags vs prompt | UI 自由文會塞進 tags——非嚴格 genre taxonomy 仍常可用 |
| vs 旗艦曲 | 品質／授權不及 EL Music；勝在 **budget** |
| 秒價分歧 | 文案已註雙來源——產品風險 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/ace-step", { tags })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| flat1 vs \$0.005/s×長時 | **P2** |
| verified true | 歷史不改 |
| !needs | 可 live（本輪無 KEY） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | budget |
| recommended | ❌ | |
| duration／lyrics UI | ❌ | 未接 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 氛圍底噪／練習 | ✅ | bestFor |
| 長 BGM 量產極省 | ✅／△ | 若真 \$0.0002/s 很香；若 \$0.005 則虧 points |
| 完整授權對外歌 | ❌ | → EL Music |
| 中文演唱主題曲 | △ | → MiniMax v2.6 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #236 · input tags · P0 註解 |
| OpenAPI 本輪 | required tags；duration def60 |
| fal 模型頁 | https://fal.ai/models/fal-ai/ace-step |
| broken | 可選登錄 P0-FIXED（輕量欄名） |

---

## 9. 建議動作

- [x] 升 stub→九章；OpenAPI 直核  
- [x] **P0-FIXED**：`prompt`→`tags`  
- [x] 維持 points=1；verified 不改  
- [ ] **P2**：核實秒價（0.0002 vs 0.005）並考慮按秒估點  
- [ ] **P2 產品：** duration／lyrics 旋鈕  
- [ ] **L2**（有 KEY）：短 tags 探活  

**L0 結論：** 修後 required 綠；價源與長時長估點待打磨。  
**未做：** live、改 points、改 verified。

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| 指令 | `verify-models --probe fal-ai/ace-step --yes` |
| 輸入 | tags 路徑：「溫暖平靜的鋼琴旋律,慢板」 |
| requestId | `019fd07a-a13f-7141-8272-9274672439cc` |
| 結果 | **success** · wav |
| artifact | https://v3b.fal.media/files/b/0aa514c1/AJfDbqLvSZwW6w1oTQlAI_6OY8d6cE.wav |
| pointsEst | 1 · budget 已入帳 |
| verified | 目錄已 true；**本輪不改** models.ts |
