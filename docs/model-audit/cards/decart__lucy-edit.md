# decart/lucy-edit

> 審計：R4 · index **#168** · static+research · 2026-08-05  
> slug：`decart__lucy-edit`  
> **本輪已修 endpoint**：基底 id `decart/lucy-edit` → **404**；economy 映射 **`decart/lucy-edit/fast`**（曾抽樣 200）；`pro` 亦 200。  
> **未**改 verified／points。零 live。needs=video。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id | `decart/lucy-edit` |
| **實際 endpoint** | **`decart/lucy-edit/fast`**（`endpointOf` 覆寫） |
| 姊妹端點 | `decart/lucy-edit/pro`（200 已證）；`…/dev` 本輪逾時未證 |
| label | Lucy Edit 文字改影片 |
| category / kind | **video-to-video** · video |
| tier | **economy** |
| points | **16** |
| cost | `約$0.05–0.15/秒(dev/fast/pro 三檔);按秒計費,點數為 6 秒基準` |
| verified | **false** |
| needs | **video** |
| recommended | false |
| sourceHint | 要修改的影片網址 |
| strengths | 文字指令換裝/換物/風格;保留身份與動作 |
| bestFor | 口語修改:換服裝、換背景成佛堂 |
| vendor | Decart **Lucy Edit** via fal（無 `fal-ai/` 前綴） |

**一句話**：口語改片經濟檔——`prompt`+`video_url`；身份／動作保留向；**必走 `/fast`（或 pro）子路徑**，裸 `decart/lucy-edit` 不存在。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **16** |
| cost 區間 | ~$0.05–0.15/秒（三檔） |
| `parseRealCost` | mid ≈ **0.10**；×5 秒 → 0.10×5×31=**15.5** → **16** |
| estimatePoints | **扁平 16**（**不**隨來源片秒數） |
| 校準 | ≈ 中價×5s；cost 寫 6s 基準 vs 機械 5s 文案債 |

### P0 估點脫鉤

| 風險 | 說明 |
|------|------|
| 片長 | 來源 30s @ $0.10/s ≈ $3 ≈ **93 點**量級，站內仍扣 **16** |
| 檔位 | 映射 **fast**；若改 pro 單價可能更高，扁平不變 |
| 長片 | 與 lucy-restyle 同類：缺按秒動態估點 |

本輪**禁止**自動改 points。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 裸 id OpenAPI | `decart/lucy-edit` → **404** |
| fast | 曾 **200**（後續 SSL 不穩；以首次成功為準） |
| pro | **HTTP 200** · `LucyEditProInput`／`Output` |
| 修後 L0 | **ok**（endpoint 覆寫） |
| input | `{ video_url: s, prompt: p }` ✅ 雙 required |
| live | **未跑**（needs=video；無 KEY） |
| 結論 | **ready-static-only**（端點分檔已對；verified false；估點 P0） |

### OpenAPI 摘要（`decart/lucy-edit/pro` 本輪完整；fast 結構同族）

- **required**：`prompt` **與** `video_url`  
- **order**：prompt → video_url → resolution → sync_mode → enhance_prompt  
- `prompt`：maxLength **1500**（改裝／換景描述；英文例較穩）  
- `video_url`：來源片  
- `resolution`：enum **僅 `720p`**，default 720p  
- `enhance_prompt`：default **true**  
- `sync_mode`：default false  
- **Output**：`video`（File.url）  
- **無** aspect_ratio／duration 輸入（時長＝來源）  
- category：video-to-video  

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | 文字指令 **短段改片**（換裝／換物／風格）；保身份與動作 |
| vs Restyle (#163) | Edit＝口語局部改；Restyle＝長片整體風格（可至 ~30 分） |
| 分檔 | dev／fast／pro 價與速度階梯；站內 economy → **fast** |
| 站內 input | 雙必填齊；不送 enhance／resolution → 吃預設 |
| 中文 | 生態建議英文較穩，可中文嘗試 |

---

## 5. 站內扣點／退點

```
estimatePoints → 16
→ needs=video 檢查 → falSubmit("decart/lucy-edit/fast", { video_url, prompt })
→ 失敗 refund(16)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 一致 16 |
| 與長片實帳 | **脫鉤** P0 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| v2v 選擇器 | ✅ | needs=video |
| MCP | ✅ | modelId=`decart/lucy-edit`；須來源片 |
| pro／dev 分檔 UI | ❌ | 固定 fast |
| 時長上限 | ❌ | P0 |

**MCP 陷阱**：勿傳裸 endpoint 字串當 modelId 以外路徑；**勿**省略 video_url。

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 換服裝／換背景成佛堂 | ✅ | bestFor |
| 保留人臉謹慎改片 | ✅ | 身份安全敘事 |
| 整段長片統一風格 | ❌ | → lucy-restyle |
| 無片純文生 | ❌ | needs=video |
| 1080p 輸出 | ❌ | 僅 720p |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| pro OpenAPI | `…?endpoint_id=decart/lucy-edit/pro`（**200**） |
| fast | `decart/lucy-edit/fast`（本輪曾 200） |
| 裸 id | **404** |
| 生態 | `docs/fal生態研究.md` Lucy Edit 三檔 |
| 姊妹卡 | `decart__lucy-restyle.md` |

---

## 9. 建議動作

- [x] **修 endpoint** → `decart/lucy-edit/fast`（防 404）  
- [x] **維持** id／points=16／verified=false／input 雙欄  
- [ ] **P0**：按來源片時長動態估點或硬上限秒數  
- [ ] **可選 P3**：UI 選 fast／pro；pro 另 id 或 tier  
- [ ] **可選 P3**：重試核 `…/dev` 是否存活  
- [ ] **L2**（有 KEY+短片）：單次 live 控費  
- [ ] **勿**再呼叫裸 `decart/lucy-edit`  

**L0 結論**：分檔端點已映射；input 契約綠；長片估點 P0 同 restyle 族。  
**未做：** live、改 points／verified。
