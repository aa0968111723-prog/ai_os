---
depth: v2
model_id: fal-ai/bytedance/seedream/v5/text-to-image
label: Seedream 5.0 Pro
endpoint: fal-ai/bytedance/seedream/v5/text-to-image
category: text-to-image
tier: flagship
points: 2
verified: false
recommended: false
researched: 2026-08-05
openapi: UNAVAILABLE_404
openapi_probe: "2026-08-05 GET …/openapi.json?endpoint_id=fal-ai/bytedance/seedream/v5/text-to-image → HTTP 404"
sibling_openapi_ref: fal-ai/bytedance/seedream/v4.5/text-to-image
---

# Seedream 5.0 Pro · `fal-ai/bytedance/seedream/v5/text-to-image`

## 0. 總覽

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/bytedance/seedream/v5/text-to-image`（同字串；**fal 推定 slug**） |
| 類別 / tier / kind | text-to-image · **flagship** · image |
| 點數 / 官方成本 | **2 點** · **約 $0.05–0.09/張（待 fal 計價確認）** |
| verified / recommended | **false** / false |
| 供應商 | ByteDance Seedream **5.0**（外部 2026-07 發布敘事）；**fal queue OpenAPI 本回合 404** |
| 角色 | 目錄：最複雜中文長版海報升級檔；recipe 長版中文 pickIds 含本 id（次於 Qwen Pro） |
| 底層 | **未在 fal 取證**；預期延續 Seed 系生成+版面（見 v4.5 卡／生態研究） |
| 文字塔 | `seedream` 字節 Seed 系；**未公開**窗口；**不可量 token** |
| 負向提示 | 站內 **未** allowlist（與 v4.5 同策略） |
| Seed | SEED_SUPPORTED **未收** |
| 站內 input | `{ prompt, image_size }` 三比例 enum（**假設**對齊 v4.5；官方 schema 未驗證） |
| 生成可用性 | **極低直至 slug 復活**：OpenAPI 404 ⇒ 提交大概率失敗 |

**一句話**：目錄已收「Seedream 5 旗艦」但 **fal 端點仍不存在（404）**——研究結論是 **P0 死端點／slug 待校正**，勿當可生成模型；中文長海報請用 **Seedream 4.5（verified）** 或 Qwen Pro。

**交叉結論**：

| 情境 | 適配 | 原因 |
|------|------|------|
| 最複雜中文長版海報（產品意圖） | ❌ 現況 | 端點 404 |
| recipe 長中文 pick | ⚠️ 誤導 | pickIds 含本 id 但不可用 |
| 助手自動 | ❌ | verified=false + 404 |
| 替代 | ✅ | `fal-ai/bytedance/seedream/v4.5/text-to-image`（1 點、verified） |

## 1. 底層邏輯

### 1.1 架構（僅外部／家族推論）

| 層 | 說明 |
|----|------|
| fal OpenAPI | **404** — 無 `Flux*`-style schema 可引 |
| 生態研究 | landing 文案有 Seedream 5.0；slug 推定 `…/v5/text-to-image` |
| deep-dive #15 | 2026-08 已標 fal 頁 404；火山方舟有 API |
| 站內 mechanics | `unknown` |
| 相對 v4.5 | v4.5 為 DiT+VAE 統一生成編輯；5.0 宣稱版面／理解升級——**無 fal 證據** |

### 1.2 官方 OpenAPI（本模型）

| 探測 | 結果 |
|------|------|
| `…/openapi.json?endpoint_id=fal-ai/bytedance/seedream/v5/text-to-image` | **HTTP 404** |
| 變體 slug（seedream/v5、v5.0、v5-pro、bytedance-seedream…） | 皆 **404** |
| playground 預期 URL | 未驗證（OpenAPI 已死） |

**→ 本章無 `*Input` properties 可列。** 以下 §1.3 僅 **姊妹 v4.5** 對照，供端點上線後 diff，**不得**當成 v5 已證實契約。

### 1.3 參考：姊妹 `v4.5` OpenAPI 全 properties（非本 id）

來源：`endpoint_id=fal-ai/bytedance/seedream/v4.5/text-to-image`（本回合可拉）。

| property | 型別 / 約束 | 預設 | v4.5 站內 | 對 v5 含義 |
|----------|-------------|------|-----------|------------|
| `prompt` | string **required** | — | ✅ | 若 v5 延續，必填 |
| `image_size` | ImageSize 或 enum／`auto_2K` 等 | — | ✅ preset | v5 站內同送 preset；**未證實** |
| `num_images` | 1–6 | 1 | ❌ | |
| `max_images` | multi-image | — | ❌ | |
| `seed` | int \| null | — | ❌ | |
| `sync_mode` | boolean | false | ❌ | |
| `enable_safety_checker` | boolean | true | ❌ | |
| `negative_prompt` | — | — | 無 | v4.5 無；v5 未知 |

v4.5 像素約束：寬高 1920–4096 或總像素區間（高解析）。

## 2. 分詞器／文字塔

| 項 | 值 |
|----|-----|
| key | `seedream`（`seedream\|seededit\|bytedance`） |
| label | 字節 Seed 系（未公開） |
| tokenizer | sentencepiece |
| limitTokens | undefined |
| 可量測 | false |

### 2.1 `measurePromptBudget`（id=本模型；無詞表）

| 樣本 | chars | totalTokens | measured | overflows |
|------|------:|------------:|:--------:|:---------:|
| 短英 | 39 | null | false | false |
| 長繁中 | 58 | null | false | false |

產品敘事：中文／多語文字第一梯隊——**在 fal 不可用前無法驗證**。

## 3. 站內契約 vs 官方 schema

### 3.1 目錄

```ts
{
  id: "fal-ai/bytedance/seedream/v5/text-to-image",
  label: "Seedream 5.0 Pro",
  points: 2,
  cost: "約 $0.05–0.09/張(待 fal 計價確認)",
  verified: false,
  input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
}
```

### 3.2 三比例 input（站內實測）

| format | body | 官方驗證 |
|--------|------|----------|
| 1:1 | `image_size: "square_hd"` | ❌ 無 OpenAPI |
| 16:9 | `landscape_16_9` | ❌ |
| 9:16 | `portrait_16_9` | ❌ |

### 3.3 契約健康度

- **不改 input**：無官方 schema 時無法判定 422；模式抄 v4.5 合理。
- **真正問題**：endpoint **不存在** → 任何 body 都失敗（404／not found），不是欄位名問題。
- 建議產品：從 recipe pickIds **暫時移除**本 id，或標「未上架」。

## 4. MCP

| 工具 | 關係 |
|------|------|
| find_model | 可能命中（目錄有）→ **誤導** |
| submit_generation | 會扣點／排隊後供應商失敗風險 |
| 建議 | MCP 文案應避免推薦 verified=false 且 404 的 id |

## 5. AI 代理／助手

| 路徑 | 行為 |
|------|------|
| operational | false |
| assistant list | 不含 |
| pick | → flux/dev |
| recipe 長中文海報 | pickIds 含本 id → **規劃層可能寫進計畫但執行失敗** |

## 6. 生成可用性

| 項 | 狀態 |
|----|------|
| OpenAPI | **404** |
| verified | false |
| live-probe | 未做（無端點可探） |
| 適用 | **無**（直至 fal 上架） |
| 替代 | Seedream 4.5、Qwen Image 2 Pro／Max |

## 7. 點數校準

| 項 | 值 |
|----|-----|
| points | **2** |
| cost 區間 | $0.05–0.09 → 中值 $0.07 → 報告估值 NT$2.2，≈ |
| usdUnitToPoints(0.05/0.07) | 2；0.09 → 3（上限檔可能低估點數） |
| estimatePoints | 扁平 2 |
| 實務 | 端點不存在則不應扣成功點（既有失敗退點假設） |

## 8. 測試與修復

### 8.1 建議回歸（≥1）

1. **端點存活**：`GET openapi?endpoint_id=…/v5/…` 期望未來 **200**；現況 assert 可記錄 404 為 known issue。  
2. recipe：長中文 pick **不應**唯一依賴 404 id（或標 skip）。  
3. 上線後：對齊 v4.5 全 properties 表重跑 depth v2。

### 8.2 修復優先級

| 級 | 項 |
|----|-----|
| **P0** | 校正 fal slug 或自目錄／recipe 下架 |
| P0 | 勿 verified:true |
| P1 | 上架後補 OpenAPI 全表＋三比例 live |
| P2 | 計價字串改官方單位價 |

## 9. 來源

1. OpenAPI 探測 2026-08-05：本 id **404**；v4.5 schema 對照  
2. `shared/models.ts` entry／recipe  
3. `docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` §#15  
4. `docs/fal生態研究.md` Seedream 5 列  
5. `docs/點數校準報告.md`  
6. 姊妹卡 `fal-ai__bytedance__seedream__v4.5__text-to-image.md`  
7. textEncoders seedream；assistant 政策  

---

**depth v2 checklist**

- [x] OpenAPI：記錄 **404** + 姊妹全表對照  
- [x] 三比例站內 input  
- [x] measure 短長  
- [x] MCP／助手／情境  
- [x] 點數  
- [x] §8 ≥1  
- [x] 無 live-probe；無 apply-fixes（無 schema 可修）

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd08e-3597-7eb0-b733-e7da17e5d341` |
| 結果 | **failed 404** Path `/seedream/v5/text-to-image` not found |
| **P0** | 端點死 — 下架或改現行 slug |
| verified | **維持 false** |
