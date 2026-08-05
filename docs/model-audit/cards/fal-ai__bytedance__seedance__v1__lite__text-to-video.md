# fal-ai/bytedance/seedance/v1/lite/text-to-video

> 審計：R3 · index **#120** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__bytedance__seedance__v1__lite__text-to-video`  
> ⚠️ **OpenAPI about：本端點已 deprecated**，相容性轉發至 **Seedance 1.0 Pro Fast**；**Pricing will change accordingly**。本輪**未**改 id／points／verified／input。

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/bytedance/seedance/v1/lite/text-to-video`（`endpointOf` 同字串） |
| label | Seedance 1.0 Lite(字節) |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points | **6** |
| cost（目錄） | `$0.18/支(720p 5秒)` |
| verified | **true**（既有；本回合**未**改） |
| needs | 無 |
| recommended | **false** |
| strengths | Seedance 720p 經濟版;寫實傾向、每支超划算 |
| bestFor | 寫實敘事鏡頭的量產與草稿 |
| 供應商 | ByteDance Seed · fal 託管（**現轉發 Pro Fast**） |
| 姊妹 | Pro t2v 19 點；1.5 Pro 含音 8 點；2.0 47 點；Lite i2v；站外 **Pro Fast** `…/v1/pro/fast/text-to-video`（≈$0.245/1080p 5s） |

**一句話**：目錄上的 Seedance **寫實經濟草稿檔**——OpenAPI 宣告 **已棄用並轉 Pro Fast**；aspect **含 1:1** 契約健康，但**計費可能已偏離 $0.18 敘事**（見 §2 P0）。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **6** |
| cost（目錄） | `$0.18/支(720p 5秒)` |
| 歷史官方（生態研究／校準） | Lite **$0.18／720p 5s**；$1.8／1M video tokens |
| 轉發目標 Pro Fast（公開頁） | **≈$0.245／1080p 5s**；$**1**／1M video tokens |
| `parseRealCost` | `usdMid: 0.18` · `×1` |
| `realPricePoints` | `0.18 × 31 = 5.58` → **round 6**（校準 5.6 ≈） |
| `estimatePoints` | 扁平 **6**（不隨 duration／resolution） |
| 站內實際送出 | 僅 `prompt` + `aspect_ratio` → 吃 schema 預設 **duration=`"5"`**、**resolution=`720p`**（Lite schema） |

### 風險（**P0 棄用＋計費漂移**，本輪不改 points）

| 情境 | 約 USD | ×31 | vs 扣 6 點 |
|------|--------|-----|------------|
| 仍按 Lite $0.18 @720p 5s | 0.18 | 5.6 | **≈**（目錄假設） |
| 轉 Pro Fast 且吃 **1080p** 預設 | ~0.245 | ~7.6 | **低估 ~1–2 點** |
| 轉 Pro Fast @720p（$1/M tok 粗估） | ~0.11 | ~3.4 | 平台**高估** |
| 長秒 10–12s @1080p Pro Fast | 加倍+ | 15+ | 嚴重低估 |

- OpenAPI **about 明文** deprecated + redirect + pricing change → 目錄 cost／strengths「Lite 720p $0.18」可能**過時**。  
- Lite schema **default resolution=720p**；Pro Fast schema **default=1080p**——轉發時以哪套預設計費**未在 live 驗證**（本輪禁止 --yes）。  
- 建議產品：**改 endpoint 至 `…/v1/pro/fast/text-to-video`** 並重校 points（約 8＠1080p5s 或依實際 token），或在 UI 標「相容別名／價可能變」。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| OpenAPI | **HTTP 200** · `BytedanceSeedanceV1LiteTextToVideoInput`／Output |
| about | *「This model has been deprecated… redirecting requests to seedance 1.0 pro fast. Pricing will change accordingly.」* |
| dry-run / live | **未跑**（無 FAL_KEY；禁止 --yes） |
| 結論 | **ready-static-only（契約綠；供應商棄用警告）** — verified 維持 true；計費 P0 未解 |

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| mechanics | **dit** · seedance 正則 |
| 文字塔 | **video-closed** |
| 輸出 | `video` + `seed`（echo） |

### 4.2 官方 OpenAPI 摘要（Lite 端點，2026-08-05）

- **required**: 僅 `prompt`
- **order**: prompt → aspect_ratio → resolution → duration → camera_fixed → seed → enable_safety_checker → num_frames
- `aspect_ratio` — enum **`21:9`｜`16:9`｜`4:3`｜`1:1`｜`3:4`｜`9:16`｜`9:21`**，default `16:9`（**有 1:1**）
- `resolution` — **`480p`｜`720p`｜`1080p`**，default **`720p`**
- `duration` — `"2"`…`"12"`，default **`"5"`**
- `camera_fixed` — bool，default false
- `seed` — int｜null（-1 隨機）
- `enable_safety_checker` — default true
- `num_frames` — 29–289｜null（覆蓋 duration）
- **無** negative_prompt／原生音訊

**Pro Fast 對照**（轉發目標 schema）：aspect **無 `9:21`**；resolution default **1080p**；其餘欄位同形。站內只送 16:9／9:16／1:1 → **不撞 9:21**。

### 4.3 站內 `input()` vs 官方

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) })
// aspect = (f) => f  → "16:9" | "9:16" | "1:1"
```

