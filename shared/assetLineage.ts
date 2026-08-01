/**
 * 素材血緣（純函式）：從 assets.meta 讀 sourceAssetId／desktopHandoffId／editorId。
 * 與 asset_revisions 表並存——表為正式索引，meta 為過渡與回退。
 */

export type AssetLineageMeta = {
  sourceAssetId?: string;
  desktopHandoffId?: string;
  editorId?: string;
  originalName?: string;
};

export type AssetLike = {
  id: string;
  title: string;
  meta?: unknown;
  createdAt?: string | Date | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAssetLineageMeta(meta: unknown): AssetLineageMeta {
  if (!meta || typeof meta !== "object") return {};
  const o = meta as Record<string, unknown>;
  const sourceAssetId =
    typeof o.sourceAssetId === "string" && UUID_RE.test(o.sourceAssetId)
      ? o.sourceAssetId
      : undefined;
  const desktopHandoffId =
    typeof o.desktopHandoffId === "string" && o.desktopHandoffId.length >= 8
      ? o.desktopHandoffId
      : undefined;
  const editorId =
    typeof o.editorId === "string" && /^[a-z0-9-]{2,64}$/.test(o.editorId)
      ? o.editorId
      : undefined;
  const originalName =
    typeof o.originalName === "string" && o.originalName.trim()
      ? o.originalName.trim().slice(0, 200)
      : undefined;
  return { sourceAssetId, desktopHandoffId, editorId, originalName };
}

export function isDesktopRevision(meta: unknown): boolean {
  const m = parseAssetLineageMeta(meta);
  return !!(m.sourceAssetId && (m.desktopHandoffId || m.editorId));
}

export function editorIdLabel(editorId: string | undefined): string | undefined {
  if (!editorId) return undefined;
  const map: Record<string, string> = {
    "system-default": "系統預設",
    capcut: "剪映 / CapCut",
    "davinci-resolve": "DaVinci Resolve",
    premiere: "Premiere Pro",
    "final-cut": "Final Cut Pro",
    photoshop: "Photoshop",
    audition: "Audition",
  };
  return map[editorId] ?? editorId;
}

export function formatLineageSummary(
  meta: unknown,
  resolveTitle: (sourceAssetId: string) => string | undefined,
): string | null {
  const m = parseAssetLineageMeta(meta);
  if (!m.sourceAssetId) return null;
  const title = resolveTitle(m.sourceAssetId)?.trim() || "原始素材";
  const editor = editorIdLabel(m.editorId);
  if (m.desktopHandoffId || m.editorId) {
    return editor ? `桌面編輯自「${title}」・${editor}` : `桌面編輯自「${title}」`;
  }
  return `編輯自「${title}」`;
}

export function listDirectRevisions<T extends AssetLike>(assets: readonly T[], parentId: string): T[] {
  return assets
    .filter((a) => parseAssetLineageMeta(a.meta).sourceAssetId === parentId)
    .slice()
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
}

export function lineageChain(
  assets: readonly AssetLike[],
  assetId: string,
  maxDepth = 12,
): AssetLike[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const chain: AssetLike[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = assetId;
  for (let i = 0; i < maxDepth && cur; i++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const node = byId.get(cur);
    if (!node) break;
    chain.push(node);
    cur = parseAssetLineageMeta(node.meta).sourceAssetId;
  }
  return chain.reverse();
}
