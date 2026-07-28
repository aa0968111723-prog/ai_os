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
  "projects.setOwner": "轉移專案負責人",
  "admin.sendTestEmail": "寄信箱測試信",
  "projects.renameAsset": "重新命名素材",
  "projects.setAssetLock": "鎖定／解鎖素材",
  "projects.deleteAsset": "刪除素材（進回收桶）",
  "projects.restoreAsset": "還原素材",
  "projects.purgeAsset": "永久刪除素材",
  // 生成與點數
  "generation.submit": "送出生成",
  "generation.retry": "重試失敗的生成",
  "generation.rename": "重新命名成品",
  "generation.toggleFavorite": "收藏／取消收藏成品",
  "generation.decideCost": "核決超額生成",
  "quota.updateSettings": "更新點數全域設定",
  "quota.setGroupQuota": "調整組別額度",
  "quota.setGroupBudget": "分配組別點數預算",
  "quota.setMemberBudget": "分配組員點數預算",
  "quota.setApprovalThreshold": "調整審批門檻",
  "quota.setMemberOverride": "調整個人額度",
  "quota.setMemberDispatch": "調整組員派工權",
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
  // 代理背景執行的每一步（背景執行器補記，繞過 tRPC 中介層——代理實際做了什麼的追溯來源）
  "agents.step.generate": "AI 代理：生成素材",
  "agents.step.voiceover": "AI 代理：生成旁白配音",
  "agents.step.create_scene": "AI 代理：新增分鏡",
  "agents.step.split_script": "AI 代理：拆分鏡",
  "agents.step.submit_approval": "AI 代理：送審分鏡",
  "agents.step.record_to_database": "AI 代理：寫入資料庫",
  "agents.step.create_note": "AI 代理：建立筆記",
  "agents.step.append_note": "AI 代理：追加筆記",
  "agents.step.create_schedule": "AI 代理：建立排程",
  "agents.step.update_schedule": "AI 代理：更新排程",
  "teamAssistant.ask": "詢問團隊 AI 助手",
  "teamAssistant.dispatch": "團隊代理派工到專案",
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
  // 站內私訊（內容不落審計明文，只記「私訊了誰」；markRead 實務上審計豁免，列入字典保底）
  "dm.send": "發送私訊",
  "dm.markRead": "標記私訊已讀",
  "notes.add": "新增會議筆記",
  "notes.update": "更新會議筆記",
  "notes.remove": "刪除會議筆記",
  "schedule.add": "新增排程",
  "schedule.update": "更新排程",
  "schedule.remove": "刪除排程",
  "exportJobs.create": "建立交付包匯出",
  "exportJobs.cancel": "取消交付包匯出",
  "googleCalendar.syncNow": "手動同步 Google 日曆",
  "googleCalendar.disconnect": "中斷 Google 日曆連結",
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
  "databases.setFileMeta": "編輯資料庫文件分類／描述",
  "databases.classifyFile": "AI 看圖分類資料庫圖片",
  "databases.sendFileToProject": "把資料庫文件送進專案素材庫",
  // MCP 個人連線金鑰（自助管理）。「MCP」對非技術夥伴是黑話——一律寫成「外部 AI」，
  // 分類標籤保留一次（MCP）括註，讓技術夥伴仍對得上文件用語。
  "mcpTokens.create": "建立外部 AI 連線金鑰",
  "mcpTokens.revoke": "撤銷外部 AI 連線金鑰",
  // 個人整合連接（Google 雲端／Notion／外部資料庫）
  "integrations.setNotion": "設定個人 Notion token",
  "integrations.removeNotion": "移除個人 Notion token",
  "integrations.addApi": "新增外部資料庫／API 連接",
  "integrations.fetchApi": "從外部連接抓取資料",
  "integrations.remove": "刪除外部資料庫／API 連接",
  "integrations.removeGoogleDrive": "中斷 Google 雲端連結",
  "integrations.googleDriveConnect": "連結 Google 雲端硬碟", // Express OAuth callback 手動補記
  // 跨裝置通知（subscribe/sync 實務上審計豁免——高頻例行回報＋含裝置金鑰，列入字典保底）
  "push.subscribe": "連結通知裝置",
  "push.sync": "同步通知裝置",
  "push.unsubscribe": "解除通知裝置",
  "push.removeDevice": "移除通知裝置",
  "push.test": "發送測試通知",
  // MCP（Claude 等外部代理經 API 操作）
  "mcp.whoami": "外部 AI：確認連線身分",
  "mcp.list_projects": "外部 AI：列出專案",
  "mcp.get_project_context": "外部 AI：讀取專案脈絡",
  "mcp.find_model": "外部 AI：挑選模型",
  "mcp.list_generations": "外部 AI：查生成紀錄",
  "mcp.get_generation": "外部 AI：查單筆生成",
  "mcp.list_assets": "外部 AI：列出素材庫",
  "mcp.submit_generation": "外部 AI：送出生成",
  "mcp.post_message": "外部 AI：發佈留言",
  "mcp.list_databases": "外部 AI：列出資料庫",
  "mcp.query_database": "外部 AI：查詢資料庫",
  "mcp.add_database_row": "外部 AI：新增資料列",
  "mcp.add_database_rows": "外部 AI：批次新增資料列",
  "mcp.list_database_files": "外部 AI：列出資料庫文件",
  "mcp.read_database_file": "外部 AI：讀取資料庫文件",
  "mcp.get_project_status": "外部 AI：讀取專案全貌",
  "mcp.plan_agent": "外部 AI：規劃 AI 代理",
  "mcp.approve_agent": "外部 AI：核准並執行代理",
  "mcp.stop_agent": "外部 AI：停止代理",
  "mcp.discard_agent": "外部 AI：放棄代理計畫",
  "mcp.list_agent_runs": "外部 AI：列出代理",
  "mcp.get_agent_run": "外部 AI：查代理進度",
  "mcp.list_schedule": "外部 AI：列出行程",
  "mcp.add_schedule_item": "外部 AI：新增行程",
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
  { key: "project", label: "專案與素材", prefixes: ["projects", "exportJobs"] },
  { key: "generation", label: "生成與點數", prefixes: ["generation", "quota"] },
  { key: "storyboard", label: "分鏡與審批", prefixes: ["scenes", "approvals"] },
  { key: "ai", label: "AI 助手與代理", prefixes: ["director", "assistant", "agents", "teamAssistant", "workflows"] },
  { key: "knowledge", label: "知識庫與角色", prefixes: ["knowledge", "characters"] },
  { key: "collab", label: "留言與協作", prefixes: ["messages", "notes", "schedule", "dm", "googleCalendar", "push"] },
  { key: "settings", label: "設定與選項", prefixes: ["prompts", "scenePresets", "options"] },
  { key: "feedback", label: "問題回饋", prefixes: ["feedback", "feedbackReports"] },
  { key: "database", label: "自訂資料庫", prefixes: ["databases"] },
  { key: "external", label: "外部 AI 連線（MCP／整合）", prefixes: ["mcpTokens", "mcp", "integrations"] },
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
  needs_work: "需修改",
  // 角色與權限
  admin: "管理員",
  leader: "組長",
  member: "組員",
  editor: "可編輯",
  viewer: "僅檢視",
  none: "無",
  read: "唯讀",
  write: "可寫入",
  // 可見範圍（資料庫／選項）
  personal: "個人",
  group: "組別",
  team: "團隊",
  global: "全站",
  // 模型等級（與 shared/models 的 tierLabel 同語）
  flagship: "旗艦",
  economy: "經濟",
  budget: "最低成本",
  // 生成輸出型態／資料庫欄位型別
  image: "圖片",
  video: "影片",
  audio: "聲音",
  text: "文字",
  number: "數字",
  select: "下拉選項",
  date: "日期",
  checkbox: "勾選",
  url: "網址",
  file: "檔案",
  user: "成員",
  project: "專案",
  schedule: "行程",
  // 匯入格式
  csv: "CSV",
  tsv: "TSV",
  json: "JSON",
  // 代理／生成進度
  queued: "排隊中",
  running: "執行中",
  done: "已完成",
  failed: "失敗",
  awaiting_approval: "等待核准",
  // 知識庫條目類型（與 KnowledgeBase 的 KINDS 同語）
  transcript: "師父開示稿",
  testimony: "見證故事",
  script: "腳本",
  note: "其他筆記",
  // 分鏡移動方向
  up: "往上",
  down: "往下",
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
  ["answer", "回覆"],
  ["description", "描述"],
  ["aiDescription", "AI 描述"],
  ["keyword", "關鍵字"],
  ["search", "關鍵字"],
  ["q", "關鍵字"],
  ["url", "網址"],
  ["sourceUrl", "來源網址"],
  ["voiceover", "旁白"],
  ["durationSec", "秒數"],
  ["sceneNo", "分鏡編號"],
  ["appearance", "外觀"],
  ["lighting", "光線"],
  ["palette", "色調"],
  ["styles", "風格"],
  ["tones", "調性"],
  ["scope", "範圍"],
  ["visibility", "可見範圍"],
  ["format", "格式"],
  ["platform", "平台"],
  ["mentions", "@提及"],
  ["pages", "涉及頁面"],
  ["best", "最滿意"],
  ["worst", "最需改進"],
  ["direction", "方向"],
  ["points", "點數"],
  ["budgetPoints", "點數預算"],
  ["totalBudgetPoints", "總預算點數"],
  ["defaultDailyPoints", "每日預設點數"],
  ["defaultWeeklyPoints", "每週預設點數"],
  ["fileQuotaGb", "檔案空間上限（GB）"],
  ["expiresInDays", "效期（天）"],
  ["cost", "點數"],
  ["threshold", "審批門檻"],
  ["agentAccess", "代理權限"],
  ["memberWritable", "組員可編輯"],
  ["readOnly", "唯讀"],
  ["required", "必填"],
  ["sendEmailInvite", "寄送邀請信"],
  ["targetLabel", "對象"],
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

