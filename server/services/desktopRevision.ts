const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EDITOR_ID_RE = /^[a-z0-9-]{2,64}$/;

export type DesktopRevisionFields = {
  sourceAssetId: string;
  handoffId: string | null;
  editorId: string | null;
};

export type DesktopRevisionParseResult =
  | { ok: true; value: DesktopRevisionFields | null }
  | { ok: false; error: string };

/**
 * 桌面版回傳新 revision 時附帶的 metadata。
 * 未提供 sourceAssetId＝一般上傳；只要提供任一桌面欄位，就必須整體符合固定格式。
 */
export function parseDesktopRevisionFields(body: unknown): DesktopRevisionParseResult {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const sourceAssetId = String(record.sourceAssetId ?? "").trim();
  const handoffId = String(record.desktopHandoffId ?? "").trim();
  const editorId = String(record.editorId ?? "").trim();

  if (!sourceAssetId && !handoffId && !editorId) return { ok: true, value: null };
  if (!UUID_RE.test(sourceAssetId)) {
    return { ok: false, error: "桌面回傳的來源素材識別碼格式不正確" };
  }
  if (handoffId && !UUID_RE.test(handoffId)) {
    return { ok: false, error: "桌面交接識別碼格式不正確" };
  }
  if (editorId && !EDITOR_ID_RE.test(editorId)) {
    return { ok: false, error: "桌面剪輯軟體識別碼格式不正確" };
  }
  return {
    ok: true,
    value: {
      sourceAssetId,
      handoffId: handoffId || null,
      editorId: editorId || null,
    },
  };
}

export function buildDesktopRevisionMeta(
  originalName: string,
  revision: DesktopRevisionFields | null,
): Record<string, unknown> {
  return revision
    ? {
        originalName,
        desktopRevision: {
          sourceAssetId: revision.sourceAssetId,
          handoffId: revision.handoffId,
          editorId: revision.editorId,
          importedAt: new Date().toISOString(),
        },
      }
    : { originalName };
}
