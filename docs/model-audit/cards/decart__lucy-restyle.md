# decart/lucy-restyle

> 審計：R4 · index **#163** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`decart__lucy-restyle`  
> 禁止改 `verified`／`points`（本卡僅建議；點數風險另註）

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 163 |
| **id** | `decart/lucy-restyle` |
| **endpoint** | 同 id（非 `fal-ai/` 前綴；Decart 夥伴端點） |
| **label** | Lucy Restyle 長片風格轉換 |
| **category** | `video-to-video` |
| **tier** | `flagship` |
| **kind** | `video` |
| **verified** | **`false`**（目錄 ⚠︎；OpenAPI 本輪 200） |
| **needs** | **`video`**（必填來源影片 URL） |
| **recommended** | `false` |
| **sourceHint** | 要轉換風格的影片網址 |
| **strengths** | 長達 30 分鐘整體風格轉換；保留身份與動作連貫 |
| **bestFor** | 整段長片開示轉統一美術風格 |
| **vendor** | Decart Lucy Restyle via fal.ai |

**一句話**：長片風格轉換旗艦——`prompt` 描述目標美術 + `video_url` 來源片；標榜可至約 30 分鐘並保身份／動作。**計費依時長**，站內 19 點僅 **6 秒基準**，長片會嚴重低估平台成本。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points** | **19** | 註解：暫依 Lucy Edit 級距 ≈$0.1/秒 × 6s ×31 粗估 |
| **cost** | `依時長計費(以 fal 現場為準);點數為 6 秒基準,長片實際費用高於扣點` | 目錄已誠實標風險 |
| **官方精確 $/秒** | **未在 OpenAPI 固化**；生態「依時長、長片分段」 | 校準報告：**需人工** |
| **parseRealCost** | 多半 **無 $ 金額** → 無法機械 realPricePoints | 見 `docs/點數校準報告.md` |
| **estimatePoints** | **扁平 19**（**不**隨影片秒數） | 與長片帳單脫鉤 |
| **校準判定** | **⚠ 低估風險（文件已知）** | 短測片或可 ≈；開示長片 **實費 ≫ 扣點** |

**風險（本輪禁止自動改 points）**：

1. **長片倒貼**：30 分鐘若接近 $0.1/秒級 → 帳單可達數百 USD，站內仍扣 19 點。
2. 註解自承「價格未定」；cost 字串已警告「長片實際費用高於扣點」——產品應配時長上限或按秒估點（**P0 產品債**，非本輪改碼）。
3. 建議人審方向（**勿自動改**）：按秒動態 `estimatePoints` 或硬性 max duration + 明示「僅短樣片估點」。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0** | **ok** | needs=video；input 含 video_url+prompt；欄位齊 |
| **OpenAPI** | **HTTP 200** | `LucyRestyleInput`／`LucyRestyleOutput` |
| **L1 歷史** | 連通報告**未列**本 id | 本輪無 FAL_KEY 未 probe |
| **live** | **未跑** | needs=video → `verify-models --probe` **拒絕** |
| **結論** | **ready-static-only** | schema 與 input 對齊；verified 維持 false；**計費契約危險** |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`prompt` **與** `video_url`（缺一不可）
- **order**：`prompt` → `video_url` → `seed` → `resolution` → `enhance_prompt` → `sync_mode`
- **video_url**：要編輯的影片 URL
- **prompt**：目標風格／內容文字描述
- **resolution**：enum **僅 `720p`**，default `720p`（無可選 1080p）
- **enhance_prompt**：bool default **true**
- **seed**：integer 可選
- **sync_mode**：bool default false（同步等待上傳）
- **Output**：`video` only（無 seed 回傳欄於 required 列表外——Output required 僅 video）
- **無** aspect_ratio／duration 輸入（時長吃來源片）

## 4. 底層邏輯

### 4.1 產品能力

- **長片 restyle**：整段風格統一轉換，保留人物身份與動作連貫（相對短段 Modify）。
- **輸入形態**：文生指令 + 源影片（非純 t2v）。
- **解析**：固定 720p 檔輸出敘事。

### 4.2 站內 `input()`

```ts
input: (p, _f, s) => ({ video_url: s, prompt: p })
```

| 官方 | 站內 | 備註 |
|------|------|------|
| `video_url` | ✅ `s` | needs=video |
| `prompt` | ✅ `p` | **必填**；空 prompt 可能 422 |
| 畫幅 `f` | ❌ | 無 aspect 欄 |
| `resolution` | ❌ → 720p | 唯一 enum |
| `enhance_prompt` | ❌ → true | |
| `seed` | ❌ | 不在 SEED_SUPPORTED |

### 4.3 契約缺口

1. **空 prompt**：UI 應強制非空風格描述（OpenAPI required）。
2. **時長／估點脫鉤**：P0。
3. **verified false**：待有片 live。
4. 與 `decart/lucy-edit`（#168）分工：Edit＝短段口語改裝／換景；Restyle＝長片整體風格。

## 5. 站內點數路徑

```
需 video 來源 → estimatePoints=19（固定）→ reserveQuota(19)
  → falSubmit("decart/lucy-restyle", { video_url, prompt })
  → 失敗 refund(19)
  → 供應商仍可能按整片時長計費（平台承擔差額風險）
```

| 檢查 | 結果 |
|------|------|
| 顯示＝扣＝退 | 19 內部一致 |
| 與真實成本 | **長片不一致**（已知） |
| verified false | 首跑失敗應退點；勿自動 true |

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| v2v flagship 選擇器 | ✅ | needs 攔截 |
| catalog / tRPC / MCP | ✅ | id 含 `decart/` |
| 時長預警 UI | ⚠ 建議 | cost 字串有、UI 未必醒目 |
| enhance／seed UI | ❌ | |
| `verify-models --probe` | ❌ | needs=video |

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 長開示轉統一美術風格 | ✅ 首選 | bestFor；**務必控成本** |
| 短樣片試風格 | ✅ | 19 點相對可接受 |
| 只改服裝／單一物件 | △ | 改 Lucy Edit |
| 無風格文字、只丟片 | ❌ | prompt required |
| 無來源影片 | ❌ | needs=video |
| 要 1080p 輸出 | ❌／△ | schema 僅 720p |

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `endpoint_id=decart/lucy-restyle`（本輪 200；`LucyRestyleInput`） |
| 模型頁 | https://fal.ai/models/decart/lucy-restyle |
| 站內 | `shared/models.ts` L1559–1566 |
| 生態／目錄／校準 | fal生態研究 §Lucy Restyle；模型目錄 ⚠；點數校準「需人工」 |
| 清查 | `docs/模型清查清單.md` verified=false + 需影片 |

## 9. 建議動作

- [x] **維持** id／endpoint、input 欄位名（video_url+prompt 對齊 required）
- [x] **維持** verified=false（禁止自動 true）
- [x] **維持** points=19 本輪不改（禁止自動改 points）— **但標 P0 低估**
- [ ] **P0 產品**：按秒估點或 max 時長閘門 + 帳單預警（長片）
- [ ] **P1**：UI 強制非空 prompt；標 720p only
- [ ] **有片 live**：短樣（≤6s）對帳後人審 verified
- [ ] **P3**：可選 seed／enhance_prompt=false
- [ ] **勿**對 needs=video 跑 `verify-models --probe --yes`

**L0 結論**：OpenAPI 綠、站內 input 對齊雙 required。最大問題是 **扁平 19 點 vs 依時長計費**（目錄已警告）。剩餘：估點改革、有片 live、verified。
