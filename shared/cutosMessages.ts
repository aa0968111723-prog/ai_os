/**
 * 繁體中文（台灣）文案表：CUTOS 影片剪輯整合的所有使用者可見字串。
 *
 * 為什麼是一張表而不是散在元件裡：跨系統事件的 `messageKey` 由 CUTOS 產生、
 * 經 AIOS 落庫、最後由前端顯示。三段路徑各自硬寫字串必然分岔——實機就會出現
 * 「activity.apply.completed」這種原始 key 直接給使用者看。
 *
 * `shared/cutosMessages.test.ts` 會掃 server 端實際會發出的 key，缺一個就紅，
 * 所以這張表不可能落後於程式碼。
 *
 * 規則：
 * - 一律繁體中文，沒有英文回退。
 * - 只描述「真的發生的事」，不顯示模型的思考過程。
 * - 錯誤訊息講「使用者能做什麼」，不丟原始例外。
 */

/** 跨系統活動事件：`activity.<kind>.<status>` */
export const CUTOS_ACTIVITY_MESSAGES: Record<string, string> = {
  "activity.analyze.started": "正在分析影片",
  "activity.analyze.queued": "已排入影片分析",
  "activity.analyze.completed": "影片分析已完成",
  "activity.analyze.failed": "影片分析失敗",

  "activity.transcript.started": "正在讀取逐字稿",
  "activity.transcript.queued": "已排入逐字稿處理",
  "activity.transcript.completed": "逐字稿已完成",
  "activity.transcript.failed": "逐字稿處理失敗",

  "activity.semantic_index.started": "正在建立語意索引",
  "activity.semantic_index.queued": "已排入語意索引",
  "activity.semantic_index.completed": "語意索引已完成",
  "activity.semantic_index.failed": "語意索引失敗",

  "activity.semantic_search.started": "正在搜尋相關內容",
  "activity.semantic_search.queued": "已排入內容搜尋",
  "activity.semantic_search.completed": "已找到相關片段",
  "activity.semantic_search.failed": "搜尋相關內容失敗",

  "activity.speakers.started": "正在辨識說話者",
  "activity.speakers.queued": "已排入說話者辨識",
  "activity.speakers.completed": "說話者辨識已完成",
  "activity.speakers.failed": "說話者辨識失敗",

  "activity.topics.started": "正在整理主題",
  "activity.topics.queued": "已排入主題整理",
  "activity.topics.completed": "主題整理已完成",
  "activity.topics.failed": "主題整理失敗",

  "activity.highlights.started": "正在尋找精華片段",
  "activity.highlights.queued": "已排入精華分析",
  "activity.highlights.completed": "已找到候選精華",
  "activity.highlights.failed": "尋找精華片段失敗",

  "activity.scene.started": "正在檢視片段",
  "activity.scene.queued": "已排入片段檢視",
  "activity.scene.completed": "片段檢視已完成",
  "activity.scene.failed": "片段檢視失敗",

  "activity.context.started": "正在整理影片脈絡",
  "activity.context.queued": "已排入脈絡整理",
  "activity.context.completed": "影片脈絡已整理完成",
  "activity.context.failed": "整理影片脈絡失敗",

  "activity.plan.started": "正在建立剪輯計畫",
  "activity.plan.queued": "已排入剪輯規劃",
  "activity.plan.completed": "剪輯計畫已建立",
  "activity.plan.failed": "建立剪輯計畫失敗",

  "activity.verify.started": "正在驗證剪輯結果",
  "activity.verify.queued": "已排入剪輯驗證",
  "activity.verify.completed": "剪輯計畫驗證通過",
  "activity.verify.failed": "剪輯計畫驗證未通過",

  "activity.preview.started": "正在產生即時預覽",
  "activity.preview.queued": "已排入預覽處理",
  "activity.preview.completed": "即時預覽已完成",
  "activity.preview.failed": "產生即時預覽失敗",

  "activity.approval.started": "正在確認是否需要你核准",
  "activity.approval.queued": "已排入核准檢查",
  "activity.approval.completed": "已取得核准",
  "activity.approval.failed": "核准流程失敗",

  "activity.apply.started": "正在套用修改",
  "activity.apply.queued": "已排入套用",
  "activity.apply.completed": "修改已套用到時間軸",
  "activity.apply.failed": "套用修改失敗",

  "activity.undo.started": "正在復原上一個剪輯",
  "activity.undo.queued": "已排入復原",
  "activity.undo.completed": "已復原上一個剪輯",
  "activity.undo.failed": "復原失敗",

  "activity.redo.started": "正在重做剪輯",
  "activity.redo.queued": "已排入重做",
  "activity.redo.completed": "已重做剪輯",
  "activity.redo.failed": "重做失敗",

  "activity.export.started": "正在輸出影片",
  "activity.export.queued": "已排入影片輸出",
  "activity.export.completed": "影片輸出已完成",
  "activity.export.failed": "影片輸出失敗",

  "activity.job.started": "背景工作已開始",
  "activity.job.queued": "背景工作已排入佇列",
  "activity.job.completed": "背景工作已完成",
  "activity.job.failed": "背景工作失敗",

  "activity.run.started": "正在處理影片工作",
  "activity.run.queued": "已排入影片工作",
  "activity.run.completed": "影片工作已完成",
  "activity.run.failed": "影片工作失敗",

  "activity.cancel.started": "正在取消",
  "activity.cancel.queued": "已排入取消",
  "activity.cancel.completed": "已取消",
  "activity.cancel.failed": "取消失敗",

  "activity.revision.stale": "時間軸已被更動，需要重新規劃",

  // CUTOS 端主動送往 AIOS 的協調事件
  "activity.aiosRun.submitting": "正在把工作交給 AI-OS",
  "activity.aiosRun.submitted": "已交給 AI-OS 處理",
  "activity.aiosRun.resumed": "AI-OS 工作已續行",
  "activity.aiosRun.cancelled": "AI-OS 工作已取消",
  "activity.aiosRun.failed": "AI-OS 工作失敗",
};