/**
 * id 類鍵 → 白話標籤（詳細檢視用）。摘要會略過 uuid，但展開詳細時仍要能追查
 * 「動到哪一筆」——與其露出 sceneId 這種英文代碼，標成「分鏡」＋縮短的編號更好讀。
 */
const ID_KEY_LABELS: Record<string, string> = {
  id: "編號",
  projectId: "專案",
  groupId: "組別",
  teamId: "團隊",
  sceneId: "分鏡",
  assetId: "素材",
  sourceAssetId: "來源素材",
  referenceAssetId: "參考素材",
  generationId: "生成成品",
  messageId: "留言",
  sourceMessageId: "來源留言",
  replyToId: "回覆的留言",
  tableId: "資料庫",
  databaseId: "資料庫",
  rowId: "資料列",
  fileId: "文件",
  userId: "成員",
  memberId: "成員",
  actorId: "操作者",
  ownerId: "擁有者",
  targetUserId: "對象成員",
  toUserId: "收件成員",
  peerId: "對象成員",
  noteId: "筆記",
  entryId: "知識庫條目",
  characterId: "角色卡",
  presetId: "分鏡預設",
  scenePresetIds: "分鏡預設",
  runId: "代理任務",
  itemId: "項目",
  optionId: "選項",
  promptId: "提示詞",
  tokenId: "金鑰",
  refId: "關聯項目",
  modelId: "模型",
};

