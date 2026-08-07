# 工具結果視覺化預覽（Tool Result Preview）規格

> 狀態：可直接開工的實作規格
> 對應需求：「AI 代理輔助協助使用者創作和操作呼叫專案工具的能力，並且更視覺化輔助使用者」
> 澄清：「示圖是操作工具後截圖或是一些細節」

---

## 0. 這份規格在做什麼（先講清楚，避免做錯）

**要做的**：工具跑完之後，把**實際結果**直接畫出來。查素材庫 → 看到那 12 張縮圖；讀第 3 鏡 → 看到第 3 鏡的畫面與旁白；查生成紀錄 → 看到那些成品圖；查資料庫 → 看到那幾列資料。

**不要做的**：
- 不畫「工具呼叫流程圖」「Agent 狀態機圖」——使用者要的是結果，不是拓樸。
- 不做 Lightbox（見 §3.4 的理由）。
- 不引入任何新的執行期依賴（DECISIONS.md D-006：首屏 JS 206.5KB 已超 180KB 門檻、ProjectPage chunk 151KB gzip 已超 100KB 門檻）。整套只用既有 primitives + 既有 `MediaFallback` + 原生 CSS Grid。

**現況**（已查證）：`client/src/features/creation-workbench/AiTraceHistory.tsx:56-58` 把整包 payload 用 `<pre>{JSON.stringify(event.payload, null, 2)}</pre>` 印出來。資料已經在前端手上，這是**渲染問題不是資料問題**——但只對一部分工具成立，見 §1。

---

## 1. 資料流決策

### 1.1 三條既有管線的實況

```
runLookupTool()  →  { step: string, text: string }          ← 結構化 row 在這裡被折成字串丟掉
      ├─ steps.push(r.step)     → AskCoreResult.steps: string[]
      ├─ toolBlocks += r.text   → 餵回下一輪 prompt
      └─ recordAiTraceEventSafely({ payload: { tool, result: r.text } })   ← assistant.ts:716
                                     ↓ 持久化（jsonb）
                          aiTrace.get → { session, events[] }
                                     ↓
                    AiTraceHistory.tsx:56  <pre>{JSON.stringify(payload)}</pre>

即時路徑：emit(phase, text) → onEvent({phase,text}) → sse("step", e) → AssistantActivityEvent
                                                          ↑ 只有 {phase, text}，沒有任何結構化欄位
```

### 1.2 哪些預覽資料「已經在 payload 裡」（批次一，零後端改動）

| 事件 | payload 內容 | 零改動可渲染什麼 |
|---|---|---|
| `tool_call` | `{ tool, args:{kind?,sceneNo?,keyword?,category?,dbRef?} }` | ✅ 工具中文名 + 參數 chips，**完整** |
| `tool_result` | `{ tool, result: <完整工具文字> }` | ⚠️ 見下方 |
| `prepared` / `provider_request` / `provider_response` / `validation` / `completed` / `failed` / `stopped` | 各自形狀 | ✅ 摘要列 + 可收合的技術細節（沿用現有 `<pre>`） |
| 全部 | `latencyMs`、`createdAt`、`sequence`、`truncatedFields` | ✅ 目前**完全沒顯示**，加上去是純賺 |

`tool_result.result` 是純文字，但它是 `runLookupTool` 用**固定樣板**組出來的，因此可逆解析回結構化資料列：

```
list_assets      1. {title}｜{kind}｜{AI生成|上傳}[｜鎖定素材(不可更動)]      assistant.ts:330
read_scene       第 N 鏡「{title}」｜{n} 秒 / 畫面素材:{有|無}｜旁白音檔:{有|無}
                 / 建議提示詞:{...} / 旁白/配音詞:{...}                      assistant.ts:339-344
list_generations 1. {modelLabel}｜{狀態中文}｜{n} 點｜「{prompt前40字}」      assistant.ts:358
query_database   1. {欄位label}:{值}｜{欄位label}:{值}                      assistant.ts:265-276
find_model       - {id}｜{label}｜{tier}｜{n} 點｜{可正式使用|待驗證}[｜需來源素材：X]｜{bestFor}
```

**所以批次一可以做到：分鏡卡（完整）、資料列表格、模型目錄表格、生成紀錄列（文字＋狀態 Pill）。**

**但文字裡沒有 id、沒有 URL**——所以縮圖不能只靠解析。

### 1.3 批次一怎麼拿到縮圖：用戶端就地回接（client-side re-join）

前端**已經有一條合法通道**拿到完整 asset row：`trpc.projects.assets.useQuery({ projectId })`（`server/routers/projects.ts:604-622`，回 `db.select().from(assets)` 全欄位，含 `id / title / kind / url / meta.thumbPath`）。`AiTraceHistory` 手上就有 `projectId`。

**對接演算法（純函式，可單元測試）**：

- 兩邊排序一致——工具是 `orderBy(desc(createdAt)).limit(30)`，`projects.assets` 是 `orderBy(desc(createdAt), desc(id))`。
- 走**游標式前向掃描**：對解析出的第 i 列，從素材清單目前游標往後找第一個 `title === 解析標題 && kind === 解析類型` 的列，命中就把游標推到它後面。
  - 軌跡之後新增的素材位於清單**頭部**，前向掃描自然跳過。
  - 同名素材以順序消化，不會兩列共用同一張圖。
- 找不到 → `media: { source: "none", reason: "unresolved" }`，該格降級成純文字列並標「找不到對應素材（可能已改名或刪除）」。

同樣手法用於：
- **分鏡**：`trpc.scenes.listByProject` 直接回 `assetUrl` / `assetKind`（`server/routers/scenes.ts:146-147`），且 `sceneNo` 對 `orderIndex` 是**位置對應**，比標題比對可靠得多。
- **生成紀錄**：`trpc.generation.listByProject` 回 `resultUrl`；`(modelLabel, 狀態, 點數, prompt 前 40 字)` 是相當強的複合鍵。`resultUrl` 落地後是 `/api/assets/:id/file`，用 regex 取出 assetId；未落地時是 CDN 絕對網址，走 `source: "external"`。

> **這是過渡橋接，有拆除日期。** 批次二一旦讓後端在 payload 裡帶 `assetId`，`shared/assistantToolText.ts` 的 `list_assets` / `list_generations` 解析與整個回接層就刪掉。規格把它獨立成一個檔案就是為了好刪。

**解析器必須是全函式（total）**：任何一行解析不出來 → 降級成文字列，永不 throw。若一個預覽裡解析成功率 < 50%，整包降級成 `{ kind: "text" }`。這是安全閥。

### 1.4 哪些必須改後端（批次二）

| 目標 | 改哪裡 | 怎麼改 |
|---|---|---|
| 工具結果帶結構化出口 | `server/routers/assistant.ts:292-297` | `runLookupTool` 回傳型別加第三欄 `preview?: ToolResultPreview` |
| 素材縮圖（真 id） | `assistant.ts:317-333` | `rows` 已是完整 asset row（`db.select()` 無投影），直接組 `AssetTile[]`，**零額外查詢** |
| 分鏡畫面 | `assistant.ts:335-346` | 目前**完全不 join assets**，只有 `scene.assetId ? "有" : "無"`。必須加一次 `db.select({ id, kind }).from(assets).where(inArray(id, [scene.assetId, scene.narrationAssetId]))`（1 列） |
| 生成成品圖 | `assistant.ts:348-362` | `rows` 已含 `resultUrl`，用 regex 取 assetId，**零額外查詢** |
| 資料列可辨識 | `server/services/databaseRowSearch.ts:45-50` | `.select({ data })` → `.select({ id: dataRows.id, data: dataRows.data })`。⚠️ `databaseRowSearch.test.ts` 以 `.toSQL()` 鎖住 SQL 形狀，**同一個 PR 必須更新該測試的期望值** |
| 模型目錄結構化 | `assistant.ts:279-285` | 新增 `searchCatalogRows()` 與既有 `searchCatalogText()` 並列（不改後者，`text` 仍餵 LLM） |
| 寫進 trace | `assistant.ts:716` | `payload: { tool, result: r.text, preview: r.preview }` |
| 即時串流 | `assistant.ts:420, 470-471, 713-719` | `AskStreamEvent` 加選填 `preview`；`emit` 加第三參數 |
| 即時軌跡型別 | `client/src/components/AssistantTrace.tsx:10-13` | `AssistantActivityEvent` 加選填 `preview` |