/** 錯誤：講使用者能做什麼，不丟原始例外。 */
export const CUTOS_ERROR_MESSAGES: Record<string, string> = {
  "aios.error.protocolMismatch": "CUTOS 版本不相容，請更新其中一邊後再試",
  "aios.error.capabilityNotFound": "CUTOS 沒有這項功能",
  "aios.error.validationFailed": "提供的參數不正確",
  "aios.error.unauthorized": "沒有通過 CUTOS 的驗證，請檢查連線金鑰",
  "aios.error.forbiddenProject": "沒有這個影片專案的存取權",
  "aios.error.projectNotFound": "找不到這個影片專案",
  "aios.error.jobNotFound": "找不到這個背景工作",
  "aios.error.runNotFound": "找不到這次執行",
  "aios.error.staleRevision": "時間軸已被更動，這份剪輯計畫需要重新產生",
  "aios.error.effectInProgress": "同一項修改正在處理中，請稍候",
  "aios.error.idempotencyConflict": "同一個識別碼被用在不同的修改上，已停止以免覆寫",
  "aios.error.approvalRequired": "這項修改需要你的確認",
  "aios.error.noPendingPlan": "目前沒有待審核的剪輯計畫",
  "aios.error.unsupportedOperation": "剪輯計畫包含目前還不支援的操作",
  "aios.error.emptyTimeline": "時間軸是空的，沒有東西可以輸出",
  "aios.error.analysisRequired": "這支影片還沒完成分析，請先執行影片分析",
  "aios.error.cancelled": "已取消",
  "aios.error.timeout": "CUTOS 回應逾時",
  "aios.error.unavailable": "目前無法連線到 CUTOS",
  "aios.error.internal": "CUTOS 發生未預期的問題",
  // 客戶端由錯誤碼推導的鍵（code.toLowerCase()）
  "aios.error.stale_timeline_revision": "時間軸已被更動，這份剪輯計畫需要重新產生",
  "aios.error.approval_required": "這項修改需要你的確認",
  "aios.error.protocol_version_mismatch": "CUTOS 版本不相容，請更新其中一邊後再試",
  "aios.error.capability_not_found": "CUTOS 沒有這項功能",
  "aios.error.validation_failed": "提供的參數不正確",
  "aios.error.idempotency_in_progress": "同一項修改正在處理中，請稍候",
  "aios.error.idempotency_conflict": "同一個識別碼被用在不同的修改上，已停止以免覆寫",
  "aios.error.forbidden_project_scope": "沒有這個影片專案的存取權",
  "aios.error.project_not_found": "找不到這個影片專案",
  "aios.error.job_not_found": "找不到這個背景工作",
  "aios.error.run_not_found": "找不到這次執行",
  "aios.error.no_pending_plan": "目前沒有待審核的剪輯計畫",
  "aios.error.unsupported_operation": "剪輯計畫包含目前還不支援的操作",
  "aios.error.empty_timeline": "時間軸是空的，沒有東西可以輸出",
  "aios.error.analysis_required": "這支影片還沒完成分析，請先執行影片分析",
};

