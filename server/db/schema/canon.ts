/**
 * Team Canon（master plan §2–§4）：組層級的長期創作記憶。
 *
 * canon_entries 是身份與治理欄位；內容真相在不可變的 canon_versions.payload。
 * 專案透過 project_canon_pins 引用（pin），不 copy——本地卡片只是 runtime handle，
 * 升級（applyCanonUpgrade）是明確動作，不 silent-update。
 */
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import type {
  CanonKind,
  CanonLocalEntityKind,
  CanonReuseScope,
  CanonStatus,
  CanonVersionCreatedReason,
  CanonVersionEvent,
  CanonVersionPayload,
} from "../../../shared/teamCanon";

export const canonEntries = pgTable("canon_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  kind: text("kind").$type<CanonKind>().notNull(),
  name: text("name").notNull(),
  summary: text("summary"),
  status: text("status").$type<CanonStatus>().notNull().default("active"),
  /** 造型 Canon → 所屬角色 Canon（跨專案 pin 造型時要先 pin 角色） */
  parentCanonId: uuid("parent_canon_id"),
  /** Provenance：從哪個專案的哪張卡升上來的（可為 null＝直接建立的 style/voice 等） */
  sourceProjectId: uuid("source_project_id"),
  sourceEntityKind: text("source_entity_kind").$type<CanonLocalEntityKind>(),
  sourceEntityId: uuid("source_entity_id"),
  /** rights／重用治理（master plan §18）：private＝rights 未確認前只有來源專案可用 */
  reuseScope: text("reuse_scope").$type<CanonReuseScope>().notNull().default("team"),
  trainingAllowed: boolean("training_allowed").notNull().default(false),
  generationAllowed: boolean("generation_allowed").notNull().default(true),
  rightsNote: text("rights_note"),
  /**
   * Production 版本指標——「哪一版是 production」只有這一個真相；
   * canon_versions 沒有 status='production'，避免指標與版本列兩套講法。
   */
  productionVersionId: uuid("production_version_id"),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  groupKindIdx: index("canon_entries_group_kind_idx").on(t.groupId, t.kind),
  groupStatusIdx: index("canon_entries_group_status_idx").on(t.groupId, t.status),
  // 同一張專案卡只會升成一個 Canon（createCanonFromEntity 冪等的依據）
  sourceUq: uniqueIndex("canon_entries_source_uq").on(t.groupId, t.sourceEntityKind, t.sourceEntityId),
  // 0078：project canon（無來源卡）以 group+kind+name 唯一——createProjectCanon 的
  // 名稱冪等靠它成為資料庫保證（select-then-insert race 的第二筆會撞這裡）
  projectKindNameUq: uniqueIndex("canon_entries_project_kind_name_uq")
    .on(t.groupId, t.kind, t.name)
    .where(sql`${t.sourceEntityId} IS NULL`),
}));

export const canonVersions = pgTable("canon_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonId: uuid("canon_id").notNull(),
  groupId: uuid("group_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  parentVersionId: uuid("parent_version_id"),
  fingerprint: text("fingerprint").notNull(),
  payload: jsonb("payload").$type<CanonVersionPayload>().notNull(),
  /** 訓練連結（若這版來自訓練成果） */
  datasetFingerprint: text("dataset_fingerprint"),
  adapterRef: text("adapter_ref"),
  trainingJobId: uuid("training_job_id"),
  /** archived＝退役版本；「production」由 canon_entries.production_version_id 決定，不在這裡 */
  archived: boolean("archived").notNull().default(false),
  createdReason: text("created_reason").$type<CanonVersionCreatedReason>().notNull().default("manual"),
  evaluation: jsonb("evaluation").$type<Record<string, number> | null>(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  canonVersionUq: uniqueIndex("canon_versions_canon_version_uq").on(t.canonId, t.versionNumber),
  // 同內容不重複開版（addCanonVersion 冪等的依據）
  canonFingerprintUq: uniqueIndex("canon_versions_canon_fingerprint_uq").on(t.canonId, t.fingerprint),
  canonIdx: index("canon_versions_canon_idx").on(t.canonId, t.createdAt),
}));

/** Promote／rollback／rights 歷史（master plan §2「promote / rollback history」） */
export const canonVersionEvents = pgTable("canon_version_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonId: uuid("canon_id").notNull(),
  versionId: uuid("version_id"),
  event: text("event").$type<CanonVersionEvent>().notNull(),
  /** promote 時記前一個 production 版本 id；rollback 時記被退掉的版本 id */
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  actor: uuid("actor"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  canonCreatedIdx: index("canon_version_events_canon_created_idx").on(t.canonId, t.createdAt),
}));

export const projectCanonPins = pgTable("project_canon_pins", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  canonId: uuid("canon_id").notNull(),
  pinnedVersionId: uuid("pinned_version_id").notNull(),
  /** 專案本地 handle（characters／character_looks／scene_presets／props 的列）；style 等無本地卡＝null */
  localEntityKind: text("local_entity_kind").$type<CanonLocalEntityKind>(),
  localEntityId: uuid("local_entity_id"),
  pinnedBy: uuid("pinned_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectCanonUq: uniqueIndex("project_canon_pins_project_canon_uq").on(t.projectId, t.canonId),
  // 一張本地卡只能代表一個 Canon（升級同步才不會互洗）
  projectLocalUq: uniqueIndex("project_canon_pins_project_local_uq").on(t.projectId, t.localEntityKind, t.localEntityId),
  projectIdx: index("project_canon_pins_project_idx").on(t.projectId),
  canonIdx: index("project_canon_pins_canon_idx").on(t.canonId),
}));
