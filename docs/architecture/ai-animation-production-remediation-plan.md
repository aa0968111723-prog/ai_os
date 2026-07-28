# Aios AI 動畫製作技術債治理專章

> 狀態：Proposed
>
> 上位計畫：`technical-debt-remediation-plan.md`
>
> 目標：確保技術債清理不是只改善一般 SaaS 架構，而是實際支撐「劇本 → 分鏡 → 角色／風格一致性 → 圖像／影片生成 → 配音 → 粗剪 → 審核 → 剪輯交付」的 AI 動畫製作產線。

## 1. 現況判斷

Aios 已具備動畫製作的若干重要基礎：

- 專案與分鏡（scene）資料。
- 分鏡排序、鏡頭秒數、畫面提示詞與旁白文字。
- 圖像、影片、音訊生成與生成版本保留。
- 分鏡可選用既有生成版本作為現用畫面或旁白。
- 逐鏡旁白音檔。
- 粗剪預覽，可依鏡頭秒數播放畫面並同步旁白。
- 剪映草稿、字幕、EDL、FCPXML、XMEML 與專案交付包等輸出路徑。
- AI 代理、工作流、人類任務、審核、排程與成果中心。

目前主要缺口不是「完全沒有動畫功能」，而是動畫產線尚未形成一個清楚、不可繞過的領域模型。角色、風格、鏡頭、生成版本、音訊、時間軸與交付之間仍可能依賴零散欄位、畫面狀態或個別 Runner 的約定。

因此，原技術債計畫中的四個核心必須加上動畫領域語意：

1. **Policy Engine**：誰可以修改劇本、角色設定、分鏡、現用版本、旁白與交付成果。
2. **Command Layer**：所有鏡頭生成、換版、配音、匯出與批次工作都走同一條正式管線。
3. **Production State Machine**：除了專案狀態，也要有製作階段與鏡頭狀態。
4. **Worker Boundary**：圖像、影片、音訊、轉檔、匯出與品質檢查由可恢復 Worker 執行。

## 2. 目標動畫產線

```text
創作目標
  ↓
劇本／故事大綱
  ↓
角色聖經＋世界觀／風格聖經
  ↓
場次 Sequence
  ↓
鏡頭 Shot／分鏡
  ↓
鏡頭參考包 Reference Pack
  ↓
關鍵畫面生成
  ↓
圖生影片／文字生影片
  ↓
旁白／角色語音／音效／音樂
  ↓
粗剪 Timeline
  ↓
鏡頭與整片審核
  ↓
剪輯軟體交付／成片輸出
```

AI 代理的角色是規劃、拆解、呼叫工具與追蹤阻塞，不應繞過任何鏡頭版本、成本、審核或製作狀態規則。

## 3. 動畫領域的正式資料模型

### 3.1 Production

代表一支影片或動畫作品，而不是把所有內容都直接掛在一般專案欄位上。

建議欄位：

```ts
interface Production {
  id: string;
  projectId: string;
  title: string;
  format: "16:9" | "9:16" | "1:1" | "custom";
  targetDurationSec?: number;
  frameRate?: number;
  resolution?: string;
  language?: string;
  state: ProductionState;
  scriptVersionId?: string;
  characterBibleVersionId?: string;
  styleBibleVersionId?: string;
}
```

### 3.2 Sequence

代表場次或敘事段落，例如「第一幕｜克難坡的雨」。

```ts
interface Sequence {
  id: string;
  productionId: string;
  orderIndex: number;
  title: string;
  narrativePurpose?: string;
  targetDurationSec?: number;
}
```

### 3.3 Shot

現有 scene 應逐步收斂為正式 Shot 語意，不必立即改表名，可先以 adapter 相容。

```ts
interface Shot {
  id: string;
  sequenceId?: string;
  productionId: string;
  orderIndex: number;
  title: string;
  durationSec: number;
  shotType?: string;
  cameraMovement?: string;
  composition?: string;
  action?: string;
  dialogue?: string;
  narration?: string;
  visualPrompt?: string;
  negativePrompt?: string;
  state: ShotState;
  selectedVisualVersionId?: string;
  selectedNarrationVersionId?: string;
}
```

### 3.4 Character Bible 與 Style Bible

角色與風格不能只存在於每個提示詞的自由文字中。

