/**
 * 操作紀錄（審計）人話化：action 代碼 → 中文說明、輸入 JSON → 重點摘要。
 * 背景：操作紀錄的 action 就是 tRPC mutation 路徑（trpc.ts 中介層直接拿 path 當 action），
 * 創作者看到的是「projects.deleteAsset {"assetId":"3fa2…"}」這種代碼與 uuid（回饋 W3）。
 * 純函式、無相依——放 shared 讓前端顯示用、單元測試直接掃。
 * 字典漏了新端點時 fallback 顯示原始代碼，不會壞、只是不夠白話（測試會提醒補字典）。
 */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // 帳號與團隊
  "auth.login": "登入",
  "auth.logout": "登出",
  "auth.changePassword": "修改密碼",
  "auth.acceptInvite": "接受邀請加入",
  "admin.createTeam": "建立團隊",
  "admin.createGroup": "建立組別",
  "admin.invite": "邀請成員",
  "admin.setGroupRole": "調整組內角色",
  "admin.removeFromGroup": "把成員移出組別",
  "admin.resetMemberPassword": "重設成員密碼",
  // 專案與素材
  "projects.create": "建立專案",
  "projects.createSample": "建立範例專案",
  "projects.setArchived": "封存／解封專案",
  "projects.updateWorldview": "更新世界觀",
  "projects.setProjectRole": "調整專案成員角色",
  "projects.renameAsset": "重新命名素材",
  "projects.setAssetLock": "鎖定／解鎖素材",
  "projects.deleteAsset": "刪除素材（進回收桶）",
  "projects.restoreAsset": "還原素材",
  "projects.purgeAsset": "永久刪除素材",
  // 生成與點數
  "generation.submit": "送出生成",
  "generation.rename": "重新命名成品",
  "generation.toggleFavorite": "收藏／取消收藏成品",
  "generation.decideCost": "核決超額生成",
  "quota.updateSettings": "更新點數全域設定",
  "quota.setGroupQuota": "調整組別額度",
  "quota.setGroupBudget": "分配組別點數預算",
  "quota.setMemberBudget": "分配組員點數預算",
  "quota.setApprovalThreshold": "調整審批門檻",
  "quota.setMemberOverride": "調整個人額度",
  // 分鏡與審批
  "scenes.addDraft": "新增分鏡草稿",
  "scenes.addFromGeneration": "把成品加入分鏡",
  "scenes.setVisualFromGeneration": "設定分鏡畫面",
  "scenes.update": "更新分鏡",
  "scenes.move": "移動分鏡",
  "scenes.reorder": "重排分鏡順序",
  "scenes.remove": "刪除分鏡（進回收桶）",
  "scenes.restore": "還原分鏡",
  "scenes.purge": "永久刪除分鏡",
  "scenes.generateInto": "在分鏡格生成",
  "scenes.generateVoiceover": "生成分鏡配音",
  "approvals.submit": "送審",
  "approvals.decide": "審批（通過／退回）",
  // AI 導演與助手
  "director.suggest": "請 AI 導演給建議",
  "director.splitScript": "AI 拆分鏡",
  "assistant.ask": "詢問專案 AI 助手",
  "assistant.runAction": "執行 AI 助手動作",
  "agents.plan": "請 AI 代理規劃",
  "agents.approve": "核准 AI 代理計畫",
  "agents.discard": "放棄 AI 代理計畫",
  "agents.stop": "停止 AI 代理",
  "teamAssistant.ask": "詢問團隊 AI 助手",
  "workflows.start": "啟動工作流",
  "workflows.stop": "停止工作流",
  // 知識庫與角色卡
  "knowledge.add": "新增知識庫條目",
  "knowledge.update": "更新知識庫條目",
  "knowledge.restoreVersion": "還原知識庫版本",
  "knowledge.remove": "刪除知識庫條目（進回收桶）",
  "knowledge.restore": "還原知識庫條目",
  "knowledge.purge": "永久刪除知識庫條目",
  "knowledge.addFromAsset": "把素材收進知識庫",
  "knowledge.describeImageAsset": "AI 產生圖片描述",
  "characters.add": "新增角色卡",
  "characters.update": "更新角色卡",
  "characters.remove": "刪除角色卡",
  // 留言、筆記與其他
  "messages.post": "發佈留言",
  "messages.postVoice": "發佈語音留言",
  "messages.react": "留言表情回應",
  "messages.setPinned": "釘選／取消釘選留言",
  "messages.markRead": "標記留言已讀",
  "notes.add": "新增會議筆記",
  "notes.update": "更新會議筆記",
  "notes.remove": "刪除會議筆記",
  "schedule.add": "新增排程",
  "schedule.update": "更新排程",
  "schedule.remove": "刪除排程",
  "prompts.save": "儲存提示詞",
  "prompts.remove": "刪除提示詞",
  "scenePresets.add": "新增分鏡預設",
  "scenePresets.update": "更新分鏡預設",
  "scenePresets.remove": "刪除分鏡預設",
  "options.upsert": "更新自訂選項",
  "options.setActive": "啟用／停用自訂選項",
  "options.remove": "刪除自訂選項",
  "options.reorder": "重排自訂選項",
  "feedback.submit": "送出使用回饋",
  "feedbackReports.submit": "回報問題",
  "feedbackReports.updateStatus": "更新問題回報狀態",
  "feedbackReports.runAgentNow": "手動觸發回饋代理巡檢",
  // 自訂資料庫（個人／組／團隊／全站）
  "databases.create": "建立資料庫",
  "databases.update": "調整資料庫結構",
  "databases.remove": "刪除資料庫",
  "databases.addRow": "新增資料列",
  "databases.updateRow": "更新資料列",
  "databases.removeRow": "刪除資料列",
  "databases.importUrl": "從網址匯入資料庫文件",
  "databases.importData": "匯入資料到資料庫（CSV／TSV／JSON）",
  "databases.importCsv": "匯入 CSV 到資料庫", // 歷史動作名（併入 importData 前的日誌仍以此顯示）
  "databases.uploadFile": "上傳資料庫文件",
  "databases.refreshFile": "重新整理資料庫文件",
  "databases.removeFile": "刪除資料庫文件",
  // MCP 個人連線金鑰（自助管理）
  "mcpTokens.create": "建立 MCP 連線金鑰",
  "mcpTokens.revoke": "撤銷 MCP 連線金鑰",
  // MCP（Claude 等外部代理經 API 操作）
  "mcp.whoami": "MCP：確認連線身分",
  "mcp.list_projects": "MCP：列出專案",
  "mcp.get_project_context": "MCP：讀取專案脈絡",
  "mcp.find_model": "MCP：挑選模型",
  "mcp.list_generations": "MCP：查生成紀錄",
  "mcp.get_generation": "MCP：查單筆生成",
  "mcp.list_assets": "MCP：列出素材庫",
  "mcp.submit_generation": "MCP：送出生成",
  "mcp.post_message": "MCP：發佈留言",
  "mcp.list_databases": "MCP：列出資料庫",
  "mcp.query_database": "MCP：查詢資料庫",
  "mcp.add_database_row": "MCP：新增資料列",
  "mcp.list_database_files": "MCP：列出資料庫文件",
  "mcp.read_database_file": "MCP：讀取資料庫文件",
  "mcp.get_project_status": "MCP：讀取專案全貌",
  "mcp.plan_agent": "MCP：規劃 AI 代理",
  "mcp.approve_agent": "MCP：核准並執行代理",
  "mcp.stop_agent": "MCP：停止代理",
  "mcp.discard_agent": "MCP：放棄代理計畫",
  "mcp.list_agent_runs": "MCP：列出代理",
  "mcp.get_agent_run": "MCP：查代理進度",
  "mcp.list_schedule": "MCP：列出行程",
  "mcp.add_schedule_item": "MCP：新增行程",
};

