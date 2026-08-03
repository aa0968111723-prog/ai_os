/**
 * 生成核心積木（自 routers/generation.ts 抽出，行為不變）：
 * - submitGenerationCore：世界觀/角色/場景注入 → 額度守門扣點 → fal 送出（失敗退點）。
 * - advanceGeneration：推進一筆生成的 fal 狀態並落 DB（done 入素材庫、failed 退點）。
 * 抽成服務層的原因：後端工作流執行器（workflowRunner）要在 tRPC 請求之外重用同一批
 * 防護（孤兒列刪除、CAS 推進、退點）——邏輯若複製兩份，防護遲早分岔。
 * 錯誤沿用 TRPCError：tRPC 端原樣拋出；伺服器內部呼叫端只讀 message（都是人話訊息）。
 * BYOK Phase 2：個人 fal API Key 雙模式計費（usedUserKey → 不扣平台點、apiKey 覆寫）。
 */
