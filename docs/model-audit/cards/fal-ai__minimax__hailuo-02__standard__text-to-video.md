# fal-ai/minimax/hailuo-02/standard/text-to-video

> 審計：R3 · index **#113** · static+research · 2026-08-05（升 shallow→九章）  
> slug：`fal-ai__minimax__hailuo-02__standard__text-to-video`  
> OpenAPI **200**（本輪直拉 queue openapi）；**!needs**；零 live（無 KEY／R 禁 --yes）。  
> **未**改 verified／points／models.ts input。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **113** |
| 站內 id | `fal-ai/minimax/hailuo-02/standard/text-to-video` |
| endpoint | **同 id**（無 alias） |
| label | Hailuo 02 Standard |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points（目錄） | **7** |
| cost | `$0.045/秒(768p;Pro 1080p $0.08/秒);按秒計費,點數為 6 秒基準` |
| verified | **true**（歷史；本輪無 live 複驗） |
| needs | **無** |
| recommended | false |
| strengths | 物理與指令遵循好;按秒計費透明 |
| bestFor | 中等預算的日常敘事鏡頭 |
| 供應商 | MiniMax Hailuo-02 **Standard 768p** · fal queue |
| 姊妹 | Hailuo 2.3 Pro/Standard t2v；video-01-director；Veo 3.1 Lite |

**一句話**：**Hailuo 02 Standard** 經濟 768p 文生片——required 僅 `prompt`；官方 duration **`6`｜`10`**（字串）預設 **6**；站內送 **`aspect_ratio` 但 schema 無此欄**（死欄／忽略風險）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **7** |
| cost 首價 | **$0.045／秒**（768p Standard） |
| `parseRealCost` | usdMid=**0.045** · multiplier=`PRICE_VIDEO_SECONDS`=**5** |
| 機械 `realPricePoints` | `0.045 × 5 × 31 = 6.975` → **round 7** |
| 官方預設時長 | OpenAPI duration default **`"6"`** → 實費 6×0.045=**$0.27** ≈ NT$**8.37** |
| 10 秒檔 | 10×0.045=**$0.45** ≈ NT$**14**（points 7 則低估 ~2×） |
| Pro 對照（cost 文案） | 1080p **$0.08／秒** — 本端點 about 標 **768p Standard**，非 Pro |

### 校準對照

| 設定 | USD | NT$（×31） | vs points=7 |
|------|-----|------------|-------------|
| **機械 5s×$0.045**（parseRealCost） | 0.225 | 7.0 | **≈** |
| **預設 6s×$0.045**（OpenAPI default） | 0.27 | 8.4 | 低估 ~1.4 |
| 10s×$0.045 | 0.45 | 14.0 | 低估 ~2× |

**結論：** **維持 points=7**（對齊機械 ×5 首價；禁自動改 points）。  
**P2 文案：** cost 寫「6 秒基準」但 `PRICE_VIDEO_SECONDS=5`；預設真 6s 略低估。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok**（MODELS 欄齊） |
| fal OpenAPI | **200** `MinimaxHailuo02StandardTextToVideoInput`／`…Output` |
| about | MiniMax Hailuo-02 T2V API（**Standard, 768p**） |
| required | **`prompt` only**（minLength 1，maxLength **2000**） |
| optional | `duration` enum **`"6"`｜`"10"`** def **`"6"`**；`prompt_optimizer` bool def **true** |
| output | **`video`**（File／url） |
| L2 live | 未跑（無 FAL_KEY） |
| 結論 | **ready-static-with-caveat**（aspect 死欄） |

### 站內 input

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
// aspect = (f) => f  → "16:9" | "9:16" | "1:1"
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** required |
| `aspect_ratio` | schema **無** → **死欄**（多半被忽略；未 live 證 422） |
| `duration` | 未送 → 官方 **6s** |
| `prompt_optimizer` | 未送 → 官方 **true** |

### OpenAPI 對照（本輪 200）

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required ≤2000 | ✅ | |
| `duration` `"6"\|"10"` def 6 | ❌ 未送 | 扁平 7 點假設偏短鏡 |
| `prompt_optimizer` def true | 未送 | 吃預設 |
| `aspect_ratio` | ✅ 每請求送 | **schema 無** → **P1 死欄** |
| output `video` | extract 認 ✅ | |

**注意：** description 稱「10s 不支援 1080p」——本端為 **768p Standard**，10s 應可用；Pro 1080p 另端。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | Hailuo-02 **經濟 Standard 768p** 文生片；物理／指令遵循 |
| vs 2.3 Pro | Pro 多為 **按次** 1080p 高價；本檔 **按秒** 768p |
| vs video-01-director | Director 強調運鏡指令、flat $0.5／支 |
| 比例 | **無 aspect API** → 直式專案 UI 選 9:16 **可能仍出 16:9**（產品風險） |
| 時長 | 僅 6／10 兩檔字串 enum（非任意秒） |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 7（flat；或 realPricePoints 自 cost）
→ reserveQuota(7)
→ falSubmit("fal-ai/minimax/hailuo-02/standard/text-to-video",
            { prompt, aspect_ratio })  // aspect 可能被忽略
→ 失敗 refund(7)
```

| 檢查 | 結果 |
|------|------|
| 7 ≈ 5s×$0.045×31 | **機械對齊** |
| 6s 預設實費 | 略超 7 點（**P2**） |
| verified true | 歷史不改 |
| !needs | 可 live（本輪無 KEY） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-video | ✅ | economy |
| 專案 format→aspect | ⚠ | **無效**（schema 無） |
| duration 6/10 UI | ❌ | 未接 |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 中預算日常敘事橫式 | ✅ | bestFor；預設 6s |
| 直式 9:16 短片 | ⚠ | aspect 死欄，可能仍橫式 |
| 10 秒略長 B-roll | △ | 需送 duration=`"10"`；點數仍 7 **虧** |
| 1080p 旗艦質感 | ❌ | → Pro／2.3 Pro |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #113 · input prompt+aspect · points7 · verified true |
| OpenAPI 本輪 | required prompt；duration 6/10；**無 aspect_ratio** |
| fal about | Standard **768p** |
| 模型頁 | https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/text-to-video |
| 姊妹卡 | hailuo-2.3 pro t2v（同 aspect 死欄模式） |

---

## 9. 建議動作

- [x] 升 shallow→完整九章；OpenAPI 直核  
- [ ] **P1：** 去掉 `aspect_ratio` 送出（或改文件「比例固定／不可控」）  
- [ ] **P2：** cost「6 秒基準」vs `PRICE_VIDEO_SECONDS=5`；10s 扁平低估  
- [ ] **P2 產品：** duration 6/10 旋鈕  
- [x] **維持** points=7／verified true（不自動改）  
- [ ] L2（有 KEY）：短 prompt 探活；確認多餘 aspect 是否 422  

**裁決：維持＋P1 死欄 aspect**（深卡完成；零 live；未改碼）

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd0a7-cf7c-7f70-9dac-729344169677` |
| 結果 | **success** · mp4 |
| artifact | https://v3b.fal.media/files/b/0aa5161b/qRxDLo4uaDTVs4vd5y3iF_2IapwPUY.mp4 |
| pointsEst | 7 |
| verified | 目錄 true；**本輪不改** |