/** 未知鍵的顯示標籤：id 類鍵翻白話，其餘保留原鍵名（不硬翻，免得誤導） */
function labelForUnknownKey(key: string): string {
  return ID_KEY_LABELS[key] ?? key;
}

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
  // 再補其餘未知鍵（worldview 這種容器本身略過，已攤平）；id 類鍵翻成白話標籤
  for (const [key, raw] of Object.entries(obj)) {
    if (usedKeys.has(key) || KNOWN_KEYS.has(key) || key === "worldview") continue;
    const v = fmtDetailValue(raw);
    if (v != null) fields.push({ label: labelForUnknownKey(key), value: v });
  }
  return fields;
}

/* ═══════════════ 連續重複紀錄合併 ═══════════════ */

/** groupConsecutiveAudit 需要的最小欄位（audit.list 回傳列的子集） */
export type AuditGroupableRow = {
  actorId: string;
  action: string;
  ok: boolean;
  error: string | null;
  groupId: string | null;
  projectId: string | null;
  createdAt: string | Date;
  input: unknown;
};

/** 兩筆之間可視為「連續」的最大時間差：超過就分段，避免早上與下午的同型操作被硬併成一團 */
const GROUP_GAP_MS = 30 * 60 * 1000;

/**
 * 把「同一人、同一動作、同一結果、同一歸屬、摘要相同」且時間相近的連續紀錄併成一組，
 * 讓「AI 代理連生 10 張圖」「連續拖 15 次分鏡排序」不再洗版整頁（回饋：重複的要收斂）。
 * 輸入須為 createdAt 由新到舊排序（audit.list 的自然順序）；輸出為組的陣列，各組同樣新在前。
 * 摘要不同（如兩次更新分鏡改了不同欄位）就不併——資訊量不同的列各自保留。
 */
export function groupConsecutiveAudit<T extends AuditGroupableRow>(rows: T[]): T[][] {
  const groups: T[][] = [];
  let lastSig: string | null = null;
  for (const r of rows) {
    const sig = [r.actorId, r.action, r.ok, r.error ?? "", r.groupId ?? "", r.projectId ?? "", summarizeAuditInput(r.input)].join("\u0000");
    const cur = groups[groups.length - 1];
    const prev = cur?.[cur.length - 1];
    const closeEnough =
      prev != null && new Date(prev.createdAt).getTime() - new Date(r.createdAt).getTime() <= GROUP_GAP_MS;
    if (cur && lastSig === sig && closeEnough) {
      cur.push(r);
    } else {
      groups.push([r]);
      lastSig = sig;
    }
  }
  return groups;
}
