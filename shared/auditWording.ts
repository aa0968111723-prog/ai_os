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
  // MCP（Claude 等外部代理經 API 操作）
  "mcp.list_projects": "MCP：列出專案",
  "mcp.get_project_context": "MCP：讀取專案脈絡",
  "mcp.find_model": "MCP：挑選模型",
  "mcp.submit_generation": "MCP：送出生成",
  "mcp.post_message": "MCP：發佈留言",
};

/** action → 人話；字典沒有的（新端點）retain 原代碼，寧可看得懂大多數也不擋新功能上線 */
export function humanizeAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 摘要裡值的長度上限：一行掃得完，完整內容本來就進不了審計（後端落庫前已截 200 字） */
const VALUE_MAX = 48;

function fmtValue(v: unknown): string | null {
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (!v.trim()) return null;
    if (UUID_RE.test(v)) return null; // uuid 對人沒資訊量，略過
    return v.length > VALUE_MAX ? `${v.slice(0, VALUE_MAX)}…` : v;
  }
  return null;
}

/** 已知輸入鍵 → 中文標籤（順序＝顯示優先序）。值是 uuid 或空字串會被略過。 */
const INPUT_FIELD_LABELS: Array<[key: string, label: string]> = [
  ["name", "名稱"],
  ["title", "標題"],
  ["email", "Email"],
  ["role", "角色"],
  ["decision", "決定"],
  ["status", "狀態"],
  ["reason", "理由"],
  ["note", "備註"],
  ["modelId", "模型"],
  ["kind", "類型"],
  ["category", "類別"],
  ["prompt", "提示詞"],
  ["text", "內容"],
  ["content", "內容"],
  ["question", "問題"],
  ["points", "點數"],
  ["cost", "點數"],
  ["archived", "封存"],
  ["locked", "鎖定"],
  ["pinned", "釘選"],
  ["favorite", "收藏"],
  ["active", "啟用"],
];

/** 兜底用：把 JSON 裡的 uuid 縮成前 8 碼，讀者至少能對到「同一筆」而不被 36 碼淹沒 */
function shortenUuids(json: string): string {
  return json.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => `${m.slice(0, 8)}…`);
}

/**
 * 輸入摘要人話化：優先抽已知鍵組成「標籤：值」清單；一個已知鍵都沒有時
 * 退回截短 JSON（uuid 縮 8 碼），確保任何輸入都至少有可讀的痕跡。
 */
export function summarizeAuditInput(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const obj = input as Record<string, unknown>;
  const parts: string[] = [];
  for (const [key, label] of INPUT_FIELD_LABELS) {
    if (!(key in obj)) continue;
    const v = fmtValue(obj[key]);
    if (v != null) parts.push(`${label}：${v}`);
    if (parts.length >= 4) break; // 一行以內；再多就是雜訊
  }
  if (parts.length) return parts.join("・");
  try {
    const s = shortenUuids(JSON.stringify(obj));
    if (!s || s === "{}") return "";
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return "";
  }
}
