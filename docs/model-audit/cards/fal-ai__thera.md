# fal-ai/thera

> 審計：R2 · index **#65** · static+research · 2026-08-05  
> slug：`fal-ai__thera`  
> **P0 已修**：input 補 required `backbone: "edsr"`

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 65 |
| **id** | `fal-ai/thera` |
| **label** | Thera 忠實放大(零走樣) |
| **category / tier / kind** | image-to-image · economy · image |
| **verified** | false |
| **needs** | **image** |
| **strengths** | 任意倍率、數學上無鋸齒的忠實放大;幾乎零幻覺 |
| **bestFor** | 含中文字/書法的字卡、海報放大首選 |
| **vendor** | Thera（ETH 系 aliasing-free）via fal |

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost | **$0.0021/MP** |
| 1MP → NT$ | 0.0021×31≈**0.065** → 下限 **1** 點 |
| 4× 面積 | 輸入若 1MP→輸出 4MP 帳單≈$0.0084≈0.26→仍 **1** 點 |
| 校準 | **≈／略墊**（安全側） |

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| OpenAPI | **200** · `TheraInput` **required `image_url` + `backbone`** |
| backbone | enum **edsr \| rdn**（無 default！） |
| upscale_factor | number default **2** |
| Output | image + seed |
| 站內 input（修前） | 只送 image_url → **必 422** |
| 站內 input（修後） | `{ image_url, backbone: "edsr" }` |
| L2 | **未跑**（needs=image；禁止空 --yes） |
| 結論 | **ready-static-only**（契約已修） |

## 4. 底層

- 忠實／零走樣超分；字卡／書法首選敘事與 sc-text-upscale pickIds 一致。
- vs CCSR／AuraSR：Thera 更偏數學無鋸齒；AuraSR 固定 4× GAN；CCSR 擴散 steps 重。

## 5. 點數路徑

- needs=image → 工作台強制來源；`reserveQuota` 1 點。
- 禁止 L probe 無圖。

## 6. 暴露面

- 圖生圖放大類可選；`sc-text-upscale` pickIds 含本 id。
- 直接出圖需上傳來源。

## 7. 情境

- bestFor 合理；與 clarity／supir「生成式」定位互補。

## 8. 文件

- https://fal.ai/models/fal-ai/thera

## 9. 建議動作

| 動作 | 狀態 |
|------|------|
| **修 input backbone** | **已做**（edsr） |
| 維持 points=1 | ✓ |
| verified | 維持 false 至有圖 L2 |
| 可選 | UI 暴露 backbone／upscale_factor（非必須） |
