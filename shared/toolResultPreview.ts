/**
 * 工具結果的視覺預覽（Tool Result Preview）。
 *
 * 為什麼需要這個型別：助手的唯讀查詢工具原本只回 `{ step, text }`——`text` 是給 LLM 看的
 * 純文字摘要。但產生那段文字的過程中，手上其實有完整的資料列（asset row 帶 id 與 kind、
 * scene row 帶 assetId、generation row 帶 resultUrl），全部在折成字串時被丟掉。
 * 結果是使用者只看得到「查了素材庫(12 筆)」這行字，看不到那 12 筆到底是什麼。
 *
 * 這裡把那些資料留一條結構化的出口，讓 UI 能把「工具做完之後實際看到什麼」畫出來。
 *
 * ## 兩條鐵則
 *
 * **1. 媒體一律只存 assetId，永遠不存網址。**
 *    services/aiTrace.ts 的 sanitizeUrl 會把帶簽章 query 的網址整段清空（`url.search = ""`），
 *    而該行為被 aiTrace.test.ts 逐字鎖住、不可改。所以簽章網址存進 trace 會當場失效；
 *    更何況 trace 承諾「永久隨專案保存」，而簽章 TTL 只有一小時、金鑰還會隨重啟漂移。
 *    前端自己用 assetId 組 `/api/assets/{id}/file`：同源、帶 cookie，授權由既有的組隔離把關
 *    （server/index.ts 對無簽章請求走 resolveSession + groups 檢查），而且該路由在素材尚未
 *    落地時會自動 302 轉外部網址——一條相對路徑同時涵蓋已落地與未落地，payload 裡完全
 *    不出現任何 URL，與 sanitize 零交互。
 *
 * **2. preview 與 text 必須來自同一次迭代。**
 *    助手的系統提示明訂「只能引用 list_assets 結果裡實際列出的名稱」。若 preview 多出、
 *    少掉或重排了 text 沒有的項目，就會出現「AI 說找不到、畫面卻顯示縮圖」這種自相矛盾。
 *    所以組 preview 的迴圈必須就是組 text 的那個迴圈，不可分開查兩次。
 */

/** 素材的媒體大類（對齊 assets.kind 的實際取值） */
export type PreviewMediaKind = "image" | "video" | "audio" | "doc";

/**
 * 預覽用的媒體參照。
 *
 * `source: "asset"` 是唯一可以寫進 trace payload 的形態——理由見檔頭鐵則 1。
 * 沒有素材時要明說是「還沒生成」還是「找不到」，因為對使用者的意義完全不同：
 * 前者是待辦，後者是壞掉。
 */
export type PreviewMedia =
  | { source: "asset"; assetId: string; mediaKind: PreviewMediaKind }
  | { source: "none"; reason: "not_generated" | "missing" };

/** 素材庫的一格 */
export interface AssetTilePreview {
  assetId: string;
  title: string;
  mediaKind: PreviewMediaKind;
  /** AI 生成（true）或人工上傳（false）——與 text 裡的「AI生成／上傳」同源 */
  aiGenerated: boolean;
  /** 鎖定素材：交付時原封保留、不可更動 */
  locked: boolean;
}

/** 一鏡的完整內容 */
export interface ScenePreview {
  sceneNo: number;
  title: string;
  durationSec: number;
  /** 建議提示詞；未填為 null（不要用空字串，UI 要能區分「填了空的」與「沒填」） */
  prompt: string | null;
  voiceover: string | null;
  /** 這一鏡的主畫面 */
  visual: PreviewMedia;
  /** 這一鏡的旁白音檔 */
  narration: PreviewMedia;
}

/** 一筆生成紀錄 */
export interface GenerationTilePreview {
  modelLabel: string;
  /** 原始狀態鍵，供 UI 決定 Pill 顏色（中文標籤另給，不要讓 UI 反查中文） */
  status: string;
  statusLabel: string;
  points: number;
  prompt: string;
  /** 成品；仍在跑或失敗時為 source:"none" */
  media: PreviewMedia;
}

/** 資料庫的一列（已按該資料表的欄位定義攤平成標籤／值） */
export interface DataRowPreview {
  cells: Array<{ label: string; value: string }>;
}

/** 模型目錄的一列 */
export interface ModelRowPreview {
  id: string;
  label: string;
  tierLabel: string;
  points: number;
  /** 已驗證可正式使用（false＝待驗證） */
  ready: boolean;
  /** 需要來源素材時的提示；不需要為 null */
  needsSource: string | null;
  bestFor: string;
}

/**
 * 工具結果預覽的判別聯集。
 *
 * `kind: "text"` 是**降級出口**，不是萬用袋：工具沒有可視覺化的結果（查無資料、參數錯誤、
 * 或這個工具本來就只回文字）時用它，UI 就照舊顯示那段文字。有了它，新增工具不必先實作
 * 預覽也能接上這條管線。
 */
export type ToolResultPreview =
  /** `truncated`＝這次撈到工具的硬上限，後面可能還有。刻意不給「總共幾筆」——
   *  那需要一次額外的 count 查詢，而「還有更多」已經足夠讓使用者知道要去素材庫看全部。 */
  | { kind: "assets"; items: AssetTilePreview[]; truncated: boolean }
  | { kind: "scene"; scene: ScenePreview }
  | { kind: "generations"; items: GenerationTilePreview[]; truncated: boolean }
  /** 資料庫例外有 total：rowCount 本來就在手上（工具的文字輸出也用了它），不必多查。 */
  | { kind: "rows"; tableName: string; rows: DataRowPreview[]; total: number }
  | { kind: "models"; items: ModelRowPreview[] }
  | { kind: "text"; text: string };

/**
 * 素材檔案的前端網址。
 *
 * 刻意是純函式而不是元件內組字串：`?variant=thumb` 的規則（只有圖片該用縮圖）容易寫錯，
 * 集中在這裡才不會有人在某個角落把 200MB 的影片當縮圖載進來。
 *
 * 影音沒有縮圖：伺服器端沒有首幀擷取，`meta.thumbPath` 只針對 image 補產，
 * 對影片加 variant=thumb 只會回原檔——在手機上就是白吃頻寬。
 */
export function assetFileUrl(
  assetId: string,
  options?: { thumb?: boolean; mediaKind?: PreviewMediaKind },
): string {
  const base = `/api/assets/${assetId}/file`;
  const wantThumb = options?.thumb && options.mediaKind === "image";
  return wantThumb ? `${base}?variant=thumb` : base;
}

/** 工具名 → 給人看的中文名。取代原本散在 assistant.ts 的 LOOKUP_LABEL。 */
export const TOOL_LABEL: Record<string, string> = {
  list_assets: "素材庫",
  read_scene: "分鏡內容",
  list_generations: "生成紀錄",
  find_model: "模型目錄",
  query_database: "資料庫",
};

/** 找不到對照時回工具原名，而不是「資料」——原名至少可查、可回報。 */
export function toolLabel(tool: string): string {
  return TOOL_LABEL[tool] ?? tool;
}
