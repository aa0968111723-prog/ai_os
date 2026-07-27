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
}

export const MCP_TOOLS: McpToolInfo[] = [
  { name: "whoami", title: "確認身分", access: "read", blurb: "回你的名稱、所屬組別、以及這把金鑰是否唯讀——用來測試連線。" },
  { name: "list_projects", title: "列出專案", access: "read", blurb: "列出你有權存取的專案（標題／類型／格式／狀態）。" },
  { name: "get_project_context", title: "讀取專案脈絡", access: "read", blurb: "讀專案的世界觀與分鏡進度——生成前先讀這個。" },
  { name: "find_model", title: "找模型", access: "read", blurb: "依類別／等級／關鍵字挑合適的生成模型。" },
  { name: "list_generations", title: "查生成紀錄", access: "read", blurb: "列出某專案的生成紀錄與狀態（排隊／生成中／完成／失敗）。" },
  { name: "get_generation", title: "查單筆生成", access: "read", blurb: "查一筆生成的最新狀態並取回成品網址／文字（可輪詢到完成）。" },
  { name: "list_assets", title: "列出素材庫", access: "read", blurb: "列出專案成品與素材（可直接下載的網址；成品可回頭當生成來源）。" },
  { name: "submit_generation", title: "送出生成", access: "write", blurb: "提交一次生成（世界觀自動注入、扣你的點數、走你的核准門檻）。" },
  { name: "post_message", title: "發佈留言", access: "write", blurb: "在專案留言板留言（以你的身分）。" },
  { name: "list_databases", title: "列出資料庫", access: "read", blurb: "列出你可存取的自訂資料庫（含欄位定義與列數）。" },
  { name: "query_database", title: "查詢資料庫", access: "read", blurb: "查自訂資料庫的列資料（關鍵字粗篩）。" },
  { name: "add_database_row", title: "新增資料列", access: "write", blurb: "在開放 AI 寫入的自訂資料庫新增一列。" },
  { name: "add_database_rows", title: "批次新增資料列", access: "write", blurb: "以必填 idempotencyKey 在 24 小時內安全重試，一次新增 1–500 列而不重複寫入。" },
  { name: "list_database_files", title: "列出資料庫文件", access: "read", blurb: "列出資料庫掛的文件（上傳／匯入，含圖影）：分類、AI 描述、可讀字數；關鍵字過濾內文。" },
  { name: "read_database_file", title: "讀取資料庫文件", access: "read", blurb: "讀文件抽出的純文字（PDF/DOCX/HTML…）；圖影回 AI 描述＋短效下載網址。" },
  { name: "get_database_stats", title: "資料庫資訊量", access: "read", blurb: "一個資料庫的資訊量統計：列數、文件數、圖影音文分佈、容量、AI 可讀字數、分類分佈。" },
  { name: "get_project_status", title: "專案全貌", access: "read", blurb: "一次取回分鏡、生成、AI 代理、排程、待辦——規劃前先讀這個。" },
  { name: "plan_agent", title: "規劃 AI 代理", access: "write", blurb: "請 AI 代理針對目標排一份多步製作計畫（只規劃、不執行、不扣執行點數）。" },
  { name: "approve_agent", title: "核准並執行代理", access: "write", blurb: "核准代理計畫，開始背景逐步執行（此刻起才依步驟扣點）。" },
  { name: "stop_agent", title: "停止代理", access: "write", blurb: "停止執行中的代理，後續步驟不再執行。" },
  { name: "discard_agent", title: "放棄代理計畫", access: "write", blurb: "放棄尚未核准的代理計畫（不扣點）。" },
  { name: "list_agent_runs", title: "列出代理", access: "read", blurb: "列出專案的代理計畫與執行狀態。" },
  { name: "get_agent_run", title: "查代理進度", access: "read", blurb: "查一份代理計畫的每一步與執行進度。" },
  { name: "list_schedule", title: "列出行程", access: "read", blurb: "列出專案相關的行程與交付死線。" },
  { name: "add_schedule_item", title: "新增行程", access: "write", blurb: "為專案新增行程／交付死線（進組行事曆）。" },
  { name: "list_notes", title: "列出筆記", access: "read", blurb: "列出專案相關的會議筆記／知識筆記（本專案 ＋ 組層級共用）。" },
  { name: "get_note", title: "讀取筆記", access: "read", blurb: "讀一則筆記的全文（會議決議、待辦、匯入的知識）。" },
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
