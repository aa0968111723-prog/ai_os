# fal-ai/flux-kontext-trainer

> 審計：R5 · index **#250** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__flux-kontext-trainer`  
> bulk OpenAPI 快照；本輪未重拉。**needs=zip** · points=**78** → 禁經濟 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **250** |
| 站內 id | `fal-ai/flux-kontext-trainer` |
| endpoint | `fal-ai/flux-kontext-trainer` |
| label | Kontext 訓練器 |
| category / kind | **training** |
| tier | **flagship** |
| points（目錄） | **78** |
| cost | `$2.5/千步(最低 500 步 $1.25)` |
| verified | **True** |
| needs | **zip** |
| strengths | Kontext 基底;角色一致性微調 |
| bestFor | 固定講者/吉祥物的一致形象 |

## 2. 數值

points=**78** · cost=`$2.5/千步(最低 500 步 $1.25)` · **維持**（無帳單證據不改）

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| OpenAPI bulk | 見前序 thin |
| required（thin） | `['image_data_url']` |
| 站內 | `input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "CHAR" }),` |
| training probe | 本輪 P **ok** |
| L2 | 未跑（needs=zip · 高點） |
| 結論 | **ready-static-only** |

**P0** bulk required `image_data_url` vs 站內 `images_data_url`

## 4. 底層邏輯

訓練類：zip 素材 + 觸發詞 → LoRA；產物掛生成端。

## 5. 站內扣點／退點

estimatePointsFor → 78 · needs=zip · 探測不受理

## 6. 暴露面

訓練台 ✅ · probe ❌

## 7. 情境

有 zip 訓練包 ✅ · 無素材 ❌

## 8. 文件

- shared/models.ts #250
- fal https://fal.ai/models/fal-ai/flux-kontext-trainer
- bulk thin card

## 9. 建議動作

- [x] 升 stub→九章  
- [ ] 核 OpenAPI 欄名（image(s)_data_url）  
- [x] 維持 points／verified  

**裁決：維持**
