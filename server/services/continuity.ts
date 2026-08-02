import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { ContinuitySnapshot } from "../../shared/continuity";
import { db, schema } from "../db";
import { orderRowsByIds } from "./cardAnchors";
import { signAssetUrl } from "./storage";

export type ContinuitySelection = {
  characterIds?: string[];
  scenePresetIds?: string[];
  propIds?: string[];
};

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function uniquePresent(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function assembleContinuitySnapshot(input: {
  characterRows: ContinuitySnapshot["characters"];
  sceneRows: ContinuitySnapshot["scenes"];
  propRows: ContinuitySnapshot["props"];
  selected: ContinuitySelection;
  locked: boolean;
  capturedAt?: string;
}): ContinuitySnapshot {
  const characters = orderRowsByIds(input.characterRows, input.selected.characterIds ?? []);
  const scenes = orderRowsByIds(input.sceneRows, input.selected.scenePresetIds ?? []);
  const props = orderRowsByIds(input.propRows, input.selected.propIds ?? []);
  const referenceAssetIds = uniquePresent([
    ...characters.map((row) => row.referenceAssetId),
    ...scenes.map((row) => row.referenceAssetId),
    ...props.map((row) => row.referenceAssetId),
  ]);
  const fingerprintPayload = { version: 1 as const, locked: input.locked, characters, scenes, props, referenceAssetIds };
  return {
    ...fingerprintPayload,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    fingerprint: stableFingerprint(fingerprintPayload),
  };
}

/** 讀取並凍結這次生成使用的角色、場景與素材設定。 */
export async function buildContinuitySnapshot(
  projectId: string,
  selected: ContinuitySelection,
  locked = true,
): Promise<ContinuitySnapshot | null> {
  const characterIds = [...new Set(selected.characterIds ?? [])];
  const sceneIds = [...new Set(selected.scenePresetIds ?? [])];
  const propIds = [...new Set(selected.propIds ?? [])];
  if (characterIds.length + sceneIds.length + propIds.length === 0) return null;

  const [characterRows, sceneRows, propRows] = await Promise.all([
    characterIds.length
      ? db.select({
          id: schema.characters.id,
          name: schema.characters.name,
          appearance: schema.characters.appearance,
          notes: schema.characters.notes,
          referenceAssetId: schema.characters.referenceAssetId,
        }).from(schema.characters).where(and(eq(schema.characters.projectId, projectId), inArray(schema.characters.id, characterIds)))
      : Promise.resolve([]),
    sceneIds.length
      ? db.select({
          id: schema.scenePresets.id,
          name: schema.scenePresets.name,
          palette: schema.scenePresets.palette,
          lighting: schema.scenePresets.lighting,
          referenceAssetId: schema.scenePresets.referenceAssetId,
        }).from(schema.scenePresets).where(and(eq(schema.scenePresets.projectId, projectId), inArray(schema.scenePresets.id, sceneIds)))
      : Promise.resolve([]),
    propIds.length
      ? db.select({
          id: schema.props.id,
          name: schema.props.name,
          appearance: schema.props.appearance,
          notes: schema.props.notes,
          referenceAssetId: schema.props.referenceAssetId,
        }).from(schema.props).where(and(eq(schema.props.projectId, projectId), inArray(schema.props.id, propIds)))
      : Promise.resolve([]),
  ]);

  return assembleContinuitySnapshot({
    characterRows,
    sceneRows,
    propRows,
    selected,
    locked,
  });
}

/** 只回傳仍存在、同組且為圖片的參考素材，並保持快照中的順序。 */
export async function resolveContinuityReferenceUrls(
  snapshot: ContinuitySnapshot | null,
  groupId: string,
): Promise<string[]> {
  if (!snapshot?.referenceAssetIds.length) return [];
  const rows = await db.select({
    id: schema.assets.id,
    url: schema.assets.url,
    storagePath: schema.assets.storagePath,
  }).from(schema.assets).where(and(
    inArray(schema.assets.id, snapshot.referenceAssetIds),
    eq(schema.assets.groupId, groupId),
    eq(schema.assets.kind, "image"),
    isNull(schema.assets.deletedAt),
  ));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return snapshot.referenceAssetIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [row.storagePath ? signAssetUrl(row.id) : row.url].filter(Boolean);
  });
}

export type ContinuityReferenceResult = {
  supported: boolean;
  available: number;
  attached: number;
  truncated: number;
};

/**
 * 只有 provider 本來宣告 image_urls 時才安全擴充；未知 schema 不猜欄位，避免 422。
 */
export function applyContinuityReferences(
  providerInput: Record<string, unknown>,
  primarySourceUrl: string | undefined,
  referenceUrls: string[],
  maxImages = 4,
): ContinuityReferenceResult {
  const existing = providerInput.image_urls;
  const supported = Array.isArray(existing);
  const availableUrls = [...new Set([
    ...(primarySourceUrl ? [primarySourceUrl] : []),
    ...referenceUrls,
  ].filter(Boolean))];
  if (!supported) return { supported: false, available: availableUrls.length, attached: 0, truncated: 0 };

  const attachedUrls = availableUrls.slice(0, maxImages);
  providerInput.image_urls = attachedUrls;
  return {
    supported: true,
    available: availableUrls.length,
    attached: attachedUrls.length,
    truncated: Math.max(0, availableUrls.length - attachedUrls.length),
  };
}
