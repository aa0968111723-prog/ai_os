# fal-ai/latentsync

> 審計：R4 · index **#170** · static+research · 2026-08-05  
> slug：`fal-ai__latentsync`

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 170 |
| **id** | `fal-ai/latentsync` |
| **label** | LatentSync 對嘴(字節開源) |
| **category / tier / kind** | video-to-video · budget · video |
| **verified** | false |
| **needs** | **video** + secondary **audio** |
| **points** | 6 |
| **cost** | $0.20/≤40秒,之後 $0.005/秒;長片實際費用高於扣點 |
| **strengths** | 極低成本對嘴;真人與動畫皆可 |
| **bestFor** | 大量草稿對嘴、內部預覽 |

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **6** |
| ≤40s 固定 | $0.20 ×31 ≈ **6.2** → **≈6** |
| 逾 40s | +$0.005/s → 長片**低估**（目錄 cost 已警示） |
| 校準 | **≈**（短片）；長片 **低估** |

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| OpenAPI | **200** · required **video_url + audio_url** |
| 可選 | seed, guidance_scale default 1, loop_mode |
| Output | **video** |
| 站內 input | `{ video_url: s, audio_url: s2 }` ✓ 對齊 |
| L2 | **未跑**（需雙素材；禁止 probe 無源） |
| 結論 | **ready-static-only** |

## 4. 底層

- 字節開源 LatentSync 對嘴；只改嘴部時序、成本低。
- vs MuseTalk（保守全臉不重繪）／sync-lipsync v2/v3（商業檔）。

## 5. 點數路徑

- needs 雙源 → 工作台雙欄；**禁止** L 空 probe。
- reserveQuota 6。

## 6. 暴露面

- V2V 對嘴類；MCP 需同時傳 video+audio。
- 非 recommended。

## 7. 情境

- bestFor 草稿預覽合理；正式開示臉部保真可改 MuseTalk。

## 8. 文件

- https://fal.ai/models/fal-ai/latentsync

## 9. 建議動作

| 動作 | 說明 |
|------|------|
| **維持** | points=6、input 契約 OK |
| B9 | 長片動態估點（可選） |
| verified | false 至有素材 L2 |