`server/index.ts:1846` 的 `sse("step", e)` **不用改**——它原樣轉發 `e`。

### 1.5 素材圖片 URL 的授權：**一律相對路徑，永遠不簽章**

**結論：payload 裡只存 `assetId`，前端自己組 `/api/assets/${assetId}/file`（可選 `?variant=thumb`）。**

四個理由，任一個都足以否決簽章方案：

1. **簽章網址存進 trace 會當場失效。** `server/services/aiTrace.ts:21-31` 的 `sanitizeUrl` 只要 query 命中 `SIGNED_QUERY_KEY`（含 `sig`、`expires`、`token`、`key`、`x-amz-*`）就 `url.search = ""` **整段清空**。而 `signAssetUrl` 產的正是 `?exp=&sig=`。這個行為被 `server/services/aiTrace.test.ts:31-36` 逐字鎖住，改不得。
2. **TTL 對不上。** `signAssetUrl` 預設 3600 秒；trace 的承諾是「永久隨專案保存」（`AiTraceHistory.tsx:33` 就是這樣告訴使用者的）。簽章網址註定變成死連結。
3. **金鑰會漂。** 未設 `ASSET_SIGN_SECRET` 時每次重啟換一把（`storage.ts:846-851`），舊簽章全失效。
4. **根本不需要。** 這個 UI 只在同源前端、同一組 cookie session 下渲染。`server/index.ts:746-751` 的授權順序是「先驗簽章 → 沒簽章就 `resolveSession` + 檢查 `auth.groups` 含 `asset.groupId`」。而讀 trace 的人已經過了 `requireEditor`（組隔離 + 專案可編輯）與 `userId === 發起者` 兩道；能看到這筆 trace 的人必然能通過素材授權。

**額外好處**：`/api/assets/:id/file` 在 `storagePath` 為 null 時會 **302 轉外部 url**（`index.ts:754`）。所以 `{ source: "asset", assetId }` 同時涵蓋「已落地」與「未落地」兩種素材，**一條路徑打完**，payload 裡完全不出現任何 URL，跟 sanitize 零交互。

**`?variant=thumb` 的使用規則**（`server/index.ts:758-772` 已實作，但全 client 至今零使用——這是第一個消費端）：

- 只有 `mediaKind === "image"` 才加 `?variant=thumb`。
- `meta.thumbPath` 由背景維護作業補產（`assetMaintenance.ts:197,256`）且**只針對 image**；缺的話伺服器回原檔（可能是大圖）。這是可接受的降級，不做客戶端偵測。
- `video` / `audio` / `doc` **不渲染媒體元素**，改用 Icon 圖磚（見 §4.4）。伺服器沒有影片首幀縮圖產生器，硬塞 `<video>` 只會在手機上白吃頻寬。

**`source: "external"` 的鐵則**：
> 只有**用戶端 resolver 從即時 tRPC 回應**產生的 `PreviewMedia` 可以是 `external`。
> **伺服器永遠不得把外部 URL 寫進 trace payload**——會被 sanitize 剝掉 query 變死連結。
> 這條寫進 `shared/agentEvents.ts` 的型別註解裡。

### 1.6 一致性鐵則（別做出「LLM 說找不到、UI 卻顯示縮圖」）

`assistant.ts:653-655` 的 prompt 規定：只能引用 `list_assets` 結果裡實際列出的名稱，禁止推測或創造。

**因此：預覽只能顯示解析自 `tool_result.result` 的那幾列。** 回接層只做「這一列 → 哪個 assetId」的補完，**絕不新增列、絕不重排、絕不補上文字裡沒有的素材**。批次二的伺服器端同理：`preview.items` 與 `text` 必須來自**同一個 `rows` 變數的同一次迭代**。

---

## 2. 型別草案

### 2.1 `shared/agentEvents.ts`

```ts
/**
 * 使用者可驗證的代理事件流。藍本是 AG-UI 的事件模型，但**刻意只覆蓋現有 9 種
 * aiTrace eventType 能表達的東西**——與 shared/aiTrace.ts 的 aiTraceEventTypeSchema
 * 一對一對應，沒有任何猜測性的事件種類。
 *
 * 與 shared/aiTrace.ts 同一條安全承諾：這裡只描述資料來源、工具呼叫與完成狀態；
 * 不放模型的隱藏 chain-of-thought、原始系統提示或未遮罩的敏感資料。
 */
import type { AiOperationMode } from "./aiTrace";

/* ─────────────────── 媒體參照 ─────────────────── */

/** 素材的媒體大類（對齊 assets.kind 的實際取值） */
export type PreviewMediaKind = "image" | "video" | "audio" | "doc";

/**
 * 預覽用的媒體參照。
 *
 * ⚠️ 鐵則：`source: "asset"` 是**唯一**可以寫進 ai_trace payload 的形態。
 * 伺服器永遠不得寫入 `source: "external"`——services/aiTrace.ts 的 sanitizeUrl 會把
 * 簽名類 query 整段剝除（該行為被 aiTrace.test.ts 鎖住），存下來就是死連結。
 * `external` 只允許由用戶端 resolver 從即時 tRPC 回應產生。
 *
 * `assetId` 由前端組成同源相對路徑 `/api/assets/{assetId}/file`，靠 cookie session
 * 授權（server/index.ts:746-751），不簽章、不過期。storagePath 為 null 時伺服器
 * 會 302 轉外部網址，所以未落地素材也走同一條路徑。
 */
export type PreviewMedia =
  | { source: "asset"; assetId: string; mediaKind: PreviewMediaKind }
  | { source: "external"; url: string; mediaKind: PreviewMediaKind }
  | {
      source: "none";
      /** missing=素材已刪 / pending=尚未生成 / unsupported=無可視覺化形態 / unresolved=批次一回接不到 */
      reason: "missing" | "pending" | "unsupported" | "unresolved";
    };

/* ─────────────────── ToolResultPreview ─────────────────── */

/** 素材縮圖網格的一格 */
export interface AssetTile {
  /** React key；批次一是 `${index}:${title}`，批次二是 assetId */
  key: string;
  title: string;
  /** 原始 assets.kind 字串（image/video/audio/doc/…），用於標籤顯示 */
  assetKind: string;
  media: PreviewMedia;
  aiGenerated: boolean;
  locked: boolean;
}

/** 分鏡卡 */
export interface ScenePreviewCard {
  sceneNo: number;
  title: string;
  durationSec: number | null;
  hasVisual: boolean;
  hasNarration: boolean;
  /** 未填時為 null（不要用空字串，UI 要區分「未填」與「空」） */
  prompt: string | null;
  voiceover: string | null;
  media: PreviewMedia;
}

export type GenerationTileStatus =
  | "queued" | "running" | "done" | "failed"
  | "awaiting_approval" | "rejected" | "unknown";

/** 生成紀錄的一格 */
export interface GenerationTile {
  key: string;
  modelLabel: string;
  status: GenerationTileStatus;
  /** 中文狀態字樣（來自工具文字或伺服器 GEN_STATUS_LABEL），直接顯示不再翻譯 */
  statusLabel: string;
  points: number | null;
  /** 工具文字只有前 40 字；批次二可放完整 prompt */
  prompt: string;
  media: PreviewMedia;
}

/** 資料列表格的欄 */
export interface PreviewColumn {
  key: string;
  label: string;
  align?: "start" | "end";
}

/** 資料列表格的列。cells 依 columns 順序對齊，缺值為 null */
export interface PreviewRow {
  key: string;
  cells: Array<string | null>;
  /** file 型欄位在批次二可帶縮圖；批次一一律不帶 */
  media?: PreviewMedia;
}

/**
 * 一次工具呼叫的視覺結果。判別聯集——不要退化成 Record<string, unknown>，
 * 否則就重蹈 AiTraceHistory.tsx:56 直接 JSON.stringify 的覆轍。
 *
 * 六種形態涵蓋現有 5 個唯讀工具：
 *   list_assets      → assets
 *   read_scene       → scene（找不到該鏡 → empty）
 *   list_generations → generations
 *   query_database   → rows（無列 → empty）
 *   find_model       → rows（無命中 → empty）
 *   任何解析失敗      → text（安全閥）
 */
export type ToolResultPreview =
  | { kind: "assets"; items: AssetTile[]; total: number; note?: string }
  | { kind: "scene"; scene: ScenePreviewCard }
  | { kind: "generations"; items: GenerationTile[]; total: number; note?: string }
  | { kind: "rows"; columns: PreviewColumn[]; rows: PreviewRow[]; total: number; note?: string }
  | { kind: "text"; text: string }
  | { kind: "empty"; reason: string };

/* ─────────────────── 事件聯集 ─────────────────── */

/** 與 shared/aiTrace.ts 的 aiTraceEventTypeSchema 一對一（9 種），不多不少 */
export type AgentEventKind =
  | "run_started"      // prepared
  | "model_request"    // provider_request
  | "model_response"   // provider_response
  | "tool_call"        // tool_call
  | "tool_result"      // tool_result
  | "validation"       // validation
  | "run_finished"     // completed
  | "run_failed"       // failed
  | "run_stopped";     // stopped

export interface AgentEventBase {
  /** ai_trace_events.id；即時串流時為 `live-${seq}` */
  id: string;
  /** ai_trace_events.sequence；即時串流時為到達序 */
  seq: number;
  kind: AgentEventKind;
  /** ISO 8601。superjson 會把 tRPC 的 createdAt 還原成 Date，adapter 統一轉字串 */
  at: string | null;
  /** 伺服器寫的中文摘要（summary 欄位），一律直接顯示 */
  summary: string;
  latencyMs: number | null;
  /** payload 被截斷過（truncatedFields 非空，或 payload 有 _truncated 旗標） */
  truncated: boolean;
  /**
   * 已在伺服器消毒過的原始 payload。
   * ⚠️ 只准在稽核面板（AiTraceHistory）以 `showRaw` 顯示；
   * 即時軌跡（AssistantTrace）永遠不得渲染它——見 AssistantTrace.tsx:5-8 的承諾。
   */
  raw: unknown;
}

export interface AgentRunStartedEvent extends AgentEventBase {
  kind: "run_started";
  mode: AiOperationMode | null;
  provider: string | null;
  model: string | null;
}

export interface AgentModelRequestEvent extends AgentEventBase {
  kind: "model_request";
  endpoint: string | null;
  /** 只放字數，不把 prompt 原文抬進型別化欄位（原文仍在 raw 裡供稽核展開） */
  promptChars: number | null;
}

export interface AgentModelResponseEvent extends AgentEventBase {
  kind: "model_response";
  provider: string | null;
  model: string | null;
  textChars: number | null;
  fellBack: boolean;
}

/** 工具參數 → 一顆中文 chip */
export interface ToolArgChip { label: string; value: string }

export interface AgentToolCallEvent extends AgentEventBase {
  kind: "tool_call";
  tool: string;
  /** 中文工具名，例：「查素材庫」 */
  toolLabel: string;
  args: ToolArgChip[];
}

export interface AgentToolResultEvent extends AgentEventBase {
  kind: "tool_result";
  tool: string;
  toolLabel: string;
  /** 必填——最差也是 { kind: "text" }，永遠不會是 undefined */
  preview: ToolResultPreview;
}

export interface AgentValidationEvent extends AgentEventBase {
  kind: "validation";
  decision: "approved" | "rejected" | "passed" | "unknown";
  detail: string | null;
}

export interface AgentRunFinishedEvent extends AgentEventBase {
  kind: "run_finished";
  answerChars: number | null;
}

export interface AgentRunFailedEvent extends AgentEventBase {
  kind: "run_failed";
  error: string;
}

export interface AgentRunStoppedEvent extends AgentEventBase {
  kind: "run_stopped";
  detail: string | null;
}

export type AgentEvent =
  | AgentRunStartedEvent
  | AgentModelRequestEvent
  | AgentModelResponseEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentValidationEvent
  | AgentRunFinishedEvent
  | AgentRunFailedEvent
  | AgentRunStoppedEvent;

/* ─────────────────── 共用常數 ─────────────────── */

/** 工具 → 中文名。與 assistant.ts:452 的 LOOKUP_LABEL 語意相同但措辭完整 */
export const AGENT_TOOL_LABEL: Record<string, string> = {
  list_assets: "查素材庫",
  read_scene: "讀分鏡內容",
  list_generations: "查生成紀錄",
  find_model: "查模型目錄",
  query_database: "查資料庫",
};

/** 摺疊門檻（§4 的版面計算依據，改動請一併重算） */
export const PREVIEW_TILE_LIMIT = 8;   // 縮圖網格：手機 4 欄 × 2 列 / 桌機 8 欄 × 1 列
export const PREVIEW_ROW_LIMIT = 5;    // 資料列表格
export const PREVIEW_TEXT_LINES = 6;   // 純文字摘要
```

