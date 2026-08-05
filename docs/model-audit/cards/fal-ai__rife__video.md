# fal-ai/rife/video

> 審計：R4 · index **#160** · static+research · **零 live** · 2026-08-05  
> slug：`fal-ai__rife__video`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id / endpoint | `fal-ai/rife/video`（`endpointOf` = id，無 alias） |
| label | RIFE 補幀(流暢化) |
| category | `video-to-video`（影片轉影片） |
| tier | **budget**（最低成本） |
| kind | `video` |
| points | **2** |
| cost | `$0.0013/運算秒(極低);點數為 6 秒基準` |
| verified | **true**（目錄已標；本回合未 live 複驗） |
| recommended | **true** |
| needs | **video**（必填來源：影片網址） |
| sourceHint | 要補幀的影片網址 |
| strengths | 開源即時補幀讓影片更順(24→48/60fps),也可做慢動作 |
| bestFor | AI 生成影片的卡頓修飾、老影片流暢感重建 |
| 歷史 | 取代查無官方佐證的 `fal-ai/amt-interpolation`（LEGACY 仍保留相容） |

**一句話**：站內 **最低成本補幀** 主力；fal 上為 active 的 RIFE video interpolation，按 **運算秒** 計費極低，固定扣 **2 點**（文案基準 6 秒片）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（站內扣點） | **2** |
| cost 字串 | `$0.0013/運算秒(極低);點數為 6 秒基準` |
| 官方價與單位 | **$0.0013 / compute second**（fal 模型頁明文；image 端點 `fal-ai/rife` 同單價） |
| 計費性質 | **GPU 運算秒**，非影音時長秒；與解析度／幀數／`num_frames` 倍率相關 |
| 估值 NT$（假設） | 見下表；`parseRealCost` → **需人工**（單位「/運算秒」無固定倍率） |
| 校準判定 | **需人工**（點數校準報告同列）；短片 **≈偏貴緩衝**、長片 **可能偏低** |

### 2.1 粗估（匯率 US$1 = NT$31，僅示意）

| 假設運算秒 | USD | 約 NT$ | vs 2 點 |
|-----------|-----|--------|---------|
| 1s | 0.0013 | 0.04 | 2 點遠高於成本 |
| 6s | 0.0078 | 0.24 | 仍遠低於 2 點 |
| 30s | 0.039 | 1.21 | 接近 1～2 點 |
| 60s | 0.078 | 2.42 | **略超** 2 點 |
| 120s | 0.156 | 4.84 | 明顯 **偏低扣點** |

**解讀**：6 秒基準短片，2 點有充足緩衝；**長片／高解析／多次插幀（num_frames>1）** 時固定 2 點可能低於真實 fal 帳單。cost 已聲明「6 秒基準」——產品誠實度 OK，但 UI 宜對長片再提示。

**不改 points**（本回合禁止改 verified／points）：建議維持 2，長片另案考慮時長係數或分段。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — 唯一 id、category∈CATEGORIES、必填欄齊、`input` 可呼叫、`endpointOf`=`fal-ai/rife/video` |
| OpenAPI（static） | **200** · `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/rife/video` · openapi **3.0.4** |
| 平台 metadata | **200** · `api.fal.ai/v1/models` · status **active** · display_name `RIFE` · tags `interpolation` · license commercial · updated 2026-04-21 |
| dry-run probe | `verify-models.ts --probe` → **拒探**：「需要來源輸入(影片)…請在站內以素材實測」（符合 needs 鐵律） |
| L1 空 `{}` probe --yes | **本回合未跑**（零 live；禁 --yes） |
| live probe L2 | **未跑**（needs=video；須站內素材） |
| 結論 | **ready-static-only**（文件+OpenAPI+目錄契約完備；生成需有片源 live） |

---

## 4. 底層邏輯

### 4.1 演算法家族

- **RIFE** = *Real-Time Intermediate Flow Estimation*：以光流／中間幀估計做 **影片插幀**（frame interpolation），非生成式重繪、非超分主幹。
- 典型用途：24→48／60fps 流暢化、慢動作（時基不變插更多中間幀）、AI 生成片「卡頓／掉幀」後處理。
- fal about：「Interpolate between frames of a video using the RIFE model.」
- 與 **Topaz upscale** 不同：RIFE 主打 **時間軸密度**，Topaz 主打 **空間解析度**（可兼倍幀）；站內 playbook 將二者並列於「珍貴歷史開示影帶修復」。

### 4.2 站內 input 組裝

```ts
// shared/models.ts
input: (_p, _f, s) => ({ video_url: s })
```

| 行為 | 說明 |
|------|------|
| prompt / format | **忽略**（補幀不吃文案與比例） |
| 來源 | `s` → **`video_url`**（唯一必填，與 OpenAPI 一致） |
| 可選旋鈕 | 站內 **不暴露** `num_frames`／`fps`／scene detection／loop |

### 4.3 官方 OpenAPI `RifeVideoInput` 對照

| Property | 約束 | Required | Default | 站內 | 備註 |
|----------|------|----------|---------|------|------|
| `video_url` | string | **是** | — | ✅ | 一致 |
| `num_frames` | int **1–4** | 否 | **1** | ❌ 吃預設 | 1≈鄰幀間插 1 幀（約 2×）；更高可更密 |
| `use_scene_detection` | bool | 否 | false | ❌ | true 時切場避免跨場 smear |
| `use_calculated_fps` | bool | 否 | **true** | ❌ | 輸出 fps = 輸入 fps × 倍率 |
| `fps` | int **1–60** | 否 | 8 | ❌ | 僅 `use_calculated_fps=false` 時用 |
| `loop` | bool | 否 | false | ❌ | 末幀接回首幀無縫循環 |

