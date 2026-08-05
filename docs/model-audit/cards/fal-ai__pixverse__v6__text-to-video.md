# fal-ai/pixverse/v6/text-to-video

> 審計：R3 · index **#122** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__pixverse__v6__text-to-video`  
> **endpoint 已確認**（註解曾寫「slug 推定」）→ OpenAPI **200** 活躍。本輪**未**改 verified／points／input。

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/pixverse/v6/text-to-video`（`endpointOf` 同字串；**非** 404） |
| label | PixVerse V6 |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points | **14** |
| cost（目錄） | `$0.090/秒(無音)、$0.115/秒(含音,1080p);按秒計費,點數為 6 秒基準` |
| verified | **true**（既有；本回合未改） |
| needs | 無 |
| recommended | **false** |
| strengths | 音畫一次生成(配樂+音效+對白同提示);1080p |
| bestFor | 一鍵出有背景音樂的直式短片、預告 |
| 供應商 | PixVerse V6 · fal queue |
| 姊妹 | v5.5 t2v（9 點）；v5 i2v；C1 等 |

**一句話**：PixVerse **按秒分層＋可選原生音** 的經濟短片檔——schema **活躍**；站內 **不送** `generate_audio_switch`／`resolution` → 實際吃 **720p／5s／無音**，與 bestFor「有 BGM」及 cost「1080p 價＋6 秒基準」敘事有落差（見 §2）。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **14** |
| cost（目錄） | 上表（**只寫 1080p 階**） |
| 官方全階（模型頁 2026-08 公開摘要） | 見下表 |
| `parseRealCost` | 首個 `$0.090/秒` → usdMid=**0.09**；`PRICE_VIDEO_SECONDS=**5**` → **×5**（**不是**文案 6 秒） |
| `realPricePoints` | `0.09 × 5 × 31 = 13.95` → **round 14**（校準 13.9 ≈） |
| `estimatePoints` | 扁平 **14** |
| 站內實際送出 | 僅 prompt + aspect → 官方 default：**duration=5**、**resolution=720p**、**generate_audio_switch=false** |

### 官方每秒價（fal 公開）

| 解析 | 無音 $/s | 含音 $/s |
|------|----------|----------|
| 360p | 0.025 | 0.035 |
| 540p | 0.035 | 0.045 |
| **720p（預設）** | **0.045** | **0.060** |
| **1080p（cost 文案錨）** | **0.090** | **0.115** |

### 校準對照（×31）

| 設定 | 約 USD | 約 NT$ | vs 固定 14 點 |
|------|--------|--------|---------------|
| **5s · 720p · 無音（站內現況預設）** | 0.225 | 7.0 | 平台**高估 ~2×** |
| 5s · 720p · 含音 | 0.30 | 9.3 | 仍高估 |
| 5s · 1080p · 無音（機械估點假設） | 0.45 | 14.0 | **≈** |
| 6s · 1080p · 無音（cost「6 秒基準」） | 0.54 | 16.7 | 低估 ~3 點 |
| 6s · 1080p · 含音 | 0.69 | 21.4 | 嚴重低估 |
| 15s · 1080p · 含音（schema max） | 1.725 | 53.5 | 極嚴重低估 |

**判定**：

- 目錄 points **對齊 1080p 無音 5s**（機械 ×5），**不是** 6 秒、也**不是**預設 720p。  
- cost 文案「6 秒基準」與 `parseRealCost` **×5** → **P1 文案債**（同其他按秒模）。  
- bestFor／strengths 強調 **有音**，但 input **未** `generate_audio_switch: true` → 使用者拿到的是 **無音** 720p（**P1 產品敘事 vs 請求**）。  
- 本輪**不改 points**（禁自動）；若產品要兌現「一鍵 BGM」：input 開音 + 重校（720p 含音 5s≈9；1080p 含音 5s≈18）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| OpenAPI | **HTTP 200** · `PixverseV6TextToVideoInput`／Output · about「Text To Video V6」 |
| endpoint 推定註解 | models.ts 曾寫「slug 推定、首跑確認」→ **本輪確認 endpoint 存在** |
| dry-run / live | **未跑** |
| 結論 | **ready-static-only** — schema 綠、aspect 健康；估點／音訊敘事 P1 |

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| mechanics | **dit**（pixverse 影片族） |
| 文字塔 | **video-closed** |
| 輸出 | `video`（File） |

### 4.2 官方 OpenAPI 摘要（2026-08-05）

- **required**: 僅 `prompt`（限 2048 UTF-8 **bytes**）
- **order**: prompt → aspect_ratio → resolution → duration → negative_prompt → style → seed → generate_audio_switch → generate_multi_clip_switch → thinking_type
- `aspect_ratio` — enum **`16:9`｜`4:3`｜`1:1`｜`3:4`｜`9:16`｜`2:3`｜`3:2`｜`21:9`**，default `16:9`（**有 1:1**；**無**單獨「正方形以外」缺口）
- `resolution` — **`360p`｜`540p`｜`720p`｜`1080p`**，default **`720p`**
- `duration` — integer **1–15**，default **5**（**按秒**，非 enum 字串）
- `negative_prompt` — string，default `""`（2048 bytes）
- `style` — `anime`｜`3d_animation`｜`clay`｜`comic`｜`cyberpunk`｜null
- `seed` — int｜null
- `generate_audio_switch` — bool，default **false**（BGM／SFX／dialogue）
- `generate_multi_clip_switch` — bool，default false
- `thinking_type` — `enabled`｜`disabled`｜`auto`｜null（prompt 優化）

### 4.3 站內 `input()` vs 官方

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) })
```