### 2.2 `shared/assistantToolText.ts`（批次一專用，批次二整檔刪除）

```ts
/**
 * runLookupTool 產出文字的**逆解析器**。
 *
 * ⚠️ 這是過渡橋接，有拆除日期。批次二讓 server/routers/assistant.ts 在 trace payload
 * 裡直接帶結構化 preview 之後，list_assets / list_generations / query_database /
 * find_model 的解析全部刪除；本檔整個消失。獨立成檔就是為了好刪。
 *
 * 全部函式必須是 total：任何格式不符一律回 null 或降級，**永不 throw**。
 */
import type {
  AssetTile, GenerationTile, PreviewColumn, PreviewRow,
  ScenePreviewCard, ToolResultPreview,
} from "./agentEvents";

/** 一列素材（尚未帶 media；由 resolver 補） */
export interface ParsedAssetLine {
  index: number;
  title: string;
  assetKind: string;
  aiGenerated: boolean;
  locked: boolean;
}

/** 一列生成紀錄（尚未帶 media） */
export interface ParsedGenerationLine {
  index: number;
  modelLabel: string;
  statusLabel: string;
  points: number | null;
  prompt: string;
}

/**
 * list_assets。樣板：`1. {title}｜{kind}[｜AI生成|｜上傳][｜鎖定素材(不可更動)]`
 *
 * title 本身可能含全形直線，所以**從右邊剝**：先摘掉已知的封閉尾綴
 * （「鎖定素材(不可更動)」→「AI生成」/「上傳」），下一段是 kind，其餘重新以「｜」接回即為 title。
 */
export function parseAssetLines(text: string): ParsedAssetLine[];

/**
 * read_scene。四段固定樣板，但 prompt / voiceover 是自由文字**可能含換行**，
 * 所以不可逐行切——用錨點前綴定位：
 *   `\n建議提示詞:` 與 `\n旁白/配音詞:`（後者為最後一段，其後全部即 voiceover）。
 * 「（未填）」一律還原成 null。
 * 「第 N 鏡不存在——…」回 null，由呼叫端轉成 { kind: "empty" }。
 */
export function parseSceneText(text: string): Omit<ScenePreviewCard, "media"> | null;

/**
 * list_generations。樣板：`1. {label}｜{狀態}｜{n} 點｜「{prompt}」`
 * 尾端「」括起的 prompt 先用 /｜「([\s\S]*)」$/ 剝掉，剩餘再從右剝 points、status。
 */
export function parseGenerationLines(text: string): ParsedGenerationLine[];

/**
 * query_database。樣板：`1. {label}:{值}｜{label}:{值}`（rowLine，assistant.ts:265-276）
 * - 每個「｜」段以**第一個冒號**切成 (label, value)。
 * - 欄位在 rowLine 裡會跳過空值，故 columns = 各列 label 的**聯集，依首次出現順序**。
 * - 「（空列）」→ 全 null 的一列。
 */
export function parseRowLines(text: string): { columns: PreviewColumn[]; rows: PreviewRow[] };

/**
 * find_model。樣板：`- {id}｜{label}｜{tier}｜{n} 點｜{可正式使用|待驗證}[｜需來源素材：X]｜{bestFor}`
 * 固定取頭 5 段與末 1 段，中間任意段落視為 sourceHint。
 */
export function parseModelLines(text: string): { columns: PreviewColumn[]; rows: PreviewRow[] };

/** 已知的「空結果」字樣 → empty 的中文理由；不是空結果回 null */
export function detectEmptyMessage(tool: string, text: string): string | null;
```

### 2.3 `shared/agentTraceAdapter.ts`

