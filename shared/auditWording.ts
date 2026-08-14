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
  "auth.logoutAll": "登出全部裝置",
  "auth.touchSession": "延續登入工作階段",
  "auth.revokeSession": "撤銷登入裝置",
  "auth.verifyDevice": "驗證新裝置登入",
  "auth.revokeDevice": "移除信任裝置",
  "auth.createUploadGrant": "簽發上傳授權",
  "auth.changePassword": "修改密碼",
  "auth.setAvatar": "更新個人頭像",
  "auth.clearAvatar": "移除個人頭像",
  "auth.updateProfile": "修改個人基本資料",
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
  "projects.setCover": "更換專案封面圖",
  "projects.updateWorldview": "更新世界觀",
  "projects.setProjectRole": "調整專案成員角色",
  "projects.setOwner": "轉移專案負責人",
  "admin.sendTestEmail": "寄信箱測試信",
  "projects.renameAsset": "重新命名素材",
  "projects.setAssetLock": "鎖定／解鎖素材",
  "projects.deleteAsset": "刪除素材（進回收桶）",
  "projects.restoreAsset": "還原素材",
  "projects.purgeAsset": "永久刪除素材",
  // 外部 AI 成果帶入與交接
  "externalIntake.saveTool": "儲存我的外部 AI 工具",
  "externalIntake.removeTool": "移除我的外部 AI 工具",
  "externalIntake.prepareSession": "準備外部 AI 生成工作階段",
  "externalIntake.markOpened": "開啟外部 AI 並等待成果",
  "externalIntake.cancelSession": "取消外部 AI 生成工作階段",
  "externalIntake.confirm": "確認外部成果的整理位置",
  "externalIntake.importUrl": "從公開網址帶入外部成果",
  "externalIntake.importDriveFile": "從 Google 雲端帶入外部成果",
  "externalEditing.prepare": "準備 LumaFusion 剪輯交接包",
  "externalEditing.markHandedOff": "標記外部剪輯交接已開始",
  "externalEditing.reprepare": "重新準備外部剪輯交接包",
  "externalEditing.cancel": "取消外部剪輯工作階段",
  "externalEditing.complete": "確認外部剪輯成果完成",
  // 分享連結：唯一能讓專案內容被未登入者看到的動作，措辭必須明講「對外公開」
  "share.create": "建立對外唯讀分享連結",
  "share.revoke": "收回對外唯讀分享連結",
  // 生成與點數
  "generation.submit": "送出生成",
  "generation.preview": "預覽 AI 如何理解生成請求",
  "generation.retry": "重試失敗的生成",
  "generation.ablation": "送出影響力實測（基準＋各拿掉一段）",
  "generation.ablationResult": "查看影響力實測結果",
  "generation.bench": "送出同題並跑（多顆模型比較）",
  "generation.rename": "重新命名成品",
  "generation.toggleFavorite": "收藏／取消收藏成品",
  "generation.decideCost": "核決超額生成",
  "generation.cancelAwaiting": "取消自己的待核生成",
  "generation.submitCloudMock": "送出免費雲端模擬生成",
  // 模型即時目錄（Fal 價／新模型上架；開發者手動同步）
  "models.syncLive": "同步即時模型價格與目錄",
  "quota.updateSettings": "更新點數全域設定",
  "quota.setGroupQuota": "調整組別額度",
  "quota.setGroupBudget": "分配組別點數預算",
  "quota.setMemberBudget": "分配組員點數預算",
  "quota.setApprovalThreshold": "調整成本核准門檻",
  "quota.setMemberOverride": "調整個人額度",
  "quota.setMemberDispatch": "調整組員派工權",
  // 分鏡
  "scenes.addDraft": "新增分鏡草稿",
  "scenes.addFromGeneration": "把成品加入分鏡",
  "scenes.setVisualFromGeneration": "設定分鏡畫面",
  "scenes.setVisualFromAsset": "切換分鏡版本",
  "scenes.refine": "以底圖修正分鏡畫面",
  "scenes.update": "更新分鏡",
  "scenes.review": "變更分鏡審核狀態",
  "scenes.inheritFromPrevious": "從上一鏡承接連戲設定",
  "scenes.batchGenerate": "批次生成分鏡畫面",
  "scenes.setCards": "設定分鏡要用的設定卡",
  "scenes.applyScript": "用文字腳本寫回分鏡",
  "scenes.insertAfter": "插入／複製分鏡",
  "scenes.move": "移動分鏡",
  "scenes.reorder": "重排分鏡順序",
  "scenes.remove": "刪除分鏡（進回收桶）",
  "scenes.restore": "還原分鏡",
  "scenes.purge": "永久刪除分鏡",
  "scenes.generateInto": "在分鏡格生成",
  "scenes.generateVariants": "產生分鏡候選變體",
  "scenes.generateVoiceover": "生成分鏡配音",
  "scenes.generateAmbience": "生成分鏡環境音",
  // AI 導演與助手
  "director.suggest": "請 AI 導演給建議",
  "director.sketchBoard": "AI 畫白板草圖",
  "director.generateWhiteboardImage": "AI 繪畫白板正式成品",
  "director.splitScript": "AI 拆分鏡",
  "assistant.ask": "詢問專案 AI 助手",
  "assistant.preview": "預覽專案 AI 助手上下文",
  "assistant.runAction": "執行 AI 助手動作",
  "assistant.undoCreatedScenes": "復原 AI 助手建立的分鏡",
  "aiTrace.review": "用 AI 檢查請求準確性",
  "agents.preview": "預覽 AI 代理規劃上下文",
  "agents.plan": "請 AI 代理規劃",
  "agents.approve": "核准 AI 代理計畫",
  "agents.discard": "放棄 AI 代理計畫",
  "agents.stop": "停止 AI 代理",
  "agents.pause": "暫停 AI 代理",
  "agents.resume": "繼續 AI 代理",
  "agents.resumeFailed": "從失敗步驟繼續 AI 代理",
  "agents.answerAgentQuestion": "回答 AI 代理的澄清問題",
  "agents.certifyPracticalCapability": "驗證 AI 代理能力",
  // 代理背景執行的每一步（背景執行器補記，繞過 tRPC 中介層——代理實際做了什麼的追溯來源）
  "agents.step.generate": "AI 代理：生成素材",
  "agents.step.voiceover": "AI 代理：生成旁白配音",
  "agents.step.create_scene": "AI 代理：新增分鏡",
  "agents.step.split_script": "AI 代理：拆分鏡",
  "agents.step.record_to_database": "AI 代理：寫入資料庫",
  "agents.step.create_note": "AI 代理：建立筆記",
  "agents.step.append_note": "AI 代理：追加筆記",
  "agents.step.create_schedule": "AI 代理：建立排程",
  "agents.step.update_schedule": "AI 代理：更新排程",
  "agents.step.create_task": "AI 代理：建立人類任務",
  "agents.step.wait_for_human": "AI 代理：等待人員完成",
  "agents.step.request_approval": "AI 代理：等待人員核准",
  "agents.step.adobe_photo_edit": "AI 代理：Adobe 修圖",
  "agents.step.adobe_export_timeline": "AI 代理：匯出時間軸（FCP／Premiere／EDL）",
  "agents.step.adobe_timeline_render": "AI 代理：Adobe 時間軸算圖",
  "tasks.create": "建立人類任務（可由留言轉出）",
  "tasks.complete": "人類任務：標記完成",
  "tasks.decideApproval": "人類任務：核准裁決",
  "teamAssistant.ask": "詢問團隊 AI 助手",
  "globalAssistant.ask": "詢問全站 AI 助手",
  "globalAssistant.submitInteraction": "回覆 AI 助手的選擇／選檔要求",
  "globalAssistant.interactionLifecycle": "更新 AI 助手選擇介面狀態",
  "globalAssistant.runSiteAction": "執行全站助手確認卡動作",
  "globalAssistant.undoSiteAction": "復原全站助手直接執行的動作",
  "openaiMcp.ask": "請 GPT 直接讀取並處理 AI-OS",
  "openaiMcp.decide": "確認 GPT 的 AI-OS 寫入操作",
  "teamAssistant.dispatch": "團隊代理派工到專案",
  "quota.setMemberCommandLevel": "調整組員的組代理指揮權",
  "teamAssistant.command": "組代理下指令",
  "teamAssistant.commandBatch": "組代理批次下指令",
  "teamAssistant.planCampaign": "組代理規劃調度計畫",
  "teamAssistant.approveCampaign": "核准組代理調度計畫",
  "teamAssistant.stopCampaign": "停止組代理調度計畫",
  "teamAssistant.discardCampaign": "放棄組代理調度計畫",
  "teamAssistant.resumeCampaign": "讓組代理調度計畫繼續",
  "workflows.start": "啟動工作流",
  "workflows.preview": "預覽工作流實際輸入",
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
  // Story-first：故事工作台、自動解析與造型
  "story.save": "儲存故事",
  "story.restoreVersion": "還原故事版本",
  "story.parse": "AI 解析故事",
  "story.confirmCandidate": "處理解析確認卡",
  "story.generateStoryboard": "從故事產生分鏡",
  "story.undoRun": "撤銷一次故事解析",
  "story.flushCollab": "把共編故事立刻落盤",
  "creativeContext.resolveBindings": "解析故事實體對應",
  "creativeContext.confirmProposal": "確認故事實體對應",
  "creativeContext.dismissProposal": "略過故事實體對應",
  "creativeContext.setLock": "鎖定或解除故事實體對應",
  "creativeContext.undoBinding": "撤銷故事實體對應",
  "creativeContext.freezeShotPacket": "凍結分鏡脈絡包",
  "creativeContext.refreshStalePackets": "重算過期分鏡脈絡",
  "creativeContext.buildDataset": "建立一致性訓練資料集",
  "creativeContext.queueTraining": "送出一致性訓練",
  "creativeContext.promoteVersion": "採用一致性版本",
  "creativeContext.rollbackVersion": "還原一致性版本",
  "creativeContext.adoptGeneration": "採用生成結果為 current",
  "canon.createFromEntity": "把設定卡升為 Team Canon",
  "canon.addVersionFromPin": "從專案卡片建立 Canon 新版本",
  "canon.addVersionFromTraining": "把訓練成果掛為 Canon 候選版本",
  "canon.promoteVersion": "採用 Canon 版本為 production",
  "canon.rollbackVersion": "退回 Canon production 版本",
  "canon.archiveVersion": "封存 Canon 版本",
  "canon.setRights": "調整 Canon 授權與重用範圍",
  "canon.pin": "把 Team Canon 引用進專案",
  "canon.unpin": "解除專案的 Canon 引用",
  "canon.applyUpgrade": "把專案的 Canon 引用升到新版本",
  "story.sceneUpdate": "更新場設定",
  "story.sceneRemove": "刪除場（鏡改為未分場）",
  "characterLooks.add": "新增造型",
  "characterLooks.update": "更新造型",
  "characterLooks.remove": "刪除造型",
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
  "notes.postComment": "在筆記上留言",
  "notes.removeComment": "刪除筆記留言",
  // 筆記／知識庫附件（上傳走 REST，審計由端點自行落一筆）
  "attachments.upload": "上傳筆記／知識庫附件",
  "attachments.remove": "刪除筆記／知識庫附件",
  "schedule.add": "新增排程",
  "schedule.update": "更新排程",
  "schedule.remove": "刪除排程",
  "schedule.importIcs": "匯入 .ics 日曆檔",
  // 靈感頻道（Flow-TV）：把成品／筆記等來源發布成站內公開貼文
  "community.publishFromSource": "發布到靈感頻道",
  "community.unpublish": "從靈感頻道下架",
  "community.republish": "重新上架靈感貼文",
  "community.recordUse": "記錄靈感被引用一次",
  "community.toggleLike": "按讚／取消按讚靈感貼文",
  // 個人 AI 金鑰（BYOK）：只記動作與供應商，金鑰本身不落審計
  "userAiKeys.set": "設定個人 AI 金鑰",
  "userAiKeys.remove": "移除個人 AI 金鑰",
  "userAiKeys.setPrefer": "切換是否優先用個人金鑰",
  "userAiKeys.test": "測試個人 AI 金鑰",
  "exportJobs.create": "建立交付包匯出",
  "exportJobs.cancel": "取消交付包匯出",
  "googleCalendar.syncNow": "手動同步 Google 日曆",
  "googleCalendar.disconnect": "中斷 Google 日曆連結",
  "prompts.save": "儲存提示詞",
  "prompts.remove": "刪除提示詞",
  "scenePresets.add": "新增分鏡預設",
  "scenePresets.update": "更新分鏡預設",
  "scenePresets.remove": "刪除分鏡預設",
  "props.add": "新增素材設定卡",
  "props.update": "更新素材設定卡",
  "props.remove": "刪除素材設定卡",
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
  "databases.createBoundToProject": "建立並綁定專案資料庫",
  "databases.update": "調整資料庫結構",
  "databases.remove": "刪除資料庫",
  "databases.addRow": "新增資料列",
  "databases.updateRow": "更新資料列",
  "databases.removeRow": "刪除資料列",
  "databases.importUrl": "從網址匯入資料庫文件",
  "databases.importDriveFile": "從 Google 雲端選檔匯入資料庫文件",
  "knowledge.importDriveFile": "從 Google 雲端選檔轉存進知識庫",
  "knowledge.importUrl": "從網址或 Notion 頁面加入專案資料",
  "dataHub.bindResource": "把既有資料提供給專案",
  "dataHub.unbindResource": "不再把資料提供給專案（資料本身保留）",
  "intelligence.resolveReview": "確認或修正 AI 資料判斷",
  "intelligence.reprocess": "重新分析智慧資料",
  "intelligence.createPerson": "建立人物知識實體",
  "intelligence.resolveFaceCluster": "確認或拆分人物群組",
  "intelligence.mergePeople": "合併人物知識實體",
  "intelligence.resolveDuplicate": "處理重複素材群組",
  "intelligence.scheduleBackfill": "排程智慧資料重新分析",
  // 資料夾匯入：措辭要說清楚「只是排隊上傳」與「取消不刪已進站的資料」
  "folderImport.begin": "開始匯入資料夾",
  "folderImport.reportFailure": "回報資料夾匯入單檔結果",
  "folderImport.cancel": "停止資料夾匯入（已加入的資料保留）",
  // 專案脈絡：加入／移除的是「引用」，原始資料完全不動
  "projectContext.add": "把資料加入專案脈絡",
  "projectContext.remove": "把資料移出專案脈絡（資料本身保留）",
  "projectContext.setPrimary": "更換主要參考資料",
  "projectContext.confirmSuggestion": "確認 AI 建議的專案資料",
  "projectContext.acceptSuggestions": "批次加入 AI 建議的專案資料",
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
  // Adobe 帳號（修圖／剪輯）
  "adobe.connect": "連結 Adobe 帳號", // Express OAuth callback 手動補記
  "adobe.disconnect": "中斷 Adobe 連結",
  "adobe.editPhoto": "在 Adobe 帳號內修圖",
  "adobe.renderTimeline": "在 Adobe 帳號內算圖剪輯",
  "adobe.exportTimelineFormats": "匯出 Adobe 時間軸（FCP／Premiere／EDL）",
  // 跨裝置通知（subscribe/sync 實務上審計豁免——高頻例行回報＋含裝置金鑰，列入字典保底）
  "messages.postAnnotation": "在畫面上標注要改的地方",
  "messages.resolveAnnotation": "標記標注已改好",
  "messages.setIntent": "標記留言的協作語意",
  "decisions.create": "定案進決策紀錄",
  "decisions.revoke": "撤銷決策（保留紀錄）",
  "notifications.markRead": "標記通知已讀",
  "notifications.markAllRead": "全部通知標為已讀",
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
  // D 波次（#216 總規）：MCP 全面化新工具
  "mcp.update_schedule_item": "外部 AI：更新行程",
  "mcp.add_note": "外部 AI：新增筆記",
  "mcp.append_note": "外部 AI：追加筆記",
  "mcp.list_tasks": "外部 AI：列出人類任務",
  "mcp.create_task": "外部 AI：建立人類任務",
  "mcp.complete_task": "外部 AI：完成任務／裁決核准",
  "mcp.list_knowledge": "外部 AI：列出知識庫",
  "mcp.get_knowledge": "外部 AI：讀取知識",
  "mcp.list_scenes": "外部 AI：列出分鏡",
  "mcp.add_knowledge": "外部 AI：新增知識",
  "mcp.update_knowledge": "外部 AI：更新知識",
  "mcp.add_scene": "外部 AI：新增分鏡",
  "mcp.update_scene": "外部 AI：更新分鏡",
  "mcp.set_scene_visual": "外部 AI：掛上分鏡畫面",
  "mcp.generate_into_scene": "外部 AI：在分鏡格生成",
  "mcp.update_worldview": "外部 AI：更新世界觀",
  "mcp.rename_asset": "外部 AI：重新命名素材",
  "mcp.set_asset_lock": "外部 AI：鎖定／解鎖素材",
  "mcp.add_character": "外部 AI：新增角色卡",
  "mcp.update_character": "外部 AI：更新角色卡",
  "mcp.add_scene_preset": "外部 AI：新增場景設定卡",
  "mcp.update_scene_preset": "外部 AI：更新場景設定卡",
  "mcp.add_prop": "外部 AI：新增素材設定卡",
  "mcp.update_prop": "外部 AI：更新素材設定卡",
  "mcp.rename_generation": "外部 AI：重新命名生成",
  "mcp.retry_generation": "外部 AI：重試失敗生成",
  "mcp.adobe_status": "外部 AI：查 Adobe 連結狀態",
  "mcp.adobe_list_assets": "外部 AI：列 Adobe 素材",
  "mcp.adobe_edit_photo": "外部 AI：送出 Adobe 修圖",
  "mcp.adobe_job": "外部 AI：查 Adobe 工作狀態",
  "mcp.adobe_export_timeline": "外部 AI：匯出時間軸檔",
  "mcp.adobe_render_timeline": "外部 AI：送 Adobe 時間軸算圖",
  "mcp.get_integrations_status": "外部 AI：查外部連接狀態",
  "mcp.import_drive_file": "外部 AI：匯入雲端檔案",
  // 選檔搜尋稽核（query 端點自行補記——記「誰搜了什麼」，不記檔案內容）
  "integrations.listDriveFiles": "瀏覽 Google 雲端選檔清單",
  // PR-6 AI 工作電腦（Computer Runtime）
  "computerRuntime.createSession": "啟動工作電腦（Browser）",
  "computerRuntime.issueLiveView": "開啟工作電腦即時畫面",
  "computerRuntime.act": "工作電腦操作（Browser）",
  "computerRuntime.stop": "停止工作電腦",
  "computerRuntime.requestTakeover": "請求接管工作電腦",
  "computerRuntime.acquireControl": "取得工作電腦控制權",
  "computerRuntime.releaseToAgent": "交回工作電腦給 AI",
  "computerRuntime.detectMockArtifact": "偵測工作電腦成品",
  "computerRuntime.registerFromUrl": "登記工作電腦下載成品",
  "computerRuntime.importArtifact": "匯入工作電腦成品到素材庫",
  "computerRuntime.createDesktopSession": "啟動工作電腦（Desktop）",
  "computerRuntime.escalateToDesktop": "升級工作電腦到桌面",
  "computerRuntime.desktopAct": "工作電腦操作（Desktop）",
  "computerRuntime.planDesktopActions": "規劃桌面 vision 動作",
  "computerRuntime.saveAuthContext": "記住工作電腦登入",
  "computerRuntime.revokeAuthContext": "撤銷已記住的工作電腦登入",
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
  // share 歸在專案：對外分享是「把這個專案交出去」的一種交付方式，組長要查時
  // 會跟封存、打包下載一起看，不該散在另一個分類裡
  { key: "project", label: "專案與素材", prefixes: ["projects", "exportJobs", "share"] },
  { key: "generation", label: "生成與點數", prefixes: ["generation", "quota", "models"] },
  // story 歸在分鏡：故事、自動解析與轉分鏡是同一條創作鏈（Story-first），組長查「分鏡怎麼來的」
  // 會連著看解析與撤銷紀錄；characterLooks 是角色的造型層，跟著知識庫與角色那一類走。
  { key: "storyboard", label: "故事與分鏡", prefixes: ["scenes", "story"] },
  { key: "ai", label: "AI 助手與代理", prefixes: ["director", "assistant", "agents", "aiTrace", "teamAssistant", "globalAssistant", "openaiMcp", "workflows", "computerRuntime"] },
  // projectContext 歸在知識：它回答的是「這個專案要用哪些資料、各自扮演什麼角色」，
  // 查的人和查知識庫／角色設定的是同一批人、同一個問題
  { key: "knowledge", label: "知識庫與角色", prefixes: ["knowledge", "characters", "characterLooks", "props", "projectContext", "creativeContext", "canon"] },
  // attachments 同時服務筆記與知識庫；歸在協作＝跟著「筆記」走（附件的主場是會議紀錄），
  // action 標籤本身已寫明「筆記／知識庫附件」，查知識庫附件時不會被分類誤導
  { key: "collab", label: "留言與協作", prefixes: ["messages", "notes", "schedule", "tasks", "decisions", "dm", "googleCalendar", "push", "notifications", "community", "attachments"] },
  { key: "settings", label: "設定與選項", prefixes: ["prompts", "scenePresets", "options"] },
  { key: "feedback", label: "問題回饋", prefixes: ["feedback", "feedbackReports"] },
  // dataHub 歸在資料：資料中心是「資料庫／知識／素材」的統一視圖，
  // 查「這份資料何時被提供給哪個專案」時，會跟資料表的異動一起看
  { key: "database", label: "資料中心與資料表", prefixes: ["databases", "dataHub", "intelligence", "folderImport"] },
  { key: "external", label: "外部 AI 連線（MCP／整合）", prefixes: ["externalIntake", "externalEditing", "mcpTokens", "mcp", "integrations", "adobe", "userAiKeys"] },
  { key: "system", label: "系統與儲存", prefixes: ["system"] },
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
  // 核准決定
  approve: "通過",
  approved: "通過",
  reject: "退回",
  rejected: "退回",
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
  waiting: "等待人員",
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
  ["threshold", "成本核准門檻"],
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
