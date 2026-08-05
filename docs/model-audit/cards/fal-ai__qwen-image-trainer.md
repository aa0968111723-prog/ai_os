# fal-ai/qwen-image-trainer

> 審計：R5 · index **#252** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__qwen-image-trainer`  
> bulk OpenAPI 快照；本輪未重拉。**needs=zip** · points=**62** → 禁經濟 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **252** |
| 站內 id | `fal-ai/qwen-image-trainer` |
| endpoint | `fal-ai/qwen-image-trainer` |
| label | Qwen Image 訓練器(中文) |
| category / kind | **training** |
| tier | **economy** |
| points（目錄） | **62** |
| cost | `$0.002/步(千步≈$2,最低 250 步)` |
| verified | **False** |
| needs | **zip** |
| strengths | 在中文字渲染最強的開源底模上訓練風格/人物 LoRA;唯一「自家風格+中文不錯字」兼得的路線 |
| bestFor | 本會專屬風格的中文金句卡/海報/字卡 |

## 2. 數值

points=**62** · cost=`$0.002/步(千步≈$2,最低 250 步)` · **維持**（無帳單證據不改）

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| OpenAPI bulk | 見前序 thin |
| required（thin） | `['image_data_url']` |
| 站內 | `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),` |
| training probe | 本輪 P **ok** |
| L2 | 未跑（needs=zip · 高點） |
| 結論 | **ready-static-only** |

**P0** bulk required `image_data_url` vs 站內 `images_data_url`

## 4. 底層邏輯

訓練類：zip 素材 + 觸發詞 → LoRA；產物掛生成端。

## 5. 站內扣點／退點

estimatePointsFor → 62 · needs=zip · 探測不受理

## 6. 暴露面

訓練台 ✅ · probe ❌

## 7. 情境

有 zip 訓練包 ✅ · 無素材 ❌

## 8. 文件

- shared/models.ts #252
- fal https://fal.ai/models/fal-ai/qwen-image-trainer
- bulk thin card

## 9. 建議動作

- [x] 升 stub→九章  
- [ ] 核 OpenAPI 欄名（image(s)_data_url）  
- [x] 維持 points／verified  

**裁決：維持**