```ts
/**
 * persisted trace event → AgentEvent 的**純函式**。
 *
 * - 不 import React、不 import tRPC、不 import server/**（ADR 009 邊界，check:boundaries 會擋）。
 * - 對未知 eventType、壞 payload、被截斷的 payload 一律降級，**永不 throw**。
 *   （payload 超過 512KB 會被 services/aiTrace.ts:77-85 換成
 *    { _truncated, _originalSha256, preview:<被硬切的 JSON 字串> }——必須容忍這個退化形狀。）
 */
import type {
  AgentEvent, PreviewMedia, PreviewMediaKind, ToolResultPreview,
} from "./agentEvents";

/** tRPC aiTrace.get 回傳的 events[] 的結構化描述（手寫，不得用 inferRouterOutputs） */
export interface PersistedTraceEvent {
  id: string;
  sequence: number;
  eventType: string;
  summary: string;
  payload: unknown;
  latencyMs: number | null;
  createdAt: Date | string;
  truncatedFields?: string[] | null;
}

/**
 * 批次一的回接輸入：用戶端從既有 tRPC query 拿到的即時清單。
 * 全部選填——沒給就只是拿不到縮圖，其餘預覽照常。
 * 批次二 payload 自帶 assetId 之後，這個介面只剩 `external` 補完的用途。
 */
export interface TraceResolverInput {
  /** trpc.projects.assets（createdAt DESC） */
  assets?: ReadonlyArray<{ id: string; title: string; kind: string }>;
  /** trpc.scenes.listByProject（orderIndex ASC）；索引 = sceneNo - 1 */
  scenes?: ReadonlyArray<{ id: string; assetUrl?: string | null; assetKind?: string | null }>;
  /** trpc.generation.listByProject（createdAt DESC） */
  generations?: ReadonlyArray<{
    id: string; prompt: string; status: string;
    modelId?: string | null; resultUrl?: string | null;
  }>;
}

/** 主入口：整串事件一次轉換（游標式回接需要跨事件狀態，故不可逐筆呼叫後拼裝） */
export function toAgentEvents(
  events: readonly PersistedTraceEvent[],
  resolver?: TraceResolverInput,
): AgentEvent[];

/** 單筆轉換（非 tool_result 事件無跨筆狀態，測試與即時串流用） */
export function toAgentEvent(
  event: PersistedTraceEvent,
  resolver?: TraceResolverInput,
): AgentEvent;

/**
 * tool_result payload → ToolResultPreview。
 * 批次二 payload 已含 `preview` 時直接驗形回傳；否則走 assistantToolText 解析 + resolver 回接。
 * export 供單元測試直接打。
 */
export function toToolResultPreview(
  tool: string,
  payload: unknown,
  resolver?: TraceResolverInput,
  cursor?: { assets: number; generations: number },
): ToolResultPreview;

/** `/api/assets/{uuid}/file` → assetId；不是這個形狀回 null（純字串處理，無網路） */
export function assetIdFromApiUrl(url: string | null | undefined): string | null;

/** assets.kind 字串 → PreviewMediaKind；未知回 "doc" */
export function toPreviewMediaKind(kind: string | null | undefined): PreviewMediaKind;

/** 從一個可能是 /api/assets/:id/file 或外部網址的 url 組出 PreviewMedia */
export function mediaFromUrl(
  url: string | null | undefined,
  kind: string | null | undefined,
): PreviewMedia;
```

---

## 3. 元件規格

新增目錄：`client/src/features/agent-trace/`

| 檔案 | 性質 |
|---|---|
| `AgentTimeline.tsx` | 新寫（容器） |
| `ToolCallCard.tsx` | 新寫 |
| `ToolResultPreview.tsx` | 新寫（分派 + 5 個 module-private 子渲染器） |
| `assetPreviewSrc.ts` | 新寫（3 行純函式） |
| `useTracePreviewResolver.ts` | 新寫（唯一含 hook 的檔案） |
| `__tests__/*.test.tsx` | 新寫 |

### 3.0 `assetPreviewSrc.ts` — 唯一組 URL 的地方

```ts
import type { PreviewMedia } from "@shared/agentEvents";

/**
 * PreviewMedia → <img>/<video> 的 src。
 *
 * 同源相對路徑，靠 cookie session 授權（server/index.ts:746-751）——不簽章、不過期。
 * image 才加 ?variant=thumb（server/index.ts:758-772 的 360px JPEG；
 * 無 meta.thumbPath 時伺服器回原檔，這是可接受的降級）。
 */
export function assetPreviewSrc(media: PreviewMedia, size: "thumb" | "full"): string | null {
  if (media.source === "external") return media.url;
  if (media.source !== "asset") return null;
  const base = `/api/assets/${media.assetId}/file`;
  return size === "thumb" && media.mediaKind === "image" ? `${base}?variant=thumb` : base;
}
```

### 3.1 `useTracePreviewResolver.ts`

```ts
/**
 * 批次一的回接資料源。三支既有 tRPC query，全部 lazy（面板收合時不打）。
 *
 * ⚠️ check:hooks 規則：所有 hook 必須在任何 return 之前。這裡沒有任何早退。
 */
export function useTracePreviewResolver(
  projectId: string,
  enabled: boolean,
): TraceResolverInput {
  const assets = trpc.projects.assets.useQuery({ projectId, limit: 200 }, { enabled });
  const scenes = trpc.scenes.listByProject.useQuery({ projectId }, { enabled });
  const generations = trpc.generation.listByProject.useQuery({ projectId }, { enabled });
  return useMemo(() => ({
    assets: assets.data?.map((a) => ({ id: a.id, title: a.title, kind: a.kind })),
    scenes: scenes.data?.map((s) => ({ id: s.id, assetUrl: s.assetUrl, assetKind: s.assetKind })),
    generations: generations.data?.map((g) => ({
      id: g.id, prompt: g.prompt, status: g.status, modelId: g.modelId, resultUrl: g.resultUrl,
    })),
  }), [assets.data, scenes.data, generations.data]);
}
```

> `limit: 200` 是因為工具查的是 30 筆最新素材，而 `projects.assets` 預設 100；把回接視窗開大以涵蓋「軌跡之後又新增了不少素材」的情況。上限 500（`projects.ts:608`）。

### 3.2 `AgentTimeline.tsx`

```ts
export interface AgentTimelineProps {
  events: AgentEvent[];
  /**
   * 顯示每筆事件的「技術細節」原始 payload（<pre>）。
   * 預設 false —— AssistantTrace.tsx:5-8 明訂即時軌跡不得放未遮罩資料，
   * 只有稽核面板 AiTraceHistory 才傳 true。
   */
  showRaw?: boolean;
  /** 空清單時的替代內容；省略則整個元件回 null */
  empty?: ReactNode;
}
export function AgentTimeline(props: AgentTimelineProps): JSX.Element | null;
```

**重用**：`Icon`（`Wrench` / `Search` / `Check` / `TriangleAlert` / `Loader` / `Sparkles`，全在 `Icon.tsx` 的 103 個名單內，**不需要跑 `npm run icons:add`**）、`Meta`、`Pill`、`Card`。
**新寫**：`<ol>` 外殼與 CSS（`.agent-timeline`）。

**配對規則**：`tool_call` 與其後第一筆同 `tool` 的 `tool_result` 合併成一張 `ToolCallCard`（`tool_result` 不另起一列）。沒配到 `tool_result` 的 `tool_call` 渲染成「執行中」狀態的卡。

**DOM 草稿**：

```jsx
<ol className="agent-timeline">
  {/* 非工具事件 */}
  <li className="agent-timeline__item">
    <span className="agent-timeline__rail" aria-hidden="true"><Icon name="Sparkles" size={13} /></span>
    <div className="agent-timeline__body">
      <span>{event.summary}</span>
      {event.latencyMs != null && <Meta style={{ marginLeft: 6 }}>{fmtMs(event.latencyMs)}</Meta>}
      {event.truncated && <Meta style={{ marginLeft: 6 }}>（紀錄過大，已截斷）</Meta>}
      {showRaw && (
        <Card as="details" variant="quiet" style={{ marginTop: 4, padding: 0 }}>
          <summary style={{ cursor: "pointer", padding: "4px 6px", fontSize: "var(--fs-11)" }}>技術細節</summary>
          <pre className="tool-preview-raw">{JSON.stringify(event.raw, null, 2)}</pre>
        </Card>
      )}
    </div>
  </li>

  {/* 工具事件 */}
  <li className="agent-timeline__item">
    <span className="agent-timeline__rail" aria-hidden="true"><Icon name="Wrench" size={13} /></span>
    <div className="agent-timeline__body">
      <ToolCallCard call={call} result={result} showRaw={showRaw} />
    </div>
  </li>
</ol>
```

> `.agent-timeline__body { min-width: 0 }` 是必要的：grid 子項預設 `min-width: auto`，長 prompt 會把整列撐破；而 `html`/`body` 是 `overflow-x: clip`（styles.css:216, 230），撐破的部分會被**硬裁且永遠捲不到**。

