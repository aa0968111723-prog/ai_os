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
  { name: "list_projects", title: "列出專案", access: "read", blurb: "列出你有權存取的進行中專案（預設不含封存，與網站清單同一過濾）。回 items + total，超過 50 筆 truncated=true。" },
  { name: "get_project_context", title: "讀取專案脈絡", access: "read", blurb: "讀專案的世界觀與分鏡進度——生成前先讀這個。" },
  { name: "find_model", title: "找模型", access: "read", blurb: "依類別／等級／關鍵字挑合適的生成模型（含契約健康與能力旗標）。" },
  { name: "get_model_contract", title: "查模型契約", access: "read", blurb: "讀單一模型的健康狀態、分詞器／負向提示／種子能力與 OpenAPI 摘要（變動對應）。" },
  { name: "list_generations", title: "查生成紀錄", access: "read", blurb: "列出某專案的生成紀錄與狀態。回 items + total，超過頁面上限 truncated=true。" },
  { name: "get_generation", title: "查單筆生成", access: "read", blurb: "查一筆生成的最新狀態並取回成品網址／文字（可輪詢到完成）。" },
  { name: "list_assets", title: "列出素材庫", access: "read", blurb: "列出專案成品與素材。回 items + total，超過頁面上限 truncated=true；成品可回頭當生成來源。" },
  { name: "request_upload_grant", title: "簽發上傳授權", access: "write", blurb: "簽發單次素材上傳授權（aidup_…）；MCP 不傳二進位，請用回傳的 token 對 /api/upload 上傳或到網頁上傳台選檔。" },
  { name: "get_upload_grant_status", title: "查上傳授權狀態", access: "read", blurb: "查詢你簽發的上傳授權是否仍有效／已用／過期（不回 token 原文）。" },
  { name: "submit_generation", title: "送出生成", access: "write", openWorld: true, blurb: "提交一次生成（世界觀自動注入、扣你的點數、走你的核准門檻）。" },
  { name: "post_message", title: "發佈留言", access: "write", idempotent: true, blurb: "在專案留言板留言（以你的身分）。同人同專案同內文 2 分鐘內重試回同一則，不重複寫入。" },
  { name: "list_databases", title: "列出資料庫", access: "read", blurb: "列出你可存取的自訂資料庫（欄位、列數、AI 存取等級）；回 items + visibleTotal，超過載入上限時 truncated=true，不得把本頁當成全部。可依 projectId 標註／只看已關聯本專案的表。" },
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
  { name: "list_knowledge", title: "列出知識庫", access: "read", blurb: "列出專案知識庫（腳本／逐字稿／見證／筆記）的摘要與字數。回 items + total，超過頁面上限 truncated=true；全文用 get_knowledge。" },
  { name: "get_knowledge", title: "讀取知識", access: "read", blurb: "分段讀一筆知識全文（每次最多 20000 字，offset 續讀）。" },
  { name: "list_scenes", title: "列出分鏡", access: "read", blurb: "列出專案分鏡的順序、標題、狀態與畫面／配音齊備度（唯讀摘要）。" },
  { name: "list_tasks", title: "列出人類任務", access: "read", blurb: "列出專案的人員任務與核准請求（狀態／負責人／期限／來源計畫）。回 items + total，超過 100 筆 truncated=true。" },
  { name: "create_task", title: "建立人類任務", access: "write", blurb: "為專案建立一件人員任務（指派需為本組成員；與網頁任務同一套守衛）。" },
  { name: "complete_task", title: "完成任務／裁決核准", access: "write", blurb: "把任務標記完成，或對核准請求做出核准／不核准——等待中的代理會自動恢復執行。" },
  { name: "list_decisions", title: "列出專案決策", access: "read", blurb: "列出專案正式 Decision Log，包含來源、建立者、有效或已撤銷狀態。" },
  { name: "create_decision", title: "保存專案決策", access: "write", blurb: "把使用者明確確認的規則或決定存成可長期引用的 Project Decision Memory。" },
  { name: "list_watches", title: "列出持久監看", access: "read", blurb: "列出本人在專案建立的 WATCH 與最近檢查／觸發狀態。" },
  { name: "create_watch", title: "建立持久監看", access: "write", idempotent: true, blurb: "持續檢查專案的截止、逾期、生成失敗、缺素材、待核准與代理阻塞，只在狀態改變時通知。" },
  { name: "cancel_watch", title: "停止持久監看", access: "write", destructive: true, idempotent: true, blurb: "停止本人建立的 WATCH，保留既有通知及稽核紀錄。" },
  { name: "list_schedule", title: "列出行程", access: "read", blurb: "列出專案相關的行程與交付死線。" },
  { name: "add_schedule_item", title: "新增行程", access: "write", blurb: "為專案新增行程／交付死線（進組行事曆）。" },
  { name: "update_schedule_item", title: "更新行程", access: "write", idempotent: true, blurb: "更新一筆既有行程（標題／時間／備註）；只有建立者本人或組長以上可改。" },
  { name: "list_notes", title: "列出筆記", access: "read", blurb: "列出專案相關的會議筆記／知識筆記（本專案 ＋ 組層級共用）。回 items + total，超過頁面上限 truncated=true。" },
  { name: "get_note", title: "讀取筆記", access: "read", blurb: "讀一則筆記的全文（會議決議、待辦、匯入的知識）。" },
  { name: "add_note", title: "新增筆記", access: "write", blurb: "為專案新增一則筆記（會議紀錄／整理／交接；與網頁筆記同一套權限）。" },
  { name: "append_note", title: "追加筆記", access: "write", blurb: "在既有筆記末尾追加內容（保留版本快照）；只有作者本人或組長以上可改。" },
  { name: "get_integrations_status", title: "查外部連接狀態", access: "read", blurb: "查你自己的 Google 雲端／Notion／外部 API 連接狀態（只回顯示資訊，絕不回憑證）。" },
  { name: "import_drive_file", title: "匯入雲端檔案", access: "write", openWorld: true, blurb: "以你自己的 Google 授權把「指定 fileId」的檔案匯入資料庫文件——不提供整盤瀏覽，一次一檔。" },
  { name: "list_dm_contacts", title: "列出私訊對象", access: "read", blurb: "列出你可以私訊的夥伴（同組夥伴＋開發者）：姓名、Email、共同組別。" },
  { name: "list_dm_threads", title: "列出私訊對話", access: "read", blurb: "列出你的私訊對話串（每位對象的最後一句與未讀數）。" },
  { name: "read_dm", title: "讀取私訊", access: "read", blurb: "讀你與某位夥伴的私訊往來（只讀得到自己參與的對話）。" },
  { name: "send_dm", title: "發送私訊", access: "write", blurb: "以你的身分私訊一位同組夥伴或開發者（對方在網站「私訊」頁看到）。" },
  // ── MCP 寫入擴充（創作主線）：知識庫／分鏡／世界觀／素材／設定卡／生成後處理 ──
  { name: "add_knowledge", title: "新增知識", access: "write", idempotent: true, blurb: "為專案新增知識庫條目（腳本／逐字稿／見證／筆記）；需專案可編輯權限。同人同專案同標題＋內容 2 分鐘內重試回同一則。" },
  { name: "update_knowledge", title: "更新知識", access: "write", idempotent: true, blurb: "更新既有知識條目（標題／類型／內容／釘選）；內容變更會留版本快照。" },
  { name: "add_scene", title: "新增分鏡", access: "write", idempotent: true, blurb: "在專案新增一格分鏡草稿（標題／提示詞／旁白／秒數）。同專案同標題＋提示詞 2 分鐘內重試回同一格。" },
  { name: "update_scene", title: "更新分鏡", access: "write", idempotent: true, blurb: "更新分鏡標題、提示詞、旁白、環境音或剪輯（秒數與素材入出點）。" },
  { name: "reorder_scenes", title: "重排分鏡順序", access: "write", idempotent: true, blurb: "依指定順序重排專案分鏡；清單漏掉的分鏡依原相對順序補到尾端。" },
  { name: "set_scene_visual", title: "掛上分鏡畫面", access: "write", blurb: "把生成結果或素材庫項目設為分鏡畫面（二選一：generationId 或 assetId）。" },
  { name: "generate_into_scene", title: "在分鏡格生成", access: "write", openWorld: true, blurb: "在指定分鏡格送出生成（世界觀自動注入、扣點、走核准門檻）；完成後可再 set_scene_visual。" },
  { name: "update_worldview", title: "更新世界觀", access: "write", idempotent: true, blurb: "更新專案世界觀（logline／調性／禁語等）；需專案可編輯權限。" },
  { name: "rename_asset", title: "重新命名素材", access: "write", idempotent: true, blurb: "重新命名專案素材庫中的一筆素材。" },
  { name: "set_asset_lock", title: "鎖定／解鎖素材", access: "write", idempotent: true, blurb: "鎖定素材避免被誤刪或覆寫；解鎖後可再操作。" },
  { name: "add_character", title: "新增角色卡", access: "write", blurb: "為專案新增角色定裝卡（名稱／外觀／備註／參考圖）。" },
  { name: "update_character", title: "更新角色卡", access: "write", idempotent: true, blurb: "更新既有角色定裝卡。" },
  { name: "add_scene_preset", title: "新增場景設定卡", access: "write", blurb: "為專案新增場景設定卡（名稱／色板／光線／參考圖）。" },
  { name: "update_scene_preset", title: "更新場景設定卡", access: "write", idempotent: true, blurb: "更新既有場景設定卡。" },
  { name: "add_prop", title: "新增素材設定卡", access: "write", blurb: "為專案新增道具／素材設定卡（名稱／外觀材質／備註）。" },
  { name: "update_prop", title: "更新素材設定卡", access: "write", idempotent: true, blurb: "更新既有道具／素材設定卡。" },
  { name: "rename_generation", title: "重新命名生成", access: "write", idempotent: true, blurb: "重新命名一筆生成成品的顯示標題。" },
  { name: "retry_generation", title: "重試失敗生成", access: "write", openWorld: true, blurb: "重試一筆失敗的生成（再扣點、走同一模型與提示詞）。" },
  // Adobe（修圖／時間軸）
  { name: "adobe_status", title: "查 Adobe 連結狀態", access: "read", blurb: "查你自己的 Adobe 連結狀態、模式與可用能力。" },
  { name: "adobe_list_assets", title: "列 Adobe 素材", access: "read", blurb: "列出你已連結的 Adobe 帳號內的素材中繼資料。" },
  { name: "adobe_edit_photo", title: "送出 Adobe 修圖", access: "write", openWorld: true, blurb: "在你已連結的 Adobe 帳號內送出修圖（去背／調色等），回 jobId；不扣站內點數。" },
  { name: "adobe_job", title: "查 Adobe 工作狀態", access: "read", blurb: "查 Adobe 非同步工作進度（queued／running／succeeded／failed）。" },
  { name: "adobe_export_timeline", title: "匯出時間軸檔", access: "write", blurb: "把時間軸契約轉成 FCPXML／Premiere XML／EDL（純本機，不需 Adobe 連結）。" },
  { name: "adobe_render_timeline", title: "送 Adobe 時間軸算圖", access: "write", openWorld: true, blurb: "送出時間軸算圖工作（mock 可跑；real 模式可能尚未開放）。" },
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
