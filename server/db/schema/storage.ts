import { pgTable, text, timestamp, integer, boolean, bigint, jsonb, uuid, index } from "drizzle-orm/pg-core";

export const storageState = pgTable("storage_state", {
  key: text("key").primaryKey().notNull(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const storageAuditRuns = pgTable(
  "storage_audit_runs",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    mode: text("mode").default("sample").notNull(),
    checked: integer("checked").default(0).notNull(),
    missing: integer("missing").default(0).notNull(),
    corrupt: integer("corrupt").default(0).notNull(),
    recoveredQueued: integer("recovered_queued").default(0).notNull(),
    orphanFiles: integer("orphan_files").default(0).notNull(),
    orphanBytes: bigint("orphan_bytes", { mode: "number" }).default(0).notNull(),
    sample: jsonb("sample"),
  },
  (t) => [index("storage_audit_runs_finished_idx").on(t.finishedAt)],
);

export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    kind: text("kind").default("full").notNull(),
    ok: boolean("ok").default(false).notNull(),
    fileCount: integer("file_count").default(0).notNull(),
    totalBytes: bigint("total_bytes", { mode: "number" }).default(0).notNull(),
    target: text("target"),
    error: text("error"),
    triggeredBy: text("triggered_by"),
  },
  (t) => [index("backup_runs_ok_finished_idx").on(t.ok, t.finishedAt)],
);

export type StorageState = typeof storageState.$inferSelect;
export type StorageAuditRun = typeof storageAuditRuns.$inferSelect;
export type BackupRun = typeof backupRuns.$inferSelect;