### 3.3 `ToolCallCard.tsx`

```ts
export interface ToolCallCardProps {
  call: AgentToolCallEvent;
  /** 尚未回來時為 undefined → 顯示「執行中」 */
  result?: AgentToolResultEvent;
  showRaw?: boolean;
  /** 預設展開；空結果與純文字結果預設收合 */
  defaultOpen?: boolean;
}
export function ToolCallCard(props: ToolCallCardProps): JSX.Element;
```

**重用**：`Card`（`as="details"` + `variant="quiet"` → 輸出 `<details class="card card--quiet">`，正是 primitives 為可收合區設計的用法）、`Pill`、`Chip`、`Meta`、`Icon`、`ToolResultPreview`。
**新寫**：無新元件，只有排版 class。

**狀態 Pill**：無 `result` → `<Pill status="running">執行中</Pill>`；有 `result` → `<Pill status="done">完成</Pill>`。
（`tool_result` 目前沒有錯誤旗標，不要虛構 `failed` 狀態。）

**耗時**：取 `result?.latencyMs ?? call.latencyMs`；`< 1000` 顯示 `xxx ms`，否則 `x.x 秒`。null 就不渲染。

**參數 chips**：把 `call.args` 轉成中文，例：`類型：image`、`第 3 鏡`、`關鍵字：貓`、`類別：影片`、`資料庫：db1`。用不帶 `onClick` 的 `<Chip>`（渲染成 `<span class="chip">`，非互動，不需觸控下限）。

**DOM 草稿**：

```jsx
<Card as="details" variant="quiet" className="tool-call-card" open={defaultOpen}>
  <summary className="tool-call-card__head">
    <Icon name={TOOL_ICON[call.tool] ?? "Wrench"} size={14} />
    <strong>{call.toolLabel}</strong>
    <Pill status={result ? "done" : "running"}>{result ? "完成" : "執行中"}</Pill>
    {latency && <Meta>{latency}</Meta>}
    {result?.summary && <Meta className="tool-call-card__summary">{result.summary}</Meta>}
  </summary>

  {call.args.length > 0 && (
    <div className="tool-call-card__args">
      {call.args.map((a) => <Chip key={a.label}>{a.label}：{a.value}</Chip>)}
    </div>
  )}

  {result && <ToolResultPreview preview={result.preview} />}

  {showRaw && result && (
    <details style={{ marginTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: "var(--fs-11)" }}>技術細節</summary>
      <pre className="tool-preview-raw">{JSON.stringify(result.raw, null, 2)}</pre>
    </details>
  )}
</Card>
```

`TOOL_ICON`（全部已在 `IconName` 聯集裡）：
`list_assets → "Image"`、`read_scene → "Film"`、`list_generations → "Sparkles"`、`find_model → "Search"`、`query_database → "Database"`。

### 3.4 `ToolResultPreview.tsx`

```ts
export interface ToolResultPreviewProps {
  preview: ToolResultPreview;
  /** 縮圖網格 / 表格的初始顯示筆數上限；預設 PREVIEW_TILE_LIMIT / PREVIEW_ROW_LIMIT */
  limit?: number;
}
export function ToolResultPreview(props: ToolResultPreviewProps): JSX.Element;
```

**重用**：`AssetImg` / `AssetVideo` / `MissingMediaBox`（`client/src/components/MediaFallback.tsx`）、`Icon`、`Meta`、`Pill`、`Button`、`Chip`、`EmptyState`、既有 CSS class `.table-scroll`。
**新寫**：`.tool-preview-*` 排版 class 與 5 個 module-private 子渲染器。

> ⚠️ `AssetImg` **不預設** `loading` 與 `decoding`（`MediaFallback.tsx:59` 就是裸 `<img {...img} onError=…/>`）。**每一處都要自己補 `loading="lazy" decoding="async"`。**

**沒有 Lightbox（刻意的）**：`AiTraceHistory` 的容器是 `position: absolute; z-index: 20` 的浮層，`≤820` 另有 CSS 覆寫 `z-index: 48 !important`（被 `styles.mobileInteract.contract.test.ts` 鎖住）。在浮層裡再開一層 `position: fixed` 的 modal 會踩 z-index、焦點環與 `overscroll` 三重坑，而站內唯一的 lightbox 實作綁死在 `AssetLibrary` 的 local state（`AssetLibrary.tsx:123, 923-958`）無法重用。

**改用**：每格包一個 `<a href={assetPreviewSrc(media, "full")} target="_blank" rel="noreferrer">`（`GenerationList.tsx:13` 的 `GenResultImgLink` 已是同一個既有做法）。圖片 mime 不會被強制下載（`index.ts` 的 `shouldForceAttachment` 只針對 doc/pdf/txt/SVG），所以會直接在新分頁開圖。`aria-label` 給 `開啟素材「{title}」`。

**分派**：

```jsx
switch (preview.kind) {
  case "assets":      return <AssetGrid ... />;
  case "scene":       return <SceneCard ... />;
  case "generations": return <GenerationGrid ... />;
  case "rows":        return <RowTable ... />;
  case "text":        return <p className="tool-preview-text">{preview.text}</p>;
  case "empty":       return <EmptyState icon={<Icon name="Inbox" size={20} />} title="沒有結果" description={preview.reason} />;
}
```

**AssetGrid / GenerationGrid 的一格**：

```jsx
<li className="tool-preview-tile">
  <a href={full} target="_blank" rel="noreferrer" aria-label={`開啟素材「${title}」`}>
    <span className="tool-preview-tile__media">
      {src ? (
        <AssetImg
          src={src} alt=""
          loading="lazy" decoding="async"
          fallbackLabel="素材遺失" fallbackHeight="100%" fallbackIconSize={14}
        />
      ) : (
        <Icon name={KIND_ICON[mediaKind]} size={18} />   /* video→Film, audio→Music, doc→FileText */
      )}
    </span>
    <Meta as="span" className="tool-preview-tile__label" title={title}>{title}</Meta>
  </a>
</li>
```

- **只有 `mediaKind === "image"` 才渲染 `<AssetImg>`**；video/audio/doc 一律 Icon 圖磚（伺服器沒有影片首幀縮圖，硬塞 `<video preload="metadata">` 會在手機白吃頻寬）。
- `media.source === "none"` 也走 Icon 圖磚，`reason === "unresolved"` 時 `title` 屬性補「找不到對應素材（可能已改名或刪除）」。
- 超過 `limit` 時在網格後面接 `<Button size="sm" variant="ghost">還有 {n} 張 ▾</Button>`，`useState` 切換。**這個 useState 必須宣告在元件最上方**（check:hooks）。

**SceneCard**：

```jsx
<div className="tool-preview-scene">
  <div className="tool-preview-scene__media">
    {src ? <AssetImg src={src} alt="" loading="lazy" decoding="async" fallbackLabel="畫面遺失" fallbackHeight="100%" fallbackIconSize={14} />
         : <MissingMediaBox label="尚未生成畫面" height="100%" iconSize={14} />}
  </div>
  <div style={{ minWidth: 0 }}>
    <strong>第 {sceneNo} 鏡・{title}</strong>
    {durationSec != null && <Meta>{durationSec} 秒</Meta>}
    <div className="tool-call-card__args">
      <Chip>畫面：{hasVisual ? "已有" : "未有"}</Chip>
      <Chip>旁白音檔：{hasNarration ? "已有" : "未有"}</Chip>
    </div>
    {prompt && <Meta as="p" className="tool-preview-text">建議提示詞：{prompt}</Meta>}
    {voiceover && <Meta as="p" className="tool-preview-text">旁白：{voiceover}</Meta>}
  </div>
</div>
```

**RowTable**：外層必須是 `<div className="table-scroll">`（`styles.css:2037-2044`，含 `-webkit-overflow-scrolling`、負 margin 出血與 `table { min-width: 560px }`）。**不要**像 `DatabasesPage.tsx:778` 那樣寫行內 `overflowX: auto`——少了 `overscroll-behavior`。每格值以 `title` 屬性帶完整內容，視覺上單行省略。

---

## 4. 390px 手機版面

### 4.1 可用寬度的實算

```
viewport                                     390px
  .ai-trace-pop  width: min(720px, 100vw-32px)  → 358px
  − Card padding 12 × 2                         → 334px
  − ToolCallCard padding 10 × 2                 → 314px    ← 縮圖網格的實際可用寬
```