/** action → 人話；字典沒有的（新端點）retain 原代碼，寧可看得懂大多數也不擋新功能上線 */
export function humanizeAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/**
 * 操作分類（需求：可分類）。每筆操作依 action 的路由前綴（第一個「.」之前）歸到一大類，
 * 讓組長／管理員能用「一句白話的類別」快速過濾，不必先懂 admin.invite 這種代碼。
 * key 供前端 chip 的 value 與後端過濾用；label 是給人看的中文；prefixes 是所屬 tRPC 路由名。
 * 順序＝畫面上類別排列順序（由帳號治理往協作、外部連線遞進）。
 */
export const AUDIT_CATEGORIES: ReadonlyArray<{ key: string; label: string; prefixes: readonly string[] }> = [
  { key: "account", label: "帳號與團隊", prefixes: ["auth", "admin"] },
  { key: "project", label: "專案與素材", prefixes: ["projects"] },
  { key: "generation", label: "生成與點數", prefixes: ["generation", "quota"] },
  { key: "storyboard", label: "分鏡與審批", prefixes: ["scenes", "approvals"] },
  { key: "ai", label: "AI 助手與代理", prefixes: ["director", "assistant", "agents", "teamAssistant", "workflows"] },
  { key: "knowledge", label: "知識庫與角色", prefixes: ["knowledge", "characters"] },
  { key: "collab", label: "留言與協作", prefixes: ["messages", "notes", "schedule"] },
  { key: "settings", label: "設定與選項", prefixes: ["prompts", "scenePresets", "options"] },
  { key: "feedback", label: "問題回饋", prefixes: ["feedback", "feedbackReports"] },
  { key: "database", label: "自訂資料庫", prefixes: ["databases"] },
  { key: "external", label: "外部連線（MCP）", prefixes: ["mcpTokens", "mcp"] },
];