```ts
interface CharacterBibleVersion {
  id: string;
  characterId: string;
  version: number;
  appearance: Record<string, unknown>;
  costume: Record<string, unknown>;
  personality?: string;
  voiceProfileId?: string;
  referenceAssetIds: string[];
  approvedAt?: string;
}

interface StyleBibleVersion {
  id: string;
  productionId: string;
  version: number;
  visualLanguage: Record<string, unknown>;
  colorScript?: Record<string, unknown>;
  lightingRules?: string[];
  cameraRules?: string[];
  negativeRules?: string[];
  referenceAssetIds: string[];
}
```

每次生成應保存實際使用的 Character Bible／Style Bible 版本，否則之後角色改版會讓舊鏡頭無法重現。

### 3.5 Asset Version 與 Lineage

動畫製作中「同一鏡生成很多次」是正常行為，因此不能只靠目前顯示中的 assetId 判斷版本。

```ts
interface AssetVersion {
  id: string;
  productionId: string;
  shotId?: string;
  kind: "image" | "video" | "audio" | "subtitle" | "project_file";
  role: "visual" | "narration" | "dialogue" | "music" | "sfx" | "reference" | "delivery";
  generationId?: string;
  parentAssetVersionIds: string[];
  modelId?: string;
  promptSnapshot?: Record<string, unknown>;
  characterBibleVersionIds: string[];
  styleBibleVersionId?: string;
  technicalMetadata?: Record<string, unknown>;
  status: "candidate" | "selected" | "rejected" | "superseded";
}
```

必須能回答：

- 這段影片由哪張圖生成？
- 那張圖用了哪個角色參考與風格版本？
- 哪一版被選為現用？
- 使用者為什麼換版？
- 舊版是否仍能回看與重新匯出？

### 3.6 Timeline

現有粗剪播放器是重要基礎，但它目前主要以分鏡順序與 durationSec 模擬播放。長期需要正式 Timeline Model。

```ts
interface Timeline {
  id: string;
  productionId: string;
  version: number;
  durationSec: number;
  frameRate: number;
}

interface TimelineClip {
  id: string;
  timelineId: string;
  trackType: "video" | "narration" | "dialogue" | "music" | "sfx" | "subtitle";
  assetVersionId: string;
  shotId?: string;
  startFrame: number;
  durationFrames: number;
  sourceInFrame?: number;
  sourceOutFrame?: number;
  transitionIn?: string;
  transitionOut?: string;
  volume?: number;
}
```

所有時間計算以 frame 或整數毫秒作為單一真相來源，避免浮點秒數累積誤差造成字幕、旁白與畫面逐鏡偏移。

## 4. 動畫製作狀態機

### 4.1 Production State

```ts
type ProductionState =
  | "development"
  | "preproduction"
  | "production"
  | "postproduction"
  | "review"
  | "delivered"
  | "archived";
```

建議規則：

- `development`：劇本、世界觀、角色設定。
- `preproduction`：場次、分鏡、角色／風格定稿、成本估算。
- `production`：圖像、影片、語音與素材生成。
- `postproduction`：時間軸、字幕、音效、粗剪與交付包。
- `review`：只允許審核、退回、換版與必要修正。
- `delivered`：預設唯讀，只允許建立新修訂版本。
- `archived`：只允許查詢、匯出與恢復。

### 4.2 Shot State

```ts
type ShotState =
  | "draft"
  | "planned"
  | "awaiting_reference"
  | "ready_to_generate"
  | "generating"
  | "review"
  | "approved"
  | "blocked"
  | "omitted";
```

狀態轉移必須由 Command 驗證，不可由前端直接任意改字串。

## 5. 動畫專用 Command Layer

除上位計畫的一般 Command 外，動畫製作至少需要：

- `createOrUpdateScriptCommand`
- `createSequenceCommand`
- `createShotCommand`
- `reorderShotsCommand`
- `buildShotReferencePackCommand`
- `generateShotVisualCommand`
- `generateShotMotionCommand`
- `generateShotNarrationCommand`
- `selectShotAssetVersionCommand`
- `approveShotCommand`
- `buildRoughCutCommand`
- `exportEditingPackageCommand`
- `createProductionRevisionCommand`

其中 `generateShotVisualCommand` 與 `generateShotMotionCommand` 必須固定完成：

1. 驗證 actor、production、shot 與專案歸屬。
2. 驗證 Production／Shot 狀態。
3. 解析角色、風格、場景與參考素材版本。
4. 建立不可變 prompt snapshot。
5. 選擇 provider／model adapter。
6. 計算預估成本與核准需求。
7. 建立 idempotent job。
8. 保存 lineage 與技術參數。
9. 完成後建立 candidate AssetVersion，不直接覆蓋現用版。
10. 由選版或審核 Command 將候選設為 selected。