/** 核准原因：說清楚「為什麼要你決定」。 */
export const CUTOS_APPROVAL_MESSAGES: Record<string, string> = {
  "aios.approval.removesMost": "這次修改會刪掉超過三成的影片內容",
  "aios.approval.keepsLittle": "套用後保留的內容不到原片的兩成",
  "aios.approval.bulkDelete": "這次修改包含大量刪除操作",
  "aios.approval.unsupported": "剪輯計畫包含還不支援的操作",
  "aios.approval.finalExport": "這是最終輸出，需要你確認",
  "aios.approval.withinPolicy": "在自動執行範圍內",
};

/** 連線狀態與綁定。 */
export const CUTOS_STATUS_MESSAGES: Record<string, string> = {
  "cutos.status.connected": "CUTOS 已連線",
  "cutos.status.disconnected": "CUTOS 未連線",
  "cutos.status.notConfigured": "尚未設定 CUTOS",
  "aios.protocol.mismatch": "CUTOS 版本不相容",
  "aios.protocol.unknown": "無法辨識 CUTOS 版本",
  "aios.status.connected": "AI-OS 已連線",
  "aios.status.disconnected": "AI-OS 未連線",
  "aios.status.notConfigured": "尚未設定 AI-OS",
  "cutos.binding.notFound": "這個專案還沒連結 CUTOS 影片專案",
  "cutos.binding.forbidden": "沒有這個專案的存取權",
  "cutos.binding.alreadyBound": "這個 CUTOS 影片專案已被其他專案連結",
  "cutos.binding.projectNotFound": "找不到專案",
  "cutos.binding.cutosProjectNotFound": "找不到這個 CUTOS 影片專案",
  "cutos.memory.forbiddenKind": "這類內容不會存進 AI 記憶",
  "cutos.memory.forbiddenContent": "影片內容留在 CUTOS，不會複製到 AI 記憶",
  "cutos.memory.tooLarge": "要記住的內容太大，請改存參照",
  "cutos.memory.namespaceMismatch": "記憶範圍不符",
};

const ALL_MESSAGES: Record<string, string> = {
  ...CUTOS_ACTIVITY_MESSAGES,
  ...CUTOS_ERROR_MESSAGES,
  ...CUTOS_APPROVAL_MESSAGES,
  ...CUTOS_STATUS_MESSAGES,
};

/**
 * 取繁中文案。
 *
 * 找不到時**不回英文 key**：那會讓畫面出現 `activity.foo.bar`。改回一句一般
 * 使用者看得懂的中文，並讓 `hasCutosMessage` 供測試抓漏。
 */
export function cutosMessage(key: string, fallback = "處理中"): string {
  return ALL_MESSAGES[key] ?? fallback;
}

export function hasCutosMessage(key: string): boolean {
  return key in ALL_MESSAGES;
}

export function cutosMessageKeys(): string[] {
  return Object.keys(ALL_MESSAGES);
}

/** 依活動事件組出一行進度文字（可附數量等結構化計量）。 */
export function describeActivity(event: {
  messageKey: string;
  metadata?: Record<string, string | number | boolean>;
}): string {
  const base = cutosMessage(event.messageKey);
  const metadata = event.metadata ?? {};
  const count = typeof metadata.count === "number" ? metadata.count : undefined;
  if (count !== undefined) return `${base}（${count}）`;
  return base;
}