`≤560` 另有一組較小的 token（見 4.3）。設計目標鎖在 **314px**；`AssistantTrace`（即時軌跡）內較寬（約 340–350px），同一份 CSS 自然多留白，不需要第二套。

### 4.2 欄數與尺寸

CSS：`grid-template-columns: repeat(auto-fill, minmax(68px, 1fr))`、`gap: 5px`（`≤560`）。

| 可用寬 | 解 `68n + 5(n−1) ≤ W` | 欄數 | 每格實際寬 |
|---|---|---|---|
| 288px（iPhone SE 320 viewport） | `73n ≤ 293` | **3** | 92.7px |
| 314px（iPhone 12/13/14 390） | `73n ≤ 319` | **4** | 74.8px |
| 350px | `73n ≤ 355` | **4** | 83.8px |
| ~652px（桌機 720 浮層內） | `78n ≤ 658`（gap 6 / min 72） | **8** | 76.3px |

**350–390px 區間穩定 4 欄，320px 自動降 3 欄，桌機 8 欄。** 用 `auto-fill + 1fr`（不是 `auto-fit + 固定寬`）保證**永遠不會溢出容器**——這點很重要，因為 `html`/`body` 是 `overflow-x: clip`（styles.css:216, 230），一旦溢出就是**被硬裁且永遠捲不到**，不會出現捲軸救援。

**圖磚**：`aspect-ratio: 1 / 1` + `object-fit: cover` 鎖版位（照 `AblationResultGrid.tsx:84` 的既有做法，站內唯一用 aspect-ratio 防 CLS 的寫法）。手機一格 ≈ 75×75 媒體 + 約 19px 標籤列 ≈ 94px 高。

**觸控**：每格是 `<a>`，實高 94px、寬 75px，兩軸都超過 `--touch-min: 44px`。`<a>` 不在全域 44px 雙鎖的選擇器名單（`button, .btn, .menu-item`）內，但這裡有顯式尺寸，不需要掛 `.m-touch`。

### 4.3 摺疊

- **縮圖網格**：預設 `PREVIEW_TILE_LIMIT = 8`。8 格 = 手機 4 欄 × **2 列**（約 194px 高）/ 桌機 8 欄 × 1 列。`list_assets` 最多 30 筆，摺疊後省下 6 列高度。
- **資料列表格**：預設 `PREVIEW_ROW_LIMIT = 5`（`query_database` 上限 20 列）。
- **純文字**：預設 `PREVIEW_TEXT_LINES = 6`，`max-height: 220px` + `overflow: auto` + `overscroll-behavior: contain`（浮層裡的巢狀捲動區必須 contain，否則捲到底會鏈到整頁、standalone PWA 還會誤觸下拉刷新）。
- 展開鈕：`<Button size="sm" variant="ghost">還有 {n} 張 ▾</Button>`，自動吃到全域 44px。

### 4.4 CSS（加在 `client/src/styles.css` 尾端）

> 只**新增規則**，不改任何既有行——9 支 `*.contract.test.ts` 用字面比對鎖住約 30 條既有宣告，重排/格式化即紅燈。
> 樣式必須進 `styles.css` 而非行內 style，否則未來的手機契約測試守不住（`mob03LongTaskCopy.test.ts` 是讀 CSS 文字做 regex）。
> 這些 class 名（`tool-call-card`、`tool-preview-tile` …）**不是** `OWNED_CLASSES` 的 token（比對是整個 token 相等，不是子字串），棘輪不會擋。

```css
/* ===== 工具結果視覺化預覽（AI 軌跡） ===== */
.agent-timeline { display: grid; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.agent-timeline__item { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; align-items: start; }
.agent-timeline__rail { display: flex; justify-content: center; padding-top: 3px; color: var(--fg-secondary); }
/* grid 子項預設 min-width:auto；長 prompt 會撐破外框，而 html 是 overflow-x:clip（硬裁且捲不到） */
.agent-timeline__body { min-width: 0; }

.tool-call-card { padding: 8px 10px; }
.tool-call-card__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; cursor: pointer; }
.tool-call-card__summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-call-card__args { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }

.tool-preview { margin-top: 8px; min-width: 0; }

/* auto-fill + 1fr：永不溢出容器（html/body 是 overflow-x:clip，溢出＝被硬裁且捲不到） */
.tool-preview-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px; margin: 0; padding: 0; list-style: none;
}
.tool-preview-tile { min-width: 0; }
.tool-preview-tile > a {
  display: block; text-decoration: none; color: inherit; overflow: hidden;
  border: 1px solid var(--border-soft); border-radius: 8px; background: var(--card2);
}
.tool-preview-tile > a:hover { border-color: var(--border-strong); }
/* aspect-ratio 鎖版位：圖到位時不會把下方訊息推走 */
.tool-preview-tile__media {
  display: grid; place-items: center; width: 100%; aspect-ratio: 1 / 1;
  background: var(--muted); overflow: hidden;
}
.tool-preview-tile__media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tool-preview-tile__label {
  display: block; padding: 3px 5px; font-size: var(--fs-11); line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.tool-preview-scene { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 10px; align-items: start; }
.tool-preview-scene__media {
  width: 84px; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: var(--muted);
}
.tool-preview-scene__media img { width: 100%; height: 100%; object-fit: cover; display: block; }

.tool-preview-text {
  margin: 4px 0 0; max-height: 220px; overflow: auto; overscroll-behavior: contain;
  white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--fs-12); line-height: 1.5;
}
.tool-preview-raw {
  max-height: 240px; overflow: auto; overscroll-behavior: contain;
  white-space: pre-wrap; word-break: break-word;
  background: var(--card2); padding: 8px; border-radius: 8px; font-size: 12px;
}

@media (max-width: 560px) {
  .tool-preview-grid { grid-template-columns: repeat(auto-fill, minmax(68px, 1fr)); gap: 5px; }
  .tool-preview-scene { grid-template-columns: 72px minmax(0, 1fr); gap: 8px; }
  .tool-preview-scene__media { width: 72px; }
  .tool-preview-text, .tool-preview-raw { max-height: 180px; }
}
```

**不做的事**：不寫死任何 `padding-bottom`（一律 `--chrome-bottom` + `--safe-bottom`）、不新增非 `--m-` 前綴的變數、不碰 `styles.mobile-tokens.css`（該檔規則必須全部包在 `@media (max-width: 820px)` 內且只准宣告 `--m-` 變數，兩條都有測試逐字驗證）。

---

## 5. 接線點

### 5.1 `client/src/features/creation-workbench/AiTraceHistory.tsx`（批次一）

**改 53-60 行**——`detail.data?.events.map(...)` 的整段 `<details>/<pre>` 換成：

```jsx
<AgentTimeline
  events={toAgentEvents(detail.data?.events ?? [], resolver)}
  showRaw
  empty={<Meta as="p">這筆紀錄沒有事件。</Meta>}
/>
```

**加在 14-21 行的 hook 區之後**（所有 hook 都在任何 return 之前）：

```ts
const resolver = useTracePreviewResolver(projectId, Boolean(open && selectedId));
```

`showRaw` 傳 `true`：現有的 `<pre>` 全文檢視**不會消失**，只是降級成每筆事件的「技術細節」收合區。稽核能力零損失，這對一個 trace/audit UI 是硬需求。

### 5.2 `client/src/components/AssistantTrace.tsx`（批次二）

```ts
export type AssistantActivityEvent = {
  phase: "thinking" | "lookup" | "step";
  text: string;
  /** 工具實際結果的視覺預覽（批次二起由 SSE 帶入）。不含模型私密推理。 */
  preview?: ToolResultPreview;
};
```

`ActivityRows` 在 `<span>{event.text}</span>` 之後補：

```jsx
{event.preview && <ToolResultPreview preview={event.preview} limit={4} />}
```

`limit={4}` ——即時串流的氣泡比稽核浮層窄，手機一列 4 格剛好一行。

**`showRaw` 絕不在這裡開啟**：`AssistantTrace.tsx:5-8` 與 `:118` 的註腳是明示的安全不變式（不得放 chain-of-thought、原始系統提示或未遮罩資料）。`ToolResultPreview` 只渲染型別化欄位，不碰 `raw`。

