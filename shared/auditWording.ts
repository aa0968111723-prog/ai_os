/**
 * 把後端 audit log 的 action code 翻成使用者看得懂的中文。
 * 新增端點時記得同步補這裡，否則系統自檢「audit 字典覆蓋率」會亮黃。
 * 字典漏了新端點時 fallback 顯示原始代碼，不會壞、只是不夠白話（測試會提醒補字典）。
 */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // 帳號與團隊
  "auth.login": "登入",
  "auth.logout": "登出",
  "auth.logoutAll": "登出全部裝置",
  "auth.touchSession": "延續登入工作階段",
  "auth.revokeSession": "撤銷登入裝置",
  "auth.verifyDevice": "驗證新裝置登入",
  "auth.revokeDevice": "移除信任裝置",
  "auth.createUploadGrant": "簽發上傳授權",
  "auth.changePassword": "修改密碼",
  "auth.setUiDensity": "調整介面說明密度",
  "auth.acceptInvite": "接受邀請加入",
  "admin.createTeam": "建立團隊",
  "admin.createGroup": "建立組別",
  "admin.invite": "邀請成員",
  "admin.setGroupRole": "調整組內角色",
  "admin.removeFromGroup": "把成員移出組別",
  "admin.resetMemberPassword": "重設成員密碼",
  "admin.grantDeviceGrace": "豁免成員的新裝置驗證",
  // 儲存健康（素材保全）
  "system.acknowledgeVolumeChange": "確認儲存卷更換並重設指紋",
  // 專案與素材
  "projects.create": "建立專案",
  "projects.createSample": "建立範例專案",
  "projects.createSeriesMaster": "建立母版專案",
  "projects.createSeriesEpisode": "從母版開新的一集",
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
  "generation.submitCloudMock": "送出免費雲端模擬生成",
  // 模型即時目錄（Fal 價／新模型上架；開發者手動同步）
  "models.syncLive": "同步即時模型價格與目錄",
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
  "scenes.setVisualFromAsset": "切換分鏡版本",
  "scenes.refine": "以底圖修正分鏡畫面",
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
  "assistant.chat": "與助手對話",
  "assistant.apply": "套用助手建議",
  // 知識庫
  "knowledge.create": "新增知識",
  "knowledge.update": "更新知識",
  "knowledge.remove": "刪除知識",
  "knowledge.pin": "釘選／取消釘選知識",
  // 系統
  "system.runSelfCheck": "執行系統自檢",
  "system.acknowledgeVolumeChange": "確認儲存卷更換並重設指紋",
};

export const AUDIT_CATEGORIES: ReadonlyArray<{ key: string; label: string; prefixes: readonly string[] }> = [
  { key: "auth", label: "帳號與登入", prefixes: ["auth"] },
  { key: "admin", label: "團隊管理", prefixes: ["admin"] },
  { key: "projects", label: "專案與素材", prefixes: ["projects"] },
  { key: "generation", label: "生成與點數", prefixes: ["generation", "models", "quota"] },
  { key: "scenes", label: "分鏡與審批", prefixes: ["scenes", "approvals"] },
  { key: "ai", label: "AI 導演與助手", prefixes: ["director", "assistant"] },
  { key: "knowledge", label: "知識庫", prefixes: ["knowledge"] },
  { key: "settings", label: "設定與選項", prefixes: ["prompts", "scenePresets", "options", "system"] },
];

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditCategoryFor(action: string): string {
  const prefix = action.split(".")[0] ?? "";
  const cat = AUDIT_CATEGORIES.find((c) => c.prefixes.includes(prefix));
  return cat?.key ?? "other";
}

export function auditCategoryLabel(key: string): string {
  return AUDIT_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export function auditPrefixesForCategory(key: string): readonly string[] {
  return AUDIT_CATEGORIES.find((c) => c.key === key)?.prefixes ?? [];
}
