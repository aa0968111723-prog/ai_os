import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { continuitySnapshotSchema, type ContinuitySnapshot } from "../../shared/continuity";
import { db, schema } from "../db";
import { orderRowsByIds } from "./cardAnchors";
import { signAssetUrl } from "./storage";

export type ContinuitySelection = {
  characterIds?: string[];
  scenePresetIds?: string[];
  propIds?: string[];
  /** 這一鏡選用的造型（Story-first）：解析成各角色的服裝，併進角色錨點；不影響挑卡順序 */
  lookIds?: string[];
};

export type ContinuityEntityKind = "character" | "scene" | "prop";
export type ContinuityCoverage = {
  totalCards: number;
  cardsWithReference: number;
  coveragePercent: number;
  missingReferences: Array<{ kind: ContinuityEntityKind; id: string; name: string }>;
  duplicateNames: Array<{ name: string; entities: Array<{ kind: ContinuityEntityKind; id: string }> }>;
};

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function uniquePresent(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function sanitizeContinuityReferences<T extends { referenceAssetId: string | null }>(
  rows: T[],
  usableReferenceAssetIds: ReadonlySet<string>,
): T[] {
  return rows.map((row) => ({
    ...row,
    referenceAssetId: row.referenceAssetId && usableReferenceAssetIds.has(row.referenceAssetId)
      ? row.referenceAssetId
      : null,
  }));
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

/**
 * 只有鏡頭語言、沒有任何卡片的空殼快照。
 *
 * 純寫景的鏡（沒綁角色／場景／道具）本來拿不到快照，於是「改了鏡別畫面就過時」
 * 這件事在那些鏡上完全失效。這支讓鏡頭語言漂移不必依賴卡片存在。
 */
export function emptyContinuitySnapshot(locked = true, capturedAt?: string): ContinuitySnapshot {
  return assembleContinuitySnapshot({
    characterRows: [],
    sceneRows: [],
    propRows: [],
    selected: {},
    locked,
    capturedAt,
  });
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
          ownerKind: schema.props.ownerKind,
          // 主人名字凍進快照：重試時主人被改名或刪掉，這批鏡頭的錨點仍是當初那句
          ownerName: sql<string | null>`coalesce(${schema.characters.name}, ${schema.scenePresets.name})`,
        })
          .from(schema.props)
          .leftJoin(
            schema.characters,
            and(eq(schema.characters.id, schema.props.ownerId), eq(schema.props.ownerKind, "character")),
          )
          .leftJoin(
            schema.scenePresets,
            and(eq(schema.scenePresets.id, schema.props.ownerId), eq(schema.props.ownerKind, "scene")),
          )
          .where(and(eq(schema.props.projectId, projectId), inArray(schema.props.id, propIds)))
      : Promise.resolve([]),
  ]);

  // 造型 → 角色：一個角色這一鏡只鎖一套（多選同角色時取第一套，避免錨點自相矛盾「穿米白外套且穿雨衣」）
  const lookIds = [...new Set(selected.lookIds ?? [])];
  const lookRows = lookIds.length
    ? await db
        .select({
          id: schema.characterLooks.id,
          characterId: schema.characterLooks.characterId,
          name: schema.characterLooks.name,
          costume: schema.characterLooks.costume,
        })
        .from(schema.characterLooks)
        .where(and(eq(schema.characterLooks.projectId, projectId), inArray(schema.characterLooks.id, lookIds)))
    : [];
  // costume 可為空（只給造型名沒寫描述）——錨點會退回用造型名，不是漏掉這一鏡的造型
  const lookByCharacter = new Map<string, { id: string; name: string; costume: string | null }>();
  for (const row of lookRows) {
    if (!lookByCharacter.has(row.characterId)) lookByCharacter.set(row.characterId, row);
  }
  const charactersWithLook = characterRows.map((row) => {
    const look = lookByCharacter.get(row.id);
    // lookId 一起凍：過時偵測要比對同一張卡，只有名字/描述比不出「是不是同一套」
    return look ? { ...row, lookId: look.id, lookName: look.name, lookCostume: look.costume } : row;
  });

  const requestedReferenceAssetIds = uniquePresent([
    ...characterRows.map((row) => row.referenceAssetId),
    ...sceneRows.map((row) => row.referenceAssetId),
    ...propRows.map((row) => row.referenceAssetId),
  ]);
  const usableReferenceRows = requestedReferenceAssetIds.length
    ? await db.select({ id: schema.assets.id }).from(schema.assets).where(and(
        inArray(schema.assets.id, requestedReferenceAssetIds),
        eq(schema.assets.projectId, projectId),
        eq(schema.assets.kind, "image"),
        isNull(schema.assets.deletedAt),
      ))
    : [];
  const usableReferenceAssetIds = new Set(usableReferenceRows.map((row) => row.id));

  return assembleContinuitySnapshot({
    characterRows: sanitizeContinuityReferences(charactersWithLook, usableReferenceAssetIds),
    sceneRows: sanitizeContinuityReferences(sceneRows, usableReferenceAssetIds),
    propRows: sanitizeContinuityReferences(propRows, usableReferenceAssetIds),
    selected,
    locked,
  });
}

