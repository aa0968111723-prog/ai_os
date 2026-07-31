/**
 * MCP 工具目錄（單一真相來源）：
 * 後端 services/mcp.ts 的 readOnly 守衛用這裡的 access 分類判斷「哪些是寫入類工具」，
 * 前端 MCP 專區頁用同一份清單顯示「可用工具一覽」——兩邊絕不分岔。
 * 純資料、零相依，放 shared 讓前後端與單元測試共用。
 */

export type McpToolAccess = "read" | "write";

export interface McpToolInfo {
  name: string;
  /** 給人看的中文短名 */
  title: string;
  /** read＝唯讀（唯讀金鑰可用）；write＝會寫入／扣點（唯讀金鑰擋下） */
  access: McpToolAccess;
  /** 一句話說明（專區頁顯示） */
  blurb: string;
  /** annotations 補充：破壞性寫入（停止／放棄／刪除類）。省略＝false */
  destructive?: boolean;
  /** annotations 補充：同輸入重呼叫不產生額外效果（冪等鍵／整列覆寫）。省略＝寫入 false、讀取 true */
  idempotent?: boolean;
  /** annotations 補充：會觸及外部網路（LLM 供應商／Google／fal）。省略＝false */
  openWorld?: boolean;
}

/**
 * MCP 工具 annotations（對齊 MCP 2025 規格的 tool annotations）。
 * 協議層預設偏保守（destructiveHint/openWorldHint 未給時視為 true），
 * 因此四個 hint 一律「顯式」輸出，讓外部客戶端拿到正確的行為提示。
 * 只是提示、不是安全機制——唯讀金鑰守衛仍以 access 分類為準。
 */
export interface McpToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** 由目錄推導工具 annotations（單一真相：與 access 分類同源，絕不分岔）。未知工具回 null。 */
export function mcpToolAnnotations(name: string): McpToolAnnotations | null {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  return {
    title: tool.title,
    readOnlyHint: tool.access === "read",
    destructiveHint: tool.destructive ?? false,
    idempotentHint: tool.idempotent ?? tool.access === "read",
    openWorldHint: tool.openWorld ?? false,
  };
}

