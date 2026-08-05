# fal-ai/kolors

> 審計：R1 · index **#10** · static+research（零 live 本輪）· 2026-08-05  
> slug：`fal-ai__kolors`  
> 禁止改 verified／points（本卡僅建議）· **禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 10 |
| **id** | `fal-ai/kolors` |
| **endpoint** | 同 id（無 alias） |
| **label** | Kolors(快手可圖) |
| **category / tier / kind** | text-to-image · economy · image |
| **verified** | false |
| **needs** | 無 |
| **recommended** | false |
| **strengths** | 中英雙語原生訓練;中文提示理解到位、寫實人像自然 |
| **bestFor** | 中文語境的寫實人物/生活場景,實惠的中文可用檔 |
| **vendor** | 快手 Kolors via fal |

**一句話**：中英雙語經濟文生圖——寫實人像／生活場景；**非**字卡主力（中文字卡首選 Qwen／Seedream 梯隊）。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost | ≈$0.02–0.04/張 |
| 估值 NT$ | $0.02–0.04 ×31 ≈ **0.6–1.2** → 扁平 **1** 點 |
| 校準判定 | **≈**（區間中位約 1 點） |
| realPricePoints | 區間 cost 多無法機械單價；手填 1 生效 |

**風險**：若實際按 MP 且大圖 >1MP，1 點可能貼邊；站內 preset ≈1MP 可接受。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 靜態 | ok |
| OpenAPI | **HTTP 200** · `KolorsInput` required `prompt` |
| image_size | anyOf preset；default **square_hd**；站內 `imageSize(f)` ✓ |
| negative_prompt | 有（default 空）；站內不送 |
| steps / CFG | default **50** / **5**（偏重） |
| Output | images[] + seed + nsfw + timings |
| L2 live | **歷史**：budget 有 kolors success（spent 記 1 點）；本輪 R 未再 --yes |
| 結論 | **ready**（契約綠；可 L 佇列覆核） |

## 4. 底層

- 快手 Kolors 擴散文生圖；中文語境訓練優於純英文 SDXL 系。
- 站內 input：`{ prompt, image_size }`；不暴露 steps/CFG/scheduler。
- 文字渲染：**非** SOTA；金句卡勿當第一選擇。

## 5. 站內點數路徑

- 文生圖 → `reserveQuota`／`estimatePoints` 扁平 1。
- 無 needs → 可空跑 probe（有 KEY 時）。

## 6. 暴露面

- 創作台文生圖可選；分鏡草稿可用。
- MCP／agent 同 MODELS 白名單。
- 非 recommended；非 sc-text-card 主力。

## 7. 情境

- strengths／bestFor 合理（寫實中文場景）。
- 勿與「中文字卡第一主力」敘事混淆（那是 Qwen／Kolors 在 strengths 曾寫 SOTA 的是**其他**模型敘事；本檔 bestFor 已正確限縮）。

## 8. 文件

- https://fal.ai/models/fal-ai/kolors
- OpenAPI queue endpoint_id=fal-ai/kolors

## 9. 建議動作

| 動作 | 說明 |
|------|------|
| **維持** points=1、verified=false | 等 L2 覆核後再建議 verified |
| 可選 | L 佇列已有歷史 success → B9 可人工確認後 verified true |