const OTHER_CATEGORY = { key: "other", label: "其他" } as const;

/** 依 action 前綴歸類；未知前綴落到「其他」而非壞掉（新路由上線也不會沒分類） */
export function auditCategoryOf(action: string): { key: string; label: string } {
  const prefix = action.split(".")[0];
  const cat = AUDIT_CATEGORIES.find((c) => c.prefixes.includes(prefix));
  return cat ? { key: cat.key, label: cat.label } : OTHER_CATEGORY;
}

/** 某分類 key 對應的所有路由前綴（後端過濾用）；未知 key 回空陣列 */
export function auditPrefixesForCategory(key: string): readonly string[] {
  return AUDIT_CATEGORIES.find((c) => c.key === key)?.prefixes ?? [];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 摘要裡值的長度上限：一行掃得完，完整內容本來就進不了審計（後端落庫前已截 200 字） */
const VALUE_MAX = 48;

/**
 * 常見「代碼型」值 → 白話（讓不懂技術的夥伴也讀得懂）。
 * 值先原樣比對，命中才換；沒命中就照原字串顯示（不硬翻，免得誤導）。
 */
const VALUE_LABELS: Record<string, string> = {
  // 審批決定
  approve: "通過",
  approved: "通過",
  reject: "退回",
  rejected: "退回",
  // 角色
  admin: "管理員",
  leader: "組長",
  member: "組員",
  // 問題回報類別／狀態
  bug: "程式錯誤",
  uiux: "介面體驗",
  feature: "功能建議",
  stuck: "卡關求助",
  other: "其他",
  open: "待處理",
  in_progress: "處理中",
  resolved: "已解決",
  wontfix: "不予處理",
};

function labelValue(s: string): string {
  return VALUE_LABELS[s] ?? s;
}

function fmtValue(v: unknown): string | null {
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (!v.trim()) return null;
    if (UUID_RE.test(v)) return null; // uuid 對人沒資訊量，略過
    const mapped = labelValue(v);
    return mapped.length > VALUE_MAX ? `${mapped.slice(0, VALUE_MAX)}…` : mapped;
  }
  // 字串陣列（如世界觀 styles/tones、@提及）串成頓號清單
  if (Array.isArray(v)) {
    const items = v
      .filter((x): x is string => typeof x === "string" && !!x.trim() && !UUID_RE.test(x))
      .map(labelValue);
    if (!items.length) return null;
    const joined = items.join("、");
    return joined.length > VALUE_MAX ? `${joined.slice(0, VALUE_MAX)}…` : joined;
  }
  return null;
}

/** 已知輸入鍵 → 中文標籤（順序＝顯示優先序）。值是 uuid 或空字串會被略過。 */
const INPUT_FIELD_LABELS: Array<[key: string, label: string]> = [
  ["name", "名稱"],
  ["title", "標題"],
  ["label", "名稱"],
  ["email", "Email"],
  ["role", "角色"],
  ["groupRole", "組內角色"],
  ["teamRole", "團隊角色"],
  ["decision", "決定"],
  ["status", "狀態"],
  ["reason", "理由"],
  ["note", "備註"],
  ["comment", "說明"],
  ["message", "訊息"],
  ["body", "內容"],
  ["modelId", "模型"],
  ["model", "模型"],
  ["kind", "類型"],
  ["type", "類型"],
  ["category", "類別"],
  ["prompt", "提示詞"],
  ["text", "內容"],
  ["content", "內容"],
  ["question", "問題"],
  ["styles", "風格"],
  ["tones", "調性"],
  ["mentions", "@提及"],
  ["pages", "涉及頁面"],
  ["points", "點數"],
  ["budgetPoints", "點數預算"],
  ["cost", "點數"],
  ["threshold", "審批門檻"],
  ["archived", "封存"],
  ["locked", "鎖定"],
  ["pinned", "釘選"],
  ["favorite", "收藏"],
  ["active", "啟用"],
];