/** 只回傳仍存在、同組且為圖片的參考素材，並保持快照中的順序。 */
export async function resolveContinuityReferenceUrls(
  snapshot: ContinuitySnapshot | null,
  groupId: string,
  excludedAssetId?: string,
): Promise<string[]> {
  const referenceAssetIds = continuityReferenceAssetIds(snapshot, excludedAssetId);
  if (!referenceAssetIds.length) return [];
  const rows = await db.select({
    id: schema.assets.id,
    url: schema.assets.url,
    storagePath: schema.assets.storagePath,
  }).from(schema.assets).where(and(
    inArray(schema.assets.id, referenceAssetIds),
    eq(schema.assets.groupId, groupId),
    eq(schema.assets.kind, "image"),
    isNull(schema.assets.deletedAt),
  ));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return referenceAssetIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [row.storagePath ? signAssetUrl(row.id) : row.url].filter(Boolean);
  });
}

/**
 * 依明確 asset id 清單解析簽名 URL（reference mixer 用）：
 * 與 resolveContinuityReferenceUrls 同一套存活／同組／圖片驗證，保持輸入順序。
 */
export async function resolveAssetReferenceUrlsById(
  assetIds: readonly string[],
  groupId: string,
): Promise<Array<{ assetId: string; url: string }>> {
  if (!assetIds.length) return [];
  const rows = await db.select({
    id: schema.assets.id,
    url: schema.assets.url,
    storagePath: schema.assets.storagePath,
  }).from(schema.assets).where(and(
    inArray(schema.assets.id, [...assetIds]),
    eq(schema.assets.groupId, groupId),
    eq(schema.assets.kind, "image"),
    isNull(schema.assets.deletedAt),
  ));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return assetIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const url = row.storagePath ? signAssetUrl(row.id) : row.url;
    return url ? [{ assetId: id, url }] : [];
  });
}

/** 執行中的鎖定工作流仍需要參考圖時，素材不得刪除或清除。 */
export async function findRunningWorkflowUsingReferenceAsset(
  projectId: string,
  assetId: string,
): Promise<{ id: string } | undefined> {
  const rows = await db.select({
    id: schema.workflowRuns.id,
    continuitySnapshot: schema.workflowRuns.continuitySnapshot,
  }).from(schema.workflowRuns).where(and(
    eq(schema.workflowRuns.projectId, projectId),
    eq(schema.workflowRuns.status, "running"),
  ));
  return rows.find((row) => {
    const parsed = continuitySnapshotSchema.safeParse(row.continuitySnapshot);
    return parsed.success
      && parsed.data.locked
      && parsed.data.referenceAssetIds.includes(assetId);
  });
}

const normalizedEntityName = (name: string): string =>
  name.normalize("NFKC").replace(/\s+/g, "").trim().toLocaleLowerCase("zh-Hant");

/** 精確描述參考圖覆蓋率與同名歧義，不用主觀 AI 分數冒充準確率。 */
export function analyzeContinuitySnapshot(snapshot: ContinuitySnapshot | null): ContinuityCoverage {
  if (!snapshot) return {
    totalCards: 0,
    cardsWithReference: 0,
    coveragePercent: 100,
    missingReferences: [],
    duplicateNames: [],
  };
  const entities = [
    ...snapshot.characters.map((row) => ({ kind: "character" as const, ...row })),
    ...snapshot.scenes.map((row) => ({ kind: "scene" as const, ...row })),
    ...snapshot.props.map((row) => ({ kind: "prop" as const, ...row })),
  ];
  const missingReferences = entities
    .filter((row) => !row.referenceAssetId)
    .map(({ kind, id, name }) => ({ kind, id, name }));
  const byName = new Map<string, Array<{ kind: ContinuityEntityKind; id: string; name: string }>>();
  for (const row of entities) {
    const key = normalizedEntityName(row.name);
    if (!key) continue;
    const group = byName.get(key) ?? [];
    group.push({ kind: row.kind, id: row.id, name: row.name });
    byName.set(key, group);
  }
  const duplicateNames = [...byName.values()]
    .filter((rows) => rows.length > 1)
    .map((rows) => ({ name: rows[0].name, entities: rows.map(({ kind, id }) => ({ kind, id })) }));
  const totalCards = entities.length;
  const cardsWithReference = totalCards - missingReferences.length;
  return {
    totalCards,
    cardsWithReference,
    coveragePercent: totalCards ? Math.round((cardsWithReference / totalCards) * 100) : 100,
    missingReferences,
    duplicateNames,
  };
}

/** 以資產身分排除 primary，避免同一張本地圖因兩次簽名不同而重複佔位。 */
export function continuityReferenceAssetIds(
  snapshot: ContinuitySnapshot | null,
  excludedAssetId?: string,
): string[] {
  return (snapshot?.referenceAssetIds ?? []).filter((id) => id !== excludedAssetId);
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
