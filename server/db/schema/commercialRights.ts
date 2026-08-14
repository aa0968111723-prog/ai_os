/**
 * Asset commercial-rights profiles (evidence + risk assessment).
 * Not a second creative database: one profile per existing assets.id.
 */
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { LicenseType, RightsProfile, RightsSourceType, RightsStatus, RightsUsageContext } from "../../../shared/commercialRights";

export const assetRightsProfiles = pgTable("asset_rights_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  sourceType: text("source_type").$type<RightsSourceType>().notNull(),
  licenseType: text("license_type").$type<LicenseType>().notNull().default("unknown"),
  rightsStatus: text("rights_status").$type<RightsStatus>().notNull().default("UNKNOWN"),
  commercialUseAllowed: boolean("commercial_use_allowed"),
  trainingAllowed: boolean("training_allowed"),
  derivativesAllowed: boolean("derivatives_allowed"),
  attributionRequired: boolean("attribution_required"),
  editorialOnly: boolean("editorial_only").notNull().default(false),
  personalUseOnly: boolean("personal_use_only").notNull().default(false),
  confidence: integer("confidence").notNull().default(0),
  decisionVersion: text("decision_version").notNull(),
  usageContext: text("usage_context").$type<RightsUsageContext>().notNull().default("commercial_final"),
  licenseFingerprint: text("license_fingerprint"),
  profile: jsonb("profile").$type<RightsProfile>().notNull(),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  assetUq: uniqueIndex("asset_rights_profiles_asset_uq").on(t.assetId),
  projectStatusIdx: index("asset_rights_profiles_project_status_idx").on(t.projectId, t.rightsStatus),
  groupIdx: index("asset_rights_profiles_group_idx").on(t.groupId),
}));

export const assetRightsChecks = pgTable("asset_rights_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull(),
  assetId: uuid("asset_id").notNull(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  decisionVersion: text("decision_version").notNull(),
  rightsStatus: text("rights_status").$type<RightsStatus>().notNull(),
  fingerprint: text("fingerprint").notNull(),
  trigger: text("trigger").notNull(),
  snapshot: jsonb("snapshot").$type<RightsProfile>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  assetFingerprintUq: uniqueIndex("asset_rights_checks_asset_fingerprint_uq").on(t.assetId, t.fingerprint),
  assetCreatedIdx: index("asset_rights_checks_asset_created_idx").on(t.assetId, t.createdAt),
}));

export const assetRightsAttestations = pgTable("asset_rights_attestations", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull(),
  assetId: uuid("asset_id").notNull(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  kind: text("kind").notNull(),
  reason: text("reason").notNull(),
  excerpt: text("excerpt"),
  sourceUrl: text("source_url"),
  fingerprint: text("fingerprint"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  assetCreatedIdx: index("asset_rights_attestations_asset_created_idx").on(t.assetId, t.createdAt),
  groupCreatedIdx: index("asset_rights_attestations_group_created_idx").on(t.groupId, t.createdAt),
}));
