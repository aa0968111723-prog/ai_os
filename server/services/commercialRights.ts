/**
 * Persist and recompute asset rights profiles. Evaluation itself is a pure
 * function in shared/commercialRights.ts so UI, delivery and training share it.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { requireGroup } from "../trpc";
import { recordAudit } from "./audit";
import {
  RIGHTS_DECISION_VERSION,
  evaluateRights,
  inferSourceType,
  makeEvidence,
  parseLicenseText,
  profileFingerprint,
  sanitizeEvidenceExcerpt,
  summarizeProjectRights,
  deliveryRightsVerdict,
  type RightsProfile,
  type RightsSourceType,
  type RightsUsageContext,
  type RightsEvidenceKind,
} from "../../shared/commercialRights";
import { resolveLicenseWithProviders, type RightsProvider } from "./rightsProvider";

async function loadAssetOrThrow(auth: AuthState, assetId: string) {
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId));
  if (!asset || asset.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個素材" });
  requireGroup(auth, asset.groupId);
  return asset;
}

function tagsOf(asset: { tags: unknown }): string[] {
  return Array.isArray(asset.tags) ? asset.tags.filter((t): t is string => typeof t === "string") : [];
}

function metaString(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export async function evaluateAndStoreAssetRights(input: {
  auth: AuthState;
  assetId: string;
  sourceType?: RightsSourceType;
  sourceUrl?: string | null;
  licenseText?: string | null;
  ownerClaim?: { ownsOrLicensed: boolean; note?: string | null };
  usageContext?: RightsUsageContext;
  trigger?: string;
  providers?: RightsProvider[];
}): Promise<{ profile: RightsProfile; reused: boolean }> {
  const asset = await loadAssetOrThrow(input.auth, input.assetId);
  const [existing] = await db.select().from(schema.assetRightsProfiles).where(eq(schema.assetRightsProfiles.assetId, asset.id));
  const attestations = await db.select().from(schema.assetRightsAttestations)
    .where(eq(schema.assetRightsAttestations.assetId, asset.id))
    .orderBy(desc(schema.assetRightsAttestations.createdAt));

  const resolved = await resolveLicenseWithProviders({
    sourceType: input.sourceType ?? existing?.sourceType ?? inferSourceType({
      isAiGenerated: asset.isAiGenerated,
      originUrl: asset.originUrl,
      sourceProvider: metaString(asset.meta, "sourceProvider"),
    }),
    sourceUrl: input.sourceUrl ?? existing?.profile.sourceUrl ?? asset.originUrl,
    licenseText: input.licenseText ?? existing?.profile.licenseTextSnapshot ?? null,
  }, input.providers);

  const extraEvidence = attestations.map((row) => makeEvidence({
    kind: row.kind as RightsEvidenceKind,
    summary: row.reason,
    excerpt: row.excerpt,
    sourceUrl: row.sourceUrl,
    recordedBy: row.actorId,
    recordedAt: row.createdAt.toISOString(),
  }));

  const ownerFromAttestation = attestations.find((row) => row.kind === "owner_declaration" || row.kind === "client_authorization" || row.kind === "human_attestation");
  const profile = evaluateRights({
    assetId: asset.id,
    sourceType: input.sourceType ?? existing?.sourceType ?? inferSourceType({
      isAiGenerated: asset.isAiGenerated,
      originUrl: asset.originUrl,
      sourceProvider: metaString(asset.meta, "sourceProvider"),
      declared: input.sourceType,
    }),
    sourceUrl: input.sourceUrl ?? existing?.profile.sourceUrl ?? asset.originUrl,
    sourceProvider: metaString(asset.meta, "sourceProvider") ?? metaString(asset.meta, "provider"),
    creator: metaString(asset.meta, "creator"),
    uploader: asset.uploadedBy,
    ownerClaim: input.ownerClaim ? {
      ...input.ownerClaim,
      attestedBy: input.auth.user.id,
      attestedAt: new Date().toISOString(),
    } : ownerFromAttestation ? {
      ownsOrLicensed: true,
      note: ownerFromAttestation.reason,
      attestedBy: ownerFromAttestation.actorId,
      attestedAt: ownerFromAttestation.createdAt.toISOString(),
    } : existing?.profile.ownerClaim ?? null,
    license: resolved.license ?? (existing?.profile.licenseTextSnapshot ? parseLicenseText({
      text: existing.profile.licenseTextSnapshot,
      url: existing.profile.licenseUrl,
    }) : null),
    extraEvidence,
    usageContext: input.usageContext ?? existing?.usageContext ?? "commercial_final",
    kind: asset.kind,
    title: asset.title,
    tags: tagsOf(asset),
    isAiGenerated: asset.isAiGenerated,
    providerFailed: resolved.failed,
  });

  const fingerprint = profileFingerprint(profile);
  const [sameCheck] = await db.select({ id: schema.assetRightsChecks.id })
    .from(schema.assetRightsChecks)
    .where(and(eq(schema.assetRightsChecks.assetId, asset.id), eq(schema.assetRightsChecks.fingerprint, fingerprint)));

  const row = {
    assetId: asset.id,
    projectId: asset.projectId,
    groupId: asset.groupId,
    sourceType: profile.sourceType,
    licenseType: profile.licenseType,
    rightsStatus: profile.rightsStatus,
    commercialUseAllowed: profile.grants.commercialUseAllowed,
    trainingAllowed: profile.grants.trainingAllowed,
    derivativesAllowed: profile.grants.derivativesAllowed,
    attributionRequired: profile.grants.attributionRequired,
    editorialOnly: profile.grants.editorialOnly,
    personalUseOnly: profile.grants.personalUseOnly,
    confidence: profile.confidence,
    decisionVersion: RIGHTS_DECISION_VERSION,
    usageContext: profile.usageContext,
    licenseFingerprint: profile.licenseFingerprint,
    profile,
    checkedAt: new Date(profile.checkedAt),
    updatedAt: new Date(),
  };

  let profileId = existing?.id;
  if (existing) {
    await db.update(schema.assetRightsProfiles).set(row).where(eq(schema.assetRightsProfiles.id, existing.id));
  } else {
    const [inserted] = await db.insert(schema.assetRightsProfiles).values(row).returning({ id: schema.assetRightsProfiles.id });
    profileId = inserted.id;
  }

  if (!sameCheck) {
    await db.insert(schema.assetRightsChecks).values({
      profileId: profileId!,
      assetId: asset.id,
      projectId: asset.projectId,
      groupId: asset.groupId,
      decisionVersion: RIGHTS_DECISION_VERSION,
      rightsStatus: profile.rightsStatus,
      fingerprint,
      trigger: input.trigger ?? "recheck",
      snapshot: profile,
    });
  }

  return { profile, reused: Boolean(sameCheck) };
}

export async function submitRightsAttestation(input: {
  auth: AuthState;
  assetId: string;
  kind: RightsEvidenceKind;
  reason: string;
  excerpt?: string;
  sourceUrl?: string;
  sourceType?: RightsSourceType;
  ownsOrLicensed?: boolean;
  licenseText?: string;
}): Promise<{ profile: RightsProfile }> {
  const asset = await loadAssetOrThrow(input.auth, input.assetId);
  const excerpt = sanitizeEvidenceExcerpt(input.excerpt ?? input.licenseText ?? null);
  const fingerprint = profileFingerprint({
    assetId: asset.id,
    licenseFingerprint: input.licenseText ?? input.reason,
    rightsStatus: "UNKNOWN",
    grants: {
      commercialUseAllowed: null,
      derivativesAllowed: null,
      modificationAllowed: null,
      redistributionAllowed: null,
      attributionRequired: null,
      attributionText: null,
      editorialOnly: false,
      personalUseOnly: false,
      trainingAllowed: null,
      aiGenerationAllowed: null,
      sublicensingAllowed: null,
    },
    findings: [],
    evidence: [],
    decisionVersion: `${input.kind}:${input.reason}`,
  });

  let [profileRow] = await db.select().from(schema.assetRightsProfiles).where(eq(schema.assetRightsProfiles.assetId, asset.id));
  if (!profileRow) {
    const created = await evaluateAndStoreAssetRights({ auth: input.auth, assetId: asset.id, trigger: "intake" });
    [profileRow] = await db.select().from(schema.assetRightsProfiles).where(eq(schema.assetRightsProfiles.assetId, asset.id));
    if (!profileRow) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "無法建立權利檔" });
    void created;
  }

  await db.insert(schema.assetRightsAttestations).values({
    profileId: profileRow.id,
    assetId: asset.id,
    projectId: asset.projectId,
    groupId: asset.groupId,
    actorId: input.auth.user.id,
    kind: input.kind,
    reason: input.reason,
    excerpt,
    sourceUrl: input.sourceUrl ?? null,
    fingerprint,
  });
  recordAudit(input.auth, "commercialRights.submitEvidence", {
    assetId: asset.id,
    projectId: asset.projectId,
    kind: input.kind,
    reason: input.reason,
  }, { ok: true });

  const next = await evaluateAndStoreAssetRights({
    auth: input.auth,
    assetId: asset.id,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    licenseText: input.licenseText,
    ownerClaim: input.ownsOrLicensed != null ? { ownsOrLicensed: input.ownsOrLicensed, note: input.reason } : undefined,
    trigger: "evidence",
  });
  return { profile: next.profile };
}

export async function getAssetRights(input: { auth: AuthState; assetId: string }): Promise<RightsProfile> {
  const asset = await loadAssetOrThrow(input.auth, input.assetId);
  const [row] = await db.select().from(schema.assetRightsProfiles).where(eq(schema.assetRightsProfiles.assetId, asset.id));
  if (row) return row.profile;
  const created = await evaluateAndStoreAssetRights({ auth: input.auth, assetId: asset.id, trigger: "intake" });
  return created.profile;
}

export async function listProjectRights(input: { auth: AuthState; projectId: string }) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(input.auth, project.groupId);
  const assets = await db.select({
    id: schema.assets.id,
    title: schema.assets.title,
    kind: schema.assets.kind,
    isAiGenerated: schema.assets.isAiGenerated,
    originUrl: schema.assets.originUrl,
  }).from(schema.assets).where(and(eq(schema.assets.projectId, project.id), isNull(schema.assets.deletedAt)));
  const profiles = assets.length
    ? await db.select().from(schema.assetRightsProfiles).where(inArray(schema.assetRightsProfiles.assetId, assets.map((a) => a.id)))
    : [];
  const byAsset = new Map(profiles.map((row) => [row.assetId, row.profile]));
  const items = assets.map((asset) => ({
    assetId: asset.id,
    title: asset.title,
    kind: asset.kind,
    profile: byAsset.get(asset.id) ?? evaluateRights({
      assetId: asset.id,
      sourceType: inferSourceType({ isAiGenerated: asset.isAiGenerated, originUrl: asset.originUrl }),
      sourceUrl: asset.originUrl,
      kind: asset.kind,
      title: asset.title,
      isAiGenerated: asset.isAiGenerated,
    }),
  }));
  const summary = summarizeProjectRights(items.map((item) => item.profile ?? {
    rightsStatus: "UNKNOWN" as const,
  }));
  return { projectId: project.id, summary, items };
}

export async function projectDeliveryRights(input: {
  auth: AuthState;
  projectId: string;
  usageContext?: RightsUsageContext;
  assetIds?: string[];
}) {
  const listed = await listProjectRights(input);
  const usageContext = input.usageContext ?? "client_delivery";
  const scoped = input.assetIds?.length
    ? listed.items.filter((item) => input.assetIds!.includes(item.assetId))
    : listed.items;
  const summary = summarizeProjectRights(scoped.map((item) => item.profile ?? { rightsStatus: "UNKNOWN" as const }));
  const verdict = deliveryRightsVerdict({ usageContext, counts: summary.counts });
  return { ...summary, usageContext, ...verdict };
}

export async function listAssetRightsHistory(input: { auth: AuthState; assetId: string }) {
  const asset = await loadAssetOrThrow(input.auth, input.assetId);
  return db.select({
    id: schema.assetRightsChecks.id,
    rightsStatus: schema.assetRightsChecks.rightsStatus,
    fingerprint: schema.assetRightsChecks.fingerprint,
    trigger: schema.assetRightsChecks.trigger,
    createdAt: schema.assetRightsChecks.createdAt,
    snapshot: schema.assetRightsChecks.snapshot,
  }).from(schema.assetRightsChecks)
    .where(eq(schema.assetRightsChecks.assetId, asset.id))
    .orderBy(desc(schema.assetRightsChecks.createdAt));
}