export const MCP_TOOLS: McpToolInfo[] = [
  { name: "whoami", title: "確認身分", access: "read", blurb: "回你的名稱、所屬組別、以及這把金鑰是否唯讀——用來測試連線。" },
  { name: "list_projects", title: "列出專案", access: "read", blurb: "列出你有權存取的專案（標題／類型／格式／狀態）。" },
  { name: "get_project_context", title: "讀取專案脈絡", access: "read", blurb: "讀專案的世界觀與分鏡進度——生成前先讀這個。" },
  { name: "find_model", title: "找模型", access: "read", blurb: "依類別／等級／關鍵字挑合適的生成模型。" },
  { name: "list_generations", title: "查生成紀錄", access: "read", blurb: "列出某專案的生成紀錄與狀態（排隊／生成中／完成／失敗）。" },
  { name: "get_generation", title: "查單筆生成", access: "read", blurb: "查一筆生成的最新狀態並取回成品網址／文字（可輪詢到完成）。" },
  { name: "list_assets", title: "列出素材庫", access: "read", blurb: "列出專案成品與素材（可直接下載的網址；成品可回頭當生成來源）。" },
  { name: "request_upload_grant", title: "簽發上傳授權", access: "write", blurb: "簽發單次素材上傳授權（aidup_…）；MCP 不傳二進位，請用回傳的 token 對 /api/upload 上傳或到網頁上傳台選檔。" },
  { name: "get_upload_grant_status", title: "查上傳授權狀態", access: "read", blurb: "查詢你簽發的上傳授權是否仍有效／已用／過期（不回 token 原文）。" },
  { name: "submit_generation", title: "送出生成", access: "write", openWorld: true, blurb: "提交一次生成（世界觀自動注入、扣你的點數、走你的核准門檻）。" },
  { name: "post_message", title: "發佈留言", access: "write", blurb: "在專案留言板留言（以你的身分）。" },
  { name: "list_databases", title: "列出資料庫", access: "read", blurb: "列出你可存取的自訂資料庫（欄位、列數、AI 存取等級）；可依 projectId 標註／只看已關聯本專案的表。" },
  { name: "query_database", title: "查詢資料庫", access: "read", blurb: "查列資料：關鍵字、欄位等值、offset 分頁；長欄位自動截斷以省上下文。" },
  { name: "add_database_row", title: "新增資料列", access: "write", blurb: "在開放 AI 寫入的庫新增一列；可帶 projectId 自動填「關聯專案」欄。" },
  { name: "add_database_rows", title: "批次新增資料列", access: "write", idempotent: true, blurb: "以必填 idempotencyKey 在 24 小時內安全重試，一次新增 1–500 列而不重複寫入。" },
  { name: "update_database_row", title: "更新資料列", access: "write", idempotent: true, blurb: "更新一列（整列覆寫）；可帶 projectId 補齊關聯專案欄。" },
  { name: "list_database_files", title: "列出資料庫文件", access: "read", blurb: "列出文件（名稱／分類／AI 描述／可讀字數）；關鍵字回片段，不回全文與來源網址。" },
  { name: "read_database_file", title: "讀取資料庫文件", access: "read", blurb: "讀文件抽出的純文字（PDF/DOCX/HTML…）；圖影回 AI 描述＋短效下載網址。" },
  { name: "get_database_stats", title: "資料庫資訊量", access: "read", blurb: "一個資料庫的資訊量統計：列數、文件數、圖影音文分佈、容量、AI 可讀字數、分類分佈。" },
  { name: "get_project_status", title: "專案全貌", access: "read", blurb: "一次取回分鏡、生成、AI 代理、排程、待辦——規劃前先讀這個。" },
  { name: "plan_agent", title: "規劃 AI 代理", access: "write", openWorld: true, blurb: "請 AI 代理針對目標排一份多步製作計畫（只規劃、不執行、不扣執行點數）。" },
  { name: "approve_agent", title: "核准並執行代理", access: "write", blurb: "核准代理計畫，開始背景逐步執行（此刻起才依步驟扣點）。" },
  { name: "stop_agent", title: "停止代理", access: "write", destructive: true, blurb: "停止執行中的代理，後續步驟不再執行。" },
  { name: "discard_agent", title: "放棄代理計畫", access: "write", destructive: true, blurb: "放棄尚未核准的代理計畫（不扣點）。" },
  { name: "list_agent_runs", title: "列出代理", access: "read", blurb: "列出專案的代理計畫與執行狀態。" },
  { name: "get_agent_run", title: "查代理進度", access: "read", blurb: "查一份代理計畫的每一步與執行進度。" },
  { name: "list_agent_events", title: "查代理軌跡", access: "read", blurb: "查可稽核的代理來源、動作、等待、裁決與成果事件。" },
  { name: "get_agent_insights", title: "查代理健康", access: "read", blurb: "查專案阻塞、統一任務、風險與成果中心。" },
  { name: "list_schedule", title: "列出行程", access: "read", blurb: "列出專案相關的行程與交付死線。" },
  { name: "add_schedule_item", title: "新增行程", access: "write", blurb: "為專案新增行程／交付死線（進組行事曆）。" },
  { name: "update_schedule_item", title: "更新行程", access: "write", idempotent: true, blurb: "更新一筆既有行程（標題／時間／備註）；只有建立者本人或組長以上可改。" },
  { name: "list_notes", title: "列出筆記", access: "read", blurb: "列出專案相關的會議筆記／知識筆記（本專案 ＋ 組層級共用）。" },
  { name: "get_note", title: "讀取筆記", access: "read", blurb: "讀一則筆記的全文（會議決議、待辦、匯入的知識）。" },
  { name: "add_note", title: "新增筆記", access: "write", blurb: "為專案新增一則筆記（會議紀錄／整理／交接；與網頁筆記同一套權限）。" },
  { name: "append_note", title: "追加筆記", access: "write", blurb: "在既有筆記末尾追加內容（保留版本快照）；只有作者本人或組長以上可改。" },
  { name: "list_dm_contacts", title: "列出私訊對象", access: "read", blurb: "列出你可以私訊的夥伴（同組夥伴＋開發者）：姓名、Email、共同組別。" },
  { name: "list_dm_threads", title: "列出私訊對話", access: "read", blurb: "列出你的私訊對話串（每位對象的最後一句與未讀數）。" },
  { name: "read_dm", title: "讀取私訊", access: "read", blurb: "讀你與某位夥伴的私訊往來（只讀得到自己參與的對話）。" },
  { name: "send_dm", title: "發送私訊", access: "write", blurb: "以你的身分私訊一位同組夥伴或開發者（對方在網站「私訊」頁看到）。" },
];

/** 寫入類工具名集合（唯讀金鑰一律擋）——由目錄推導，單一來源不分岔。 */
export const MCP_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(
  MCP_TOOLS.filter((t) => t.access === "write").map((t) => t.name),
);

/** 工具是否為寫入類（會寫入／扣點）。未知工具名視為寫入（保守：唯讀金鑰對未知工具一律擋）。 */
export function isMcpWriteTool(name: string): boolean {
  const info = MCP_TOOLS.find((t) => t.name === name);
  return info ? info.access === "write" : true;
}