**Output `RifeVideoOutput`**：required `video`（`File`：url／content_type／file_name／file_size）。

**Queue**：`https://queue.fal.run` · paths `/fal-ai/rife/video`（POST）+ status／cancel／result。

### 4.4 與官方差異／風險

1. **未暴露 `num_frames`**：預設 1 通常夠用；要 4× 補幀或更慢動作需改 input 或進階 UI。  
2. **無 scene detection**：硬切鏡頭可能出現 smear 中間幀。  
3. **prompt 必填於 MCP／部分 API 路徑**：MCP `submit_generation` schema 要求 prompt，但模型 input 丟棄 prompt——使用者可填佔位字，不影響輸出。  
4. **LEGACY `fal-ai/amt-interpolation`**：仍在 MODELS（verified=false）；挑選器應導向本 id（註解已說明）。

### 4.5 分詞／文字塔

不適用（無 T5／CLIP 條件；非文生模組）。缺來源攔截見 generationCore：`model.needs && !sourceUrl && !sourceAssetId` → BAD_REQUEST。

---

## 5. 站內點數

| 項目 | 說明 |
|------|------|
| 扣點 | `reserveQuota(userId, groupId, est, …)`；`est` = 目錄 **points=2**（非 BYOK 時） |
| UI 顯示 | 模型卡／生成估點應顯示 **2**（與 MODELS 同源） |
| 成功 | `pointsActual` 對齊估點；BYOK 使用者金鑰路徑可為 0 點（平台成本在使用者 key） |
| 失敗／取消 | generationCore 終態 failed 與退點同交易（`pointsRefunded`）；腳本亦提示「生成失敗會自動退點」 |
| 與官方 | 官方按 **運算秒** 浮動；站內 **固定 2**（6 秒基準）— 短片有利差、長片可能倒掛 |
| 本回合 | **未改 points**；未跑真扣點 e2e |

---

## 6. 情境與可用性

| 情境 | 適配 | 原因 |
|------|------|------|
| AI 生成片卡頓修飾 | ✅ 主力 | recommended + bestFor 直接對應 |
| 老開示／歷史影帶流暢感 | ✅ | `scenarioPlaybook` `video-restore` 含本 id；搭配 Topaz 升解析 |
| 慢動作柔化珍貴瞬間 | ✅ | strengths 有述；可調高 num_frames（站內暫不可調） |
| 4K 升頻主檔 | ❌ 勿當主力 | 應用 `fal-ai/topaz/upscale/video` 或 SeedVR2 |
| 對嘴／改內容 | ❌ | 非 lipsync／edit |
| 無片源純文生 | ❌ | needs=video，缺源攔截 |

**可用性**

- 影片轉影片類別可選；`recommended: true` 在 budget 檔中突出。  
- `sourceHint` 清楚。  
- **落差**：`SCENARIO_RECIPES` 的 `sc-video-restore` pickIds 僅 Topaz／SeedVR，**未列入 RIFE**（playbook 有、決策層情境卡缺）— 建議後續把 `fal-ai/rife/video` 加進 pickIds 或 why 文案（非本回合改碼）。

---

## 7. MCP / 文件

| 項目 | 結果 |
|------|------|
| MCP `find_model` | 目錄同源 MODELS；keyword「補幀／RIFE／流暢」可命中 |
| MCP `submit_generation` | 可調；**必須** `source_url`（影片）；與網頁同 `executeGenerationCommand`（扣點／ACL／退點一致） |
| MCP 火力 | 同站內 input（僅 `video_url`）；無進階 num_frames |
| 文件 playground | https://fal.ai/models/fal-ai/rife/video |
| API 文件 | https://fal.ai/models/fal-ai/rife/video/api |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/rife/video |
| 本回合 HTTP | OpenAPI **200**；playground HTML 曾 **connection reset／429**（反爬／限流），不影響 schema 有效性 |

---

## 8. 建議動作

- [x] **維持** — id／endpoint／category／needs／input(`video_url`) 與官方一致；recommended 合理；2 點短片可接受  
- [ ] 調 points — **暫不**；長片倒掛另案（時長係數或 UI 警示），禁止本回合改 points  
- [ ] 修 input/id — 可選 P2：暴露 `num_frames`（1–4）、`use_scene_detection`  
- [ ] verified true — **已是 true**；live 素材實測後可人工再確認，**勿腳本自動改**  
- [ ] 下架或隱藏 — **否**；LEGACY amt-interpolation 保持相容即可  
- [ ] 產品文案 — 建議 `sc-video-restore` 納入 RIFE；長片成本提示  

**總建議標籤（寫入 _index）：** `維持`（ready-static-only；長片計價留意）

---

## 9. 來源

1. `shared/models.ts` — `fal-ai/rife/video` 條目（~1531–1538）、LEGACY amt-interpolation、`endpointOf`  
2. `docs/model-audit/models-index.json` — index **160**  
3. `docs/fal生態研究.md` — RIFE 已查證、$0.0013/計算秒、取代 amt-interpolation  
4. `docs/點數校準報告.md` — RIFE 列「需人工」  
5. `docs/模型目錄.md` / `shared/scenarioPlaybook.ts` — video-restore 配方  
6. fal OpenAPI（本回合 curl **200**）— `RifeVideoInput` / `RifeVideoOutput`  
7. fal 模型頁摘要 — “Your request will cost **$0.0013** per compute second.”  
8. `api.fal.ai/v1/models` metadata — status active、display_name RIFE  
9. `scripts/verify-models.ts --probe`（無 --yes）— needs 拒探  
10. `server/services/generationCore.ts` / `mcp.ts` — 扣點、needs 攔截、MCP submit  

**未做**：FAL_KEY live 生成、空輸入 L1 --yes、站內真扣點 e2e、改 `verified`／`points`。
