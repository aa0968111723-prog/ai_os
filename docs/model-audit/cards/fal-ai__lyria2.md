# fal-ai/lyria2

> 審計：R5 · index **#230** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__lyria2`  
> OpenAPI **200**（本輪直拉 queue openapi）；**!needs** · 本輪 R 禁 --yes → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **230** |
| 站內 id | `fal-ai/lyria2` |
| endpoint | **同 id** |
| label | Lyria 2(Google) |
| category / kind | **text-to-audio** · audio |
| tier | **flagship** |
| points（目錄） | **3** |
| cost | `$0.10/30秒` |
| verified | **true**（目錄既有；本輪無 live 複核） |
| needs | **無** |
| recommended | false |
| strengths | 48kHz 錄音室級音質;器樂氛圍最佳 |
| bestFor | 禪修背景樂、片頭配樂 |
| 姊妹 | ElevenLabs Music、Stable Audio 2.5、MiniMax Music、ACE-Step |
| 情境 | SC 配樂 pickIds 含本檔；旗艦器樂／氛圍向 |

**一句話**：**Google Lyria 2** 文生音樂——required 僅 `prompt`；固定 **30s／48kHz WAV**；可選 negative／seed；**$0.10/次 → points=3** 對齊。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **3** |
| cost | **$0.10/30秒**（固定長度一檔） |
| USD→TWD | 0.10 × 31 ≈ **NT$3.1** |
| 校準 | flat **3** ≈ 一次 30s 成片；**維持** |
| 更長曲 | API 固定 ~30s → 無法加長單次；多段拼接另計 |
| `estimatePointsFor` | 扁平 **3** |

**結論：** **維持 points=3**；有明碼 $ 且貼邊，不改。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `Lyria2Input` / `Lyria2Output` |
| required | **`prompt` only**（minLength 1, maxLength 2000） |
| optional props | `negative_prompt`（預設 `"low quality"`）、`seed` |
| output | **`audio`**（File；例 WAV） |
| 固定規格 | **48kHz** · **~30s** · safety filters |
| L2 | **failed 422 English-only** · `019fd086` |
| 結論 | **ready-static-only**（目錄 verified=true 為歷史標；本輪無新 live） |

### 站內 input

```ts
input: (p) => ({ prompt: p }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** required |
| `negative_prompt` | 不送 → 官方預設 `"low quality"` |
| `seed` | 不送 → 非確定性 |
| 幽靈欄 | 無 duration／bpm 等誤送 |

### OpenAPI 對照（本輪 200）

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ | 描述曲風／情緒／樂器／節奏 |
| `negative_prompt` optional | 未送 | 預設 low quality；**未**進 `NEGATIVE_PROMPT_SUPPORTED` |
| `seed` optional | 未送 | **未**進 `SEED_SUPPORTED` |
| output `audio` | extract 認 ✅ | |

**P2 產品：** negative／seed schema 有、站內 allowlist 未收——消融與世界觀禁忌詞無法吃滿（非 P0，不誤送 422）。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | Google **旗艦** 文生音樂；器樂／氛圍／禪修向 |
| vs ElevenLabs Music | EL 偏完整歌曲＋版權敘事、points 高；Lyria 固定 30s 氛圍 |
| vs MiniMax Music | MiniMax 經濟完整曲 demo；Lyria 品質旗艦、價 3× |
| vs Stable Audio | SA 可秒數參數；Lyria 鎖 30s＋48kHz |
| 安全 | 官方 safety filters 擋不當內容 |
| 提示 | genre／mood／instrumentation／tempo 寫進 prompt 效果佳 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 3
→ reserveQuota(3)
→ falSubmit("fal-ai/lyria2", { prompt })
→ 失敗 refund(3)
```

| 檢查 | 結果 |
|------|------|
| flat 3 vs $0.10 | **對齊** |
| verified true | 目錄既有；本輪 **未** live 複核、**未**改 |
| !needs | 可進 live 佇列（估 3＜80；spent+3≤900） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | flagship |
| recommended | ❌ | |
| SC 配樂 pickIds | ✅ | 與 elevenlabs/music 並列 |
| negative／seed UI | ❌ | schema 有、allowlist 未接 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 禪修／片頭器樂氛圍 | ✅ | bestFor |
| 30s 內 BGM 段 | ✅ | 固定時長 |
| 完整帶詞流行歌 | △ | → MiniMax／ElevenLabs 歌曲向 |
| 需可重現 seed | △ | API 可；站內未送 |
| 長片連續配樂 | △ | 多段 30s 拼接＋points×N |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #230 · input 僅 prompt · points=3 · verified true |
| OpenAPI 本輪 | `Lyria2Input` required prompt；negative／seed optional |
| fal 模型頁 | https://fal.ai/models/fal-ai/lyria2 |
| x-fal about | 48kHz · 30s · negative · seed · safety |
| 前序 stub | bulk-all thin 已記 required prompt |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核
- [ ] （可選 P2）`SEED_SUPPORTED`／`NEGATIVE_PROMPT_SUPPORTED` 補 id（有 schema 證據）
- [ ] 若要 L2 複核 verified：`verify-models --probe "fal-ai/lyria2"` 再 `--yes`（估 3 點）
- [x] **維持** points=3／endpoint／input；**不**自動改 verified

**裁決：維持**（契約綠、價點對齊；深卡完成）

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd086-e31a-7082-8a77-864a7173c8f0` |
| 結果 | **failed 422** — Unsupported language; Please use English |
| 輸入 | 中文 PROBE_PROMPTS text-to-audio |
| 建議 | 探測／站內對 Lyria 強制英文 prompt；或標 English-only |
| verified | 目錄 true；**本輪不改**（失敗不算複驗通過） |