## 6. 角色與風格一致性

這是 AI 動畫製作最大的產品與技術風險之一，需列為 P0／P1 交界項目。

### 必須具備

- 角色固定識別碼，不依賴名稱文字比對。
- 角色設定與參考圖版本化。
- 每個 Shot 明確列出出現角色及使用版本。
- 每次生成保存實際注入的 reference asset、seed、LoRA／adapter、prompt snapshot 與 model version。
- 角色換裝、年齡、情緒與時間線狀態可被明確描述。
- Style Bible 與 color script 可依 Sequence 覆寫，但必須保留來源。
- 角色或風格版本更新後，系統標示哪些已核准鏡頭可能過期，不自動覆蓋。

### 不可接受的做法

- 每次只把角色描述重新拼進自由文字 prompt。
- 更新角色參考後讓所有歷史生成悄悄改用新版。
- 用素材 URL 當穩定識別碼。
- 重新生成時遺失原模型、參數與參考素材版本。

## 7. 音訊與音畫同步

動畫不是只有畫面生成。正式產線需區分：

- Narration：旁白。
- Dialogue：角色對白。
- Music：音樂。
- SFX：音效。
- Room tone／Ambience：環境聲。

技術要求：

- 語音生成保存 voice profile、語言、速度、情緒、模型與文字版本。
- 對白與角色綁定，不能只掛在 Shot 的單一 voiceover 欄位。
- 旁白更新後，舊音檔不刪除，而是成為 superseded 版本。
- Timeline 使用 frame／整數毫秒計算。
- 音檔長度超過鏡頭時不得靜默截斷，需產生阻塞或明確策略。
- 音檔長度短於鏡頭時，需記錄留白、延伸、停頓或畫面重定時策略。
- 字幕來源需與對白／旁白文字版本綁定，避免改稿後字幕仍是舊版。

## 8. 粗剪、剪輯與交付

現有粗剪預覽與多種剪輯格式輸出應保留，但需逐步收斂到同一 Timeline Snapshot。

### 原則

- 預覽、字幕、EDL、FCPXML、XMEML、剪映草稿與專案 ZIP 必須從同一份 timeline version 匯出。
- 每次匯出保存 production revision、timeline version、selected asset versions 與 export preset。
- 重試相同 export job 必須 idempotent，不可產生不一致的重複交付物。
- 素材遺失、格式不支援、時長不一致時，不得產出「看似成功但內容缺失」的交付包。
- Delivered 狀態後的修改必須建立 revision，不直接改寫已交付版本。

## 9. 動畫品質檢查（QC）

系統應提供可自動化與人工確認的 QC：

### 自動檢查

- 所有核准 Shot 是否都有 selected visual。
- 有旁白／對白的 Shot 是否都有 selected audio。
- 角色參考與風格版本是否齊全。
- 影片解析度、比例、幀率與 codec 是否符合交付 preset。
- Timeline 是否有重疊、負時長、空洞或越界 clip。
- 字幕是否超出總時長。
- 音訊是否 clipping、缺檔或長度不合理。
- 素材是否仍存在且 checksum 一致。
- 交付包是否包含授權與來源資訊。

### 人工審核

- 角色外觀與服裝一致。
- 空間、時間、光線與動作連續。
- 構圖、鏡頭語言與情緒符合故事。
- 口型、對白、旁白與畫面節奏可接受。
- 禁止元素、品牌安全與內容政策符合要求。

審核結果需落成結構化 ReviewDecision，而不是只留一段留言。

## 10. Worker 與長任務治理

動畫工作通常比一般 CRUD 更昂貴、更久，也更容易遇到 provider timeout。

需要分離：

```text
generation-image.worker
generation-video.worker
generation-audio.worker
media-probe.worker
rough-cut.worker
export.worker
qc.worker
```

每個 Job 至少保存：

- idempotency key。
- provider request id。
- input snapshot hash。
- attempt count。
- heartbeat／lease。
- retry policy。
- cancel requested at。
- progress stage。
- estimated／actual cost。
- output checksum。

重試不得重複扣點或讓同一 Shot 同時出現多個「現用版本」。

## 11. 成本與儲存

AI 動畫的主要成本不只模型呼叫，還包含：

- 圖像生成次數。
- 影片秒數／解析度／幀率。
- 語音字數或秒數。
- 放大、補幀、轉碼與重新匯出。
- 素材與歷史版本儲存。
- 下載與 CDN 流量。