| format | body | Lite OpenAPI |
|--------|------|--------------|
| `16:9` | `aspect_ratio: "16:9"` | ✅ |
| `9:16` | `"9:16"` | ✅ |
| `1:1` | `"1:1"` | ✅ **合法**（優於 Luma） |

| 能力 | 站內 | 官方 | 備註 |
|------|------|------|------|
| prompt | ✅ | required | — |
| aspect_ratio | ✅ 三比例 | 含 1:1 | **健康**；無需 P0 修 input |
| duration／resolution | ❌ 不送 | 5s／720p | 對齊舊 Lite 敘事 |
| seed | 不送（**不在** SEED_SUPPORTED） | schema 有 | P2 可選 allowlist |
| negative_prompt | 不送 | 無 | 正確 |

**契約健康度（請求形狀）**：**優**。供應商層 **deprecated redirect** 才是主風險。

### 4.4 generationCore

- body 僅 prompt + aspect  
- 扁平 6 點 reserve  
- `falSubmit` 仍打 **lite** id（由 fal 端轉發）

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 | **6** ≈ 舊 Lite $0.18 |
| 估點 | 扁平 6 |
| 本輪 | **不調 points**（禁自動改；真實轉發帳單待 live 對帳） |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 寫實敘事量產草稿 | ✅／⚠️ | 產品定位仍成立；實際可能已是 Pro Fast 品質／價 |
| 有聲短片 | ❌ | 1.0 線無原生音 → 用 1.5 Pro／2.0／Veo |
| 社群 1:1 | ✅ | enum 含 1:1 |
| 中文提示 | ✅ | 字節系 |
| 要穩定官方價 | ⚠️ | 應遷 **pro/fast** 並改 cost 文案 |

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| 文件 | [Lite 模型頁](https://fal.ai/models/fal-ai/bytedance/seedance/v1/lite/text-to-video)（可能標 deprecated） |
| OpenAPI | `…?endpoint_id=fal-ai/bytedance/seedance/v1/lite/text-to-video` |
| 建議後繼 | [Pro Fast](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/fast/text-to-video) · ≈$0.245/1080p5s |

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/bytedance/seedance/v1/lite/text-to-video",
  "prompt": "清晨山徑薄霧，固定機位，寫實自然光，無人無字幕"
}
```

## 8. 建議動作

- [x] **維持** points=6、verified=true、input 不變（aspect 健康）
- [ ] **P0** 產品：確認轉發後實價 → 更新 cost／points 或 **遷 endpoint → pro/fast**
- [ ] **P2** `SEED_SUPPORTED` 收錄本 id（schema 有 seed）
- [ ] **P3** UI 標「Lite 別名／可能計 Pro Fast 價」
- [ ] 下架 — **暫否**（仍 200 且轉發可用）；待產品決策
- [ ] L4 live 對帳 — 有 KEY 時單次 probe（**勿**大批 --yes）

| 級 | 項 |
|----|-----|
| P0 | 棄用轉發＋計費可能 ≠ $0.18；需對帳或遷 pro/fast |
| P2 | SEED allowlist 可選 |
| — | **不**需修 1:1（合法） |

## 9. 來源

1. OpenAPI 2026-08-05 Lite：deprecated about + 全 properties  
2. OpenAPI Pro Fast：default 1080p；公開定價 ≈$0.245/1080p5s · $1/M tok  
3. `shared/models.ts`；校準報告 5.6 ≈；`docs/fal生態研究.md` Lite $0.18  
4. 姊妹卡 #109 Pro／#110 1.5 Pro  

---

**R3 checklist（#120）**

- [x] L0  
- [x] OpenAPI 200 + **deprecated 註記**  
- [x] 點數／轉發計費風險  
- [x] aspect 1:1 **合法**（未改 input）  
- [x] 卡 + `_index` + lock  
- [x] 零 live／未改 verified

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd099-7278-7871-bd8a-c1d72260a4e9` |
| 結果 | **success** · mp4 |
| artifact | https://v3b.fal.media/files/b/0aa5158d/xa3hVEKlWNsPPO0YMeJYR_video.mp4 |
| pointsEst | 6 |
| verified | 目錄 true；**本輪不改** |