const KNOWN_KEYS = new Set(INPUT_FIELD_LABELS.map(([k]) => k));

/** 把巢狀的 worldview 攤平：{worldview:{styles,tones}} → 頂層加上 styles/tones，讓摘要抓得到 */
function flattenInput(obj: Record<string, unknown>): Record<string, unknown> {
  const wv = obj.worldview;
  if (wv && typeof wv === "object" && !Array.isArray(wv)) {
    return { ...obj, ...(wv as Record<string, unknown>) };
  }
  return obj;
}

/**
 * 輸入摘要人話化（收合時顯示的一行）：抽已知鍵組成「標籤：值」清單。
 * 只有 uuid／id 的操作（如刪除單一項目）回空字串——動作標題本身已說清楚，
 * 不再塞技術代碼嚇到非技術夥伴；要追蹤 id 可展開「詳細」看。
 */
export function summarizeAuditInput(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const obj = flattenInput(input as Record<string, unknown>);
  const parts: string[] = [];
  for (const [key, label] of INPUT_FIELD_LABELS) {
    if (!(key in obj)) continue;
    const v = fmtValue(obj[key]);
    if (v != null) parts.push(`${label}：${v}`);
    if (parts.length >= 4) break; // 一行以內；再多就是雜訊
  }
  return parts.join("・");
}

/** 詳細檢視用的一列：白話標籤＋白話值 */
export type AuditDetailField = { label: string; value: string };

/** 兜底：把 uuid 縮成前 8 碼，讀者至少能對到「同一筆」而不被 36 碼淹沒 */
function shortenUuid(v: string): string {
  return UUID_RE.test(v) ? `${v.slice(0, 8)}…` : v;
}

/** 把一個未知鍵的值盡量轉成可讀字串（詳細檢視用；uuid 縮 8 碼、陣列串頓號） */
function fmtDetailValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (!v.trim()) return null;
    const s = labelValue(shortenUuid(v));
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  }
  if (Array.isArray(v)) {
    const items = v.map((x) => (typeof x === "string" ? labelValue(shortenUuid(x)) : fmtDetailValue(x))).filter(Boolean);
    return items.length ? (items.join("、").length > 120 ? `${items.join("、").slice(0, 120)}…` : items.join("、")) : null;
  }
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v).replace(/[0-9a-f-]{36}/gi, (m) => shortenUuid(m));
      return s.length > 120 ? `${s.slice(0, 120)}…` : s;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 詳細檢視（展開時顯示）：把整包輸入攤成「白話標籤：白話值」清單，讓非技術夥伴逐項看懂。
 * 已知鍵用中文標籤並依顯示優先序排前面；其餘鍵原樣列在後面（uuid 縮短、代碼值翻白話）。
 * 純顯示、不含敏感值（落庫前已脫敏）。
 */
export function describeAuditInput(input: unknown): AuditDetailField[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const obj = flattenInput(input as Record<string, unknown>);
  const fields: AuditDetailField[] = [];
  const usedKeys = new Set<string>();
  // 先照已知鍵的優先序排
  for (const [key, label] of INPUT_FIELD_LABELS) {
    if (usedKeys.has(key) || !(key in obj)) continue;
    usedKeys.add(key);
    const v = fmtDetailValue(obj[key]);
    if (v != null) fields.push({ label, value: v });
  }
  // 再補其餘未知鍵（worldview 這種容器本身略過，已攤平）
  for (const [key, raw] of Object.entries(obj)) {
    if (usedKeys.has(key) || KNOWN_KEYS.has(key) || key === "worldview") continue;
    const v = fmtDetailValue(raw);
    if (v != null) fields.push({ label: key, value: v });
  }
  return fields;
}