必須區分：

```text
estimated provider cost
reserved credits
actual provider cost
settled credits
storage bytes
transfer bytes
```

Production 與 Shot 層都應能查看預算、已花費、在途預留與重製成本。

## 12. 動畫專用技術債 PR 路線

| PR | 標題建議 | 範圍 |
|---|---|---|
| ANIM-00 | `test(animation): 建立動畫產線基線與不可變契約` | 現有分鏡、生成、旁白、粗剪、匯出回歸測試 |
| ANIM-01 | `refactor(animation-domain): 建立 Production／Sequence／Shot adapter` | 不先破壞現有 scenes API |
| ANIM-02 | `feat(continuity): 角色與風格聖經版本化` | reference lineage、過期提示 |
| ANIM-03 | `refactor(shot-generation): 鏡頭生成統一走 Command` | image/video/audio 多入口一致 |
| ANIM-04 | `feat(asset-lineage): 建立候選、現用與歷史版本鏈` | selected/candidate/superseded |
| ANIM-05 | `feat(audio-pipeline): 對白、旁白、音樂與音效軌` | voice profile、字幕來源、同步規則 |
| ANIM-06 | `refactor(timeline): 粗剪與所有交付共用 Timeline Snapshot` | frame-based timeline |
| ANIM-07 | `refactor(animation-workers): 分離影音生成、轉碼與 QC Worker` | retry、cancel、progress、lease |
| ANIM-08 | `feat(animation-review): 鏡頭與整片結構化審核` | ReviewDecision、阻塞與退回 |
| ANIM-09 | `feat(animation-cost): 動畫成本、儲存與流量帳務` | shot/production cost ledger |
| ANIM-10 | `feat(animation-agent): AI 製片代理與製作健康度` | 只透過正式 Command 執行 |

## 13. ANIM-00 必須鎖住的現況

在改資料模型前，先補以下測試：

- 分鏡順序在並發新增／移動下保持唯一且連續或可正常排序。
- 軟刪分鏡與素材不會出現在正常列表、粗剪與交付包。
- 圖像／影片版本只能設到同專案 Shot。
- 音訊生成只更新 narration／dialogue 角色，不會覆蓋主畫面。
- 換回歷史版本後，粗剪與匯出使用同一選定版本。
- 粗剪總長等於所有有效 Shot duration 的總和。
- 自動換鏡、影片提早結束、旁白自動播放與 reduced motion 行為不回歸。
- 素材 404 時預覽可降級，交付則明確失敗或產生阻塞，不靜默缺檔。
- Direct、workflow、agent、MCP 對同一鏡頭生成都遵守相同權限、成本門檻與專案狀態。
- 相同 export idempotency key 重試不產生不同內容的交付包。
- 已交付 Production 的修改會建立 revision，不直接覆蓋歷史交付。

## 14. 與上位技術債計畫的關係

動畫專章不是另一套平行架構，而是上位四個核心在動畫領域的具體化：

```text
Policy Engine
  └─ 動畫角色、鏡頭、版本、審核與交付權限

Command Layer
  └─ 鏡頭生成、選版、配音、粗剪與匯出

Project／Production State Machine
  └─ 專案生命週期＋動畫製作階段＋Shot 狀態

Worker Boundary
  └─ 圖像、影片、音訊、轉碼、粗剪、匯出與 QC
```

執行順序上，先完成上位 TD-00～TD-04 的安全與一致性地基，再以 ANIM-00 建立動畫基線。動畫資料模型不得在 Policy、Command、專案狀態與 SSRF 等 P0 仍未穩定時進行大型 migration。

## 15. 完成標準

當下列條件成立，才可視為「架構符合 AI 動畫製作」：

- 一支 Production 可追溯到劇本、角色／風格版本、所有 Shot 與最終 Timeline。
- 每個 Shot 的現用畫面與音訊都有完整版本與來源鏈。
- 任何生成入口都不能繞過權限、核准、成本、狀態與稽核。
- 角色或風格設定更新不會悄悄改變已核准鏡頭。
- 粗剪預覽與所有剪輯交付格式使用同一 Timeline Snapshot。
- 長任務可恢復、取消、重試，且不重複扣點或重複選版。
- Delivered 版本不可被直接改寫，修訂有完整 lineage。
- 動畫製作健康度能指出缺鏡、缺音、待審、角色不一致、成本超標與交付阻塞。
