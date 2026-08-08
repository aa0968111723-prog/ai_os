/**
 * Google 選檔匯入核心（E5/M5 抽出）：tRPC databases.importDriveFile 與 MCP import_drive_file
 * 共用同一條「本人 Drive 授權抓取 → 配額 → 抽文字 → 落地 dataFiles」路徑——
 * 業務 SQL 只此一份，兩個入口各自做 ACL（網頁＝人的資料庫權限；MCP＝AI 存取等級，只更嚴）。
 * sourceUrl 寫成 normalizeImportUrl 認得的形狀，之後「重新整理」沿用既有 Google 路徑。
 */
import { TRPCError } from "@trpc/server";
import type { AuthState } from "./auth";
import { fetchDrivePickedFile } from "./integrations";
import { extractTextFromBuffer, htmlToText, insertDataFileUnderQuota, MAX_TEXT_CHARS } from "./databaseFiles";
import { checkDiskSpace, removeStoredFile, saveBuffer } from "./storage";

export async function importDrivePickedFileToTable(
  auth: AuthState,
  tableId: string,
  input: { fileId: string; name?: string },
): Promise<{ id: string; name: string; readableChars: number }> {
  const picked = await fetchDrivePickedFile(auth.user.id, input.fileId);
  if (!picked.ok) {
    // 沿用 private import 錯誤文案（帳戶無權限含 email 與分享指引、授權失效含重連指引）
    throw new TRPCError({ code: "BAD_REQUEST", message: picked.message });
  }
  const name = (input.name?.trim() || picked.name || "匯入文件").slice(0, 120);

  // 網頁類（雲端裡的 .html 檔）：與 importUrl 同口徑——不落地原檔，直接抽文字
  if (picked.mime === "text/html") {
    const text = htmlToText(picked.buf.toString("utf8")).slice(0, MAX_TEXT_CHARS);
    if (!text) throw new TRPCError({ code: "BAD_REQUEST", message: "這份檔案抓不到可讀文字" });
    const sizeBytes = Buffer.byteLength(text, "utf8");
    const inserted = await insertDataFileUnderQuota(auth.user.id, sizeBytes, {
      tableId, name, mime: "text/plain", sizeBytes,
      sourceUrl: picked.sourceUrl, textContent: text, uploadedBy: auth.user.id,
      // 來源譜系（P6）：從選檔器來的一定是 Google 雲端；modifiedTime 對方沒給就留 null，不編
      sourceProvider: "google-drive",
      sourceExternalId: input.fileId,
      sourceModifiedAt: picked.modifiedTime ? new Date(picked.modifiedTime) : null,
      lastSyncedAt: new Date(),
    });
    if (!inserted.ok) throw new TRPCError({ code: "PRECONDITION_FAILED", message: inserted.error });
    return { id: inserted.row.id, name, readableChars: text.length };
  }

  // 其他格式（Google 文件匯出 txt/csv、pdf/docx/txt…）：原檔落地＋抽文字；配額鎖內 insert（B9）
  const disk = await checkDiskSpace(picked.buf.length);
  if (disk) throw new TRPCError({ code: "PRECONDITION_FAILED", message: disk });
  const text = await extractTextFromBuffer(picked.mime, name, picked.buf);
  const saved = await saveBuffer(picked.buf, picked.mime);
  try {
    const inserted = await insertDataFileUnderQuota(auth.user.id, saved.sizeBytes, {
      tableId, name, mime: picked.mime, sizeBytes: saved.sizeBytes,
      storagePath: saved.storagePath, sourceUrl: picked.sourceUrl, textContent: text, uploadedBy: auth.user.id,
      sourceProvider: "google-drive",
      sourceExternalId: input.fileId,
      sourceModifiedAt: picked.modifiedTime ? new Date(picked.modifiedTime) : null,
      lastSyncedAt: new Date(),
    });
    if (!inserted.ok) {
      await removeStoredFile(saved.storagePath);
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: inserted.error });
    }
    return { id: inserted.row.id, name, readableChars: text?.length ?? 0 };
  } catch (dbErr) {
    if (!(dbErr instanceof TRPCError)) await removeStoredFile(saved.storagePath); // DB 失敗清孤兒檔
    throw dbErr;
  }
}