| format | body | OpenAPI |
|--------|------|---------|
| `16:9` | `"16:9"` | ✅ |
| `9:16` | `"9:16"` | ✅ |
| `1:1` | `"1:1"` | ✅ **合法** |

| 能力 | 站內 | 官方 | 備註 |
|------|------|------|------|
| prompt | ✅ | required | byte 上限站內未 cap |
| aspect_ratio | ✅ 三比例 | 含 1:1 | **健康**；**無需 P0 修 aspect** |
| duration | ❌ | default 5 | 扁平點數假設 5s 機械一致 |
| resolution | ❌ | default **720p** | 與 cost／points 的 **1080p** 錨**不一致** |
| generate_audio_switch | ❌ | default **false** | 與 bestFor「有 BGM」**不一致** |
| negative_prompt | 不注入（allowlist 無） | schema 有 | 世界觀禁忌無法走 negative |
| seed | 不送 | schema 有 | 消融不可鎖噪 |
| style／multi-clip／thinking | 不送 | 有 | 進階未暴露 |

**契約健康度（請求不 422）**：**優**。產品敘事（有音／1080p 價）與預設請求 **中度落差**（P1，非必炸）。

### 4.4 generationCore

- body：prompt + aspect  
- 扁平 14 → reserve  
- 不開音、不送 1080p

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 | **14** ≈ 1080p 無音 5s |
| 實際預設成本 | 720p 無音 5s ≈ **7 點** 量級 → 現扣 14 偏保守（平台不倒貼預設路徑） |
| 風險方向 | 若未來 UI 開 **長秒／1080p／含音** 而不調點 → 倒貼 |
| 本輪 | **維持 14**；建議後續動態估點或鎖參數 |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 直式短片草稿（無音） | ✅ | 9:16 合法；720p 預設夠用 |
| 「一鍵有 BGM」 | ⚠️ | schema 支援但站內**未開** switch |
| 1080p 成片 | ⚠️ | 不送 resolution → 非 1080p |
| 社群 1:1 | ✅ | enum 含 1:1 |
| 風格模板（anime 等） | △ | schema 有 style；站內未暴露 |
| 中文提示 | △ | 生態研究：英文主場 |

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| 文件 | [fal 模型頁](https://fal.ai/models/fal-ai/pixverse/v6/text-to-video) |
| OpenAPI | `…?endpoint_id=fal-ai/pixverse/v6/text-to-video` |
| 定價 | 720p $0.045/s 無音｜$0.060 含音；1080p $0.090｜$0.115 |

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/pixverse/v6/text-to-video",
  "prompt": "Upbeat vertical promo, dynamic camera, colorful stage lights, no on-screen text"
}
```

（若要真有音：需產品改 input 送 `generate_audio_switch: true` 並重校點數。）

## 8. 建議動作

- [x] **維持** points=14、verified=true、aspect 直通（1:1 合法）
- [x] **確認 endpoint** 非推定死鏈（OpenAPI 200）
- [ ] **P1** cost 文案：補 360/540/720 階；「6 秒基準」改對齊機械 **5s** 或改 `PRICE_VIDEO_SECONDS`
- [ ] **P1** 若 bestFor 堅持有 BGM → input 加 `generate_audio_switch: true` + 重校 points（或改文案為「可選音訊、預設關」）
- [ ] **P2** SEED／NEGATIVE allowlist 可選收錄（schema 有）
- [ ] **P3** 暴露 style／thinking_type 作進階
- [ ] 開長秒／1080p 前必須動態估點
- [ ] L4 live 控費單次

| 級 | 項 |
|----|-----|
| — | aspect **無需** P0 修 |
| P1 | 音訊敘事 vs 預設關；cost 6s 文案 vs ×5；720p 預設 vs 1080p 估點錨 |
| P2 | seed／negative allowlist |

## 9. 來源

1. OpenAPI 2026-08-05：`fal-ai/pixverse/v6/text-to-video` 全表  
2. fal 公開定價：720p／1080p 含／無音每秒價（模型頁摘要）  
3. `shared/models.ts`；`docs/點數校準報告.md` 13.9 ≈  
4. 姊妹 `#121` v5.5；`docs/fal生態研究.md` PixVerse V6  

---

**R3 checklist（#122）**

- [x] L0  
- [x] OpenAPI 200（endpoint 確認）  
- [x] 點數 vs $/秒（720p 預設 vs 1080p 錨）  
- [x] aspect 1:1 **合法**  
- [x] 卡 + `_index` + lock  
- [x] 零 live／未改 verified／points  
