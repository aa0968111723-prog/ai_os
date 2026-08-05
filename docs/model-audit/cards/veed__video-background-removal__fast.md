# veed/video-background-removal/fast

> 審計：R4 · index **#174** · static+research · **零 live** · 2026-08-05  
> slug：`veed__video-background-removal__fast` · 單一真相：`shared/models.ts`  
> **P0 家族 extract：** OpenAPI `video: File[]`；本輪 **`extractResult` 已支援陣列**（與 #167 同修）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id / endpoint | `veed/video-background-removal/fast`（無 alias） |
| label | VEED 影片去背 Fast |
| category | `video-to-video` |
| tier | **budget** |
| points | **2** |
| cost | **`$0.008–0.012/30幀;按秒計費,點數為 6 秒基準`** |
| verified | **false** |
| needs | **video** |
| strengths | VEED 半價快速版 |
| bestFor | 預覽構圖、內部試片;定案再跑標準版 |
| 姊妹 | 標準 #167（4 點）、綠幕 #175（5 點） |
| 角色定位 | VEED 去背 **半價預覽**；**未**進 `sc-video-bg` |

**L0：** **ok** — `video_url` required 對齊。

**一句話：** 標準版半價 **通用 AI 去背**（非綠幕）；6s＠中高價 ≈ **2 點**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 官方 | **$0.008–0.012／30 幀**（30fps≈每秒；生態 ✅） |
| 6s 上限 | 0.012×6=**0.072** ×31≈**2.23** → **2 點** ✅ |
| 6s 中價 | 0.06×31≈1.86 → 2 |
| 結論 | **維持 points=2** |

| 假設 | USD | vs 2 點 |
|------|-----|---------|
| 6s 上限 refine | 0.072 | ≈ |
| 10s 上限 | 0.12 | 低估 |
| 標準版 6s 上限 | 0.135 | 站內 4 |

---

## 3. 連通

| 項目 | 結果 |
|------|------|
| OpenAPI | **200** · `VideoBackgroundRemovalFastInput`／`FastOutput` |
| L2 | 未跑；禁止 `--yes` |
| 結論 | **ready-static-only**（extract 已修） |

### OpenAPI

| Property | Required | Default | 站內 |
|----------|----------|---------|------|
| `video_url` | **是** | — | ✅ |
| `output_codec` | 否 | **vp9** | ❌ |
| `refine_foreground_edges` | 否 | **true** | ❌ |
| `subject_is_person` | 否 | **true** | ❌ |

**Output：** `video`＝**`File[]`**（與標準／綠幕同）— **extractResult 本輪已取 `[0].url`**。

---

## 4. 風險

1. ~~extract 陣列~~ **已修**（P0-FIXED 家族）。  
2. 未暴露 subject／codec／refine。  
3. 長片扁平 2 點倒掛。  
4. h264 雙檔時只取第一支。

---

## 5. 點數

扁平 2 ≈ 6s＠上限。**未改 points／verified**。

---

## 6. 情境

| 情境 | 適配 |
|------|------|
| 內部預覽去背 | ✅ |
| 對外正式 | △ 上標準 VEED 或 Bria v3 |
| 真綠幕 | ❌ green-screen |
| 極省試錯 | △ Bria 經濟 1 點可能更省 |

---

## 7. 文件

- https://fal.ai/models/veed/video-background-removal/fast  
- OpenAPI endpoint_id=`veed/video-background-removal/fast`

---

## 8. 建議動作

- [x] 維持 points=2／input  
- [x] **P0 extract File[]**（共用 fal.ts）  
- [ ] 可選 subject_is_person  
- [ ] live 後 verified  

**總建議標籤：** `維持；2≈6s@上限；extract video[] 已修；ready-static-only`

### 狀態燈

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ok | 📄OpenAPI | 未跑 | 維持；extract 已修 |

---

## 9. 來源

1. OpenAPI 200（video array）  
2. `docs/fal生態研究.md` Fast $0.008–0.012/30幀  
3. 姊妹卡 #167  
4. `server/services/fal.ts` extractResult 陣列支援  

**未做：** live、改 verified／points。