**連帶**：`AssistantTrace.tsx` 與 `assistantStream.ts` 都在 `vitest.client.config.ts:25-30` 的 `coverage.include` 名單裡（門檻 lines 85 / functions 80 / branches 75 / statements 85，全體聚合）。新增的分支必須同時補測試。`assistantStream.ts:88-95` 的 `isActivityEvent` 要放行帶 `preview` 的事件（`preview` 選填，型別守衛不檢查它即可，但要加一條測試證明帶 preview 的事件不被丟棄）。

### 5.3 `client/src/components/ProjectAssistant.tsx`（批次二）

`:506-507` 的 fallback `(t.steps ?? []).map((text) => ({ phase: "step", text }))` **不用改**——`preview` 選填，缺就不渲染。

### 5.4 Server（只在批次二）

| 檔案 : 行 | 改動 |
|---|---|
| `server/routers/assistant.ts:292-297` | `runLookupTool` 回傳型別 `Promise<{ step: string; text: string; preview?: ToolResultPreview }>` |
| `assistant.ts:317-333` | `list_assets`：`rows` 已是完整 asset row，`preview = { kind:"assets", items: rows.map(...), total: rows.length }`。**與 `text` 用同一次迭代**（§1.6 一致性鐵則） |
| `assistant.ts:335-346` | `read_scene`：新增 `db.select({ id: assets.id, kind: assets.kind }).from(assets).where(inArray(assets.id, [scene.assetId, scene.narrationAssetId].filter(Boolean)))`，組 `{ kind:"scene", scene }` |
| `assistant.ts:348-362` | `list_generations`：`g.resultUrl` 經 `assetIdFromApiUrl` 取 id；取不到 → `{ source:"none", reason:"pending" }`。**不得寫入外部 URL** |
| `assistant.ts:279-285` | 新增 `searchCatalogRows(keyword?, category?): { columns, rows }`，與 `searchCatalogText` 並列。**不改 `searchCatalogText`**（它餵 LLM，改了會動到 prompt 行為） |
| `assistant.ts:300-315` | `query_database`：`matched` 現在有 `id`，`PreviewRow.key = r.id` |
| `assistant.ts:420` | `AskStreamEvent` → `{ phase; text; preview?: ToolResultPreview }` |
| `assistant.ts:470-471` | `emit` → `(phase, text, preview?) => onEvent?.({ phase, text, ...(preview ? { preview } : {}) })` |
| `assistant.ts:716` | `payload: { tool: toolCall.data.tool, result: r.text, preview: r.preview }` |
| `assistant.ts:718` | `emit("step", r.step, r.preview)` |
| `server/services/databaseRowSearch.ts:45-50` | `.select({ data })` → `.select({ id: schema.dataRows.id, data: schema.dataRows.data })`；`searchAssistantDatabaseRows` 回傳型別 `Array<{ id: string; data: unknown }>` |
| `server/services/databaseRowSearch.test.ts` | ⚠️ 該檔以 `.toSQL()` 鎖住 SQL 形狀不變式，**同 PR 更新期望值** |

**`server/index.ts:1846` 不用改**（`sse("step", e)` 原樣轉發）。

**payload 大小驗算**（對照 `services/aiTrace.ts` 的三道上限）：
- 陣列 200 元素上限：`list_assets` 30 / `list_generations` 15 / `query_database` 20 —— 全部遠低於。
- 512KB 整包上限：payload 裡只有 uuid + 短字串，30 格素材約 4KB。遠低於。
- `sanitizeUrl`：payload 裡**沒有任何 URL**（只有 `assetId`），零交互。

---

## 6. 測試計畫

### 6.1 `shared/`（跑 `npm test`，`vitest.config.ts` include `shared/**/*.test.ts`，node 環境純函式）

**`shared/assistantToolText.test.ts`**
- 五個工具各一組「正常樣板 → 正確結構」，樣板字串**逐字複製自 `assistant.ts` 的模板**（`330 / 339-344 / 358 / 265-276` 行）。
- 邊界：標題含全形「｜」仍能正確從右剝、prompt 含換行時 `read_scene` 不錯位、`（空列）`、`（未填）`→null、`（素材庫是空的）`/`（還沒有任何生成紀錄）`→ `detectEmptyMessage` 命中。
- **不變式**：任何輸入（空字串、亂碼、超長、只有換行）都不 throw；`parseAssetLines("垃圾")` 回 `[]`。

**`shared/agentTraceAdapter.test.ts`**
- 9 種 eventType 各一筆 → 對應 `AgentEventKind`；未知 eventType → 降級（不 throw）。
- **截斷 payload**：`{ _truncated: true, _originalSha256: "…", preview: "{\"a\":1,\"b" }` → `truncated === true`，不 throw，`preview` 降級成 `{ kind: "text" }`。
- **游標式回接**：構造「軌跡後新增了 2 個素材」的 assets 清單，斷言前向掃描跳過新素材、同名素材不重複配對、配不到時 `reason === "unresolved"`。
- `assetIdFromApiUrl`：`/api/assets/<uuid>/file` → uuid；`https://cdn.fal.ai/x.png` → null；`null`/`""` → null。
- **降級門檻**：10 行只有 3 行可解析 → 整包 `{ kind: "text" }`。
- **鐵則**：批次二起加一條「`toToolResultPreview` 產出的 `PreviewMedia` 絕不含 `source: "external"`（伺服器路徑）」。

### 6.2 `client/src/features/agent-trace/__tests__/`（跑 `npm run test:client:coverage`）

沿用 `features/creation-workbench/__tests__/` 的資料夾慣例（agent-trace 是同一個工作台家族）。**沒有共用 trpc mock helper**，每支自己在檔頂 `vi.mock("../../../api", () => ({ trpc: {…} }))`——照抄 `CreationWorkbench.test.tsx:15-67` 再刪不用的 router。漏 stub 任一支實際呼叫的 procedure 會在 render 當下丟 `Cannot read properties of undefined (reading 'useQuery')`，不是清楚的測試失敗。**先把用到的 tRPC path 全列出來**：`projects.assets` / `scenes.listByProject` / `generation.listByProject`。

**`ToolResultPreview.test.tsx`**（純 props，**不需要 trpc mock**）
- 六種 `kind` 各渲染一次，斷言關鍵 role/text 存在。
- `assets`：12 格 + `limit=8` → `getAllByRole("listitem")` 長度 8，且有「還有 4 張」按鈕；點下去變 12。
- **URL 斷言（本規格的核心不變式）**：image 圖磚的 `img` `src` 必須是 `/api/assets/<id>/file?variant=thumb`；`expect(src).not.toContain("sig=")` 且 `not.toContain("exp=")`。
- video/audio/doc 圖磚**不得**出現 `<img>`／`<video>`（`queryByRole("img")` 為 null，只有 aria-hidden 的 Icon）。
- `rows`：外層必須有 `.table-scroll`（`container.querySelector(".table-scroll")` 非 null）。
- **jsdom 坑**：`<img>` 的 `onError` 在 jsdom **永不自動觸發**（不載外部資源）。要覆蓋 `AssetImg` 的失敗分支必須 `fireEvent.error(screen.getByRole("img"))`，然後斷言 `getByRole("img", { name: "素材遺失" })`（`MissingMediaBox` 帶 `role="img"` + `aria-label`）。做法照 `MyReportsPage.test.tsx:94`。
- 反過來：**不要**寫任何依賴圖片真的載入完成的斷言（`naturalWidth` / `onLoad`）。

**`ToolCallCard.test.tsx`**（純 props）
- 無 `result` → `getByText("執行中")`；有 → `getByText("完成")`。
- 參數 chips 中文正確；`latencyMs: 850` → `850 ms`，`2400` → `2.4 秒`，`null` → 不出現耗時。
- `showRaw={false}` 時 `queryByText("技術細節")` 為 null（**這條測試就是 AssistantTrace 安全承諾的守門**）。

**`AgentTimeline.test.tsx`**（純 props）
- `tool_call` + `tool_result` 配成一張卡（`getAllByText("查素材庫")` 長度 1，不是 2）。
- 孤兒 `tool_call` 渲染「執行中」。
- `events: []` + 無 `empty` → `expect(container).toBeEmptyDOMElement()`（照 `AssistantTrace.test.tsx:1-36` 的樣板）。
- `showRaw` 兩種取值下 `<pre>` 的有無。

**`viewportBaseline.test.tsx`**
- 複製 `features/creation-workbench/__tests__/viewportBaseline.test.tsx:85-110` 的 `setViewportWidth`（26 行，**沒有 export，必須複製**；順手抽到 `client/src/test/viewport.ts` 也可以，不違反任何守門腳本）。
- `it.each([{width:360},{width:390},{width:1280}])` 跑 presence smoke。
- **誠實標註**：jsdom 不算版面，這只證明「元素還在 DOM」，**不證明 4 欄、不證明沒溢出**。欄數與尺寸由下一條守。

**`client/src/styles.toolPreview.contract.test.ts`**（字串契約，這才是真正守版面的）
- 照 `mob03LongTaskCopy.test.ts:12-50` 的做法：`readFileSync` 讀 `styles.css`，切出 `@media (max-width: 560px)` 各區塊（**不可用 `lastIndexOf` 賭最後一個斷點**）。
- 斷言 `≤560` 區塊內存在 `.tool-preview-grid { … grid-template-columns: repeat(auto-fill, minmax(68px, 1fr))` 與 `gap: 5px`。
- 斷言頂層存在 `.tool-preview-tile__media` 的 `aspect-ratio: 1 / 1`（防 CLS）。
- 斷言 `.agent-timeline__body` 與 `.agent-timeline__item` 含 `min-width: 0` / `minmax(0, 1fr)`（防 `overflow-x: clip` 硬裁）。
- 斷言 `.tool-preview-text` 與 `.tool-preview-raw` 含 `overscroll-behavior: contain`。

**`AiTraceHistory.test.tsx`**（需要 trpc mock：`aiTrace.listByProject`、`aiTrace.get`、外加 resolver 的三支）
- 展開面板 → 選一筆 session → 斷言不再有裸 JSON（`queryByText(/"eventType"/)` 為 null），而有 `getByText("查素材庫")`。
- 素材圖磚 `src` 為相對路徑。

### 6.3 覆蓋率決策（需要拍板）

`client/src/features/**` **完全不在** `vitest.client.config.ts:22-37` 的 `coverage.include` 白名單裡，所以 `client/src/features/agent-trace/**` 預設**不受任何門檻管**。

- **本規格的建議**：批次一**不加進 include**（現況餘裕 stmts 93.72 / branch 88.57 / func 90.9 / lines 96.29，一次塞進大量新程式碼會把聚合值拉低而紅燈）。
- **改為**：把 `shared/agentTraceAdapter.ts` 與 `shared/assistantToolText.ts` 用 `npm test`（server config）測到接近全覆蓋——**渲染邏輯的風險本來就集中在解析與對接這兩支純函式上**，元件層是薄殼。
- 批次二穩定後再評估是否把 `client/src/features/agent-trace/**` 加進 include。這是產品決策，不在本規格單方面決定。

### 6.4 CI 閘門自檢（送 PR 前逐條過）

| 閘門 | 風險點 |
|---|---|
| `check:ui-primitives` | baseline 已歸零（`totals.total = 0`、`files = {}`），**新檔案任何 `className` 字面字串**出現 `hint/btn/btn-sm/btn-ghost/btn-tonal/card/card2/chip/badge/pill/empty-state/skeleton` 即紅燈。偵測是保守超抓——`cx()` 與 template literal 內的字面字串、甚至 `cond ? "chip" : ""` 都算。全部用 `components/ui` 的 primitives，**從第一行就用，不能先寫完再遷移**。 |
| `check:hooks` | 禁止第一個 `return` 之後呼叫 hook。`ToolResultPreview` 的展開 `useState`、`useTracePreviewResolver` 的三支 `useQuery` 全部寫在最上方。 |
| `check:boundaries` | `client/**` 不得 import `server/**`。型別一律走 `@shared/agentEvents`（alias 已設在 `vitest.client.config.ts:9` 與 vite）。 |
| `typecheck` | `Icon` 的 `name` 受 `IconName` 聯集約束。用到的 `Image/Film/Database/Search/Sparkles/Wrench/FileText/TriangleAlert/Check/Loader/Music/Inbox` 請先確認在 `Icon.tsx:19-104` 的聯集內；缺的跑 `npm run icons:add <PascalName>`，**禁止手抄 SVG path**。 |
| contract tests | 只**新增** CSS 規則，不重排/格式化既有行（9 支測試以字面比對鎖住約 30 條宣告）。 |

---

## 7. 分兩批交付

### 批次一 — 零後端改動，把 `<pre>` 換成真的預覽

**目標**：打開「實際運作紀錄」→ 看到工具卡片、素材縮圖、分鏡畫面、資料表格，而不是一坨 JSON。

**檔案**

| 動作 | 檔案 |
|---|---|
| 新增 | `shared/agentEvents.ts` |
| 新增 | `shared/assistantToolText.ts` |
| 新增 | `shared/agentTraceAdapter.ts` |
| 新增 | `client/src/features/agent-trace/{AgentTimeline,ToolCallCard,ToolResultPreview}.tsx` |
| 新增 | `client/src/features/agent-trace/{assetPreviewSrc.ts,useTracePreviewResolver.ts}` |
| 新增 | `client/src/styles.css` 尾端的 `.agent-timeline` / `.tool-preview-*` 區塊 |
| 新增 | `shared/{assistantToolText,agentTraceAdapter}.test.ts`、`client/src/features/agent-trace/__tests__/*`、`client/src/styles.toolPreview.contract.test.ts` |
| **修改** | `client/src/features/creation-workbench/AiTraceHistory.tsx`（加一行 resolver hook、換掉 53-60 的 `<pre>` 區塊） |

**批次一交付後可見的**
- ✅ 素材縮圖網格（真圖，走用戶端回接）
- ✅ 分鏡卡（含畫面縮圖，位置對應最可靠）
- ✅ 生成紀錄（含成品圖）
- ✅ 資料列表格、模型目錄表格
- ✅ 每次工具呼叫的中文名、參數、狀態、耗時（`latencyMs` 目前**完全沒顯示**，純賺）
- ✅ 「紀錄過大，已截斷」的誠實標示（`truncatedFields` 目前也沒顯示）
- ✅ 原始 JSON 全文保留在「技術細節」收合區——稽核能力零損失

**批次一還做不到的（要誠實寫進 PR 描述）**
- ❌ 即時串流時看不到預覽（SSE 只有 `{phase, text}`）
- ❌ 素材改名或刪除後回接不到，該格降級為文字
- ❌ 資料庫列沒有 row id，不可點擊定位
- ❌ 影音素材只有 Icon 圖磚（伺服器沒有影片首幀縮圖）

### 批次二 — 動 server：即時串流 + 補齊缺的預覽資料

**檔案**

| 動作 | 檔案 |
|---|---|
| 修改 | `server/routers/assistant.ts`（`292-297 / 279-285 / 300-315 / 317-333 / 335-346 / 348-362 / 420 / 470-471 / 716 / 718`） |
| 修改 | `server/services/databaseRowSearch.ts:45-50` + `databaseRowSearch.test.ts`（SQL 形狀不變式） |
| 修改 | `client/src/components/AssistantTrace.tsx`（型別 + `ActivityRows` 渲染 preview） |
| 修改 | `client/src/components/assistantStream.ts`（`isActivityEvent` 放行 `preview`） |
| 修改 | `shared/agentTraceAdapter.ts`（payload 已有 `preview` 時直接驗形回傳，優先於解析） |
| **刪除** | `shared/assistantToolText.ts` 中 `list_assets` / `list_generations` / `query_database` / `find_model` 的解析（`read_scene` 若後端已帶 preview 也一併刪；整檔清空即整檔刪） |
| 修改 | 覆蓋率：`AssistantTrace.tsx` 與 `assistantStream.ts` 在 `coverage.include` 內，新分支要補測試撐住 85/80/75 |

**批次二交付後新增的**
- ✅ 即時串流當下就看到工具結果（不用等回答完再開軌跡）
- ✅ 素材 / 生成 / 分鏡的 `assetId` 由後端直給，回接層與所有解析器下線
- ✅ 資料庫列帶 row id
- ✅ 一致性鐵則在伺服器端強制成立（`preview` 與 `text` 同一次迭代產生）

**明確排除（第三批再說）**
- 模型縮圖（`modelThumbnailStore.getModelThumbnailUrl` 已存在且是免授權絕對網址，但要把該模組接進 assistant 這條路）
- 影片首幀縮圖（需要伺服器端產生 poster）
- MCP 那 33 個唯讀工具的預覽（`mcp.ts:657-666` 明說站內助手拿不到，且共用必須從帶 `scopeDeniedReason` 守衛與 `recordMcpAudit` 審計的 `callTool` 進來，不能走 `runTool` 旁路）
- `MediaLightbox`（§3.4 已說明為何不做）
