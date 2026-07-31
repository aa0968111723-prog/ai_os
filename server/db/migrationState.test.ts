import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalMigrationStatement,
  classifyMigrationState,
  isReRunnableCreateStatement,
  isReviewedLandingBackfillStatement,
  isRowDeduplicationStatement,
  LEGACY_ADOPTION_PENDING_TAGS,
  LEGACY_ADOPTION_THROUGH_TAG,
  loadMigrationManifest,
  redactDatabaseTarget,
  SUPERSEDED_MIGRATION_HASHES,
  verifyLegacyAdoptionBridge,
  type MigrationLedgerRow,
} from "./migrationState";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function ledgerRows() {
  const manifest = loadMigrationManifest();
  const rows: MigrationLedgerRow[] = manifest.entries.map((entry, index) => ({
    id: index + 1,
    hash: entry.hash,
    created_at: String(entry.createdAt),
  }));
  return { manifest, rows };
}

describe("migration ledger classification", () => {
  it("distinguishes an empty database from an untracked legacy database", () => {
    const { manifest } = ledgerRows();
    expect(classifyMigrationState([], false, [], manifest).kind).toBe("empty-unmigrated");
    expect(classifyMigrationState(["users"], false, [], manifest).kind).toBe("legacy-untracked");
  });

  it("accepts only an exact, contiguous migration prefix", () => {
    const { manifest, rows } = ledgerRows();
    expect(classifyMigrationState(["users"], true, rows.slice(0, 1), manifest).kind).toBe("pending");
    expect(classifyMigrationState(["users"], true, rows, manifest).kind).toBe("ready");

    const nonPrefix = classifyMigrationState(["users"], true, rows.slice(1), manifest);
    expect(nonPrefix.kind).toBe("invalid");
    expect(nonPrefix.errors.join(" ")).toContain("不是連續前綴");
  });

  it("fails closed when an applied file hash changes or the database is ahead", () => {
    const { manifest, rows } = ledgerRows();
    const changedHash = rows.map((row, index) => (index === 0 ? { ...row, hash: "tampered" } : row));
    expect(classifyMigrationState(["users"], true, changedHash, manifest).kind).toBe("invalid");

    const ahead = [...rows, { id: 99, hash: "future", created_at: "9999999999999" }];
    expect(classifyMigrationState(["users"], true, ahead, manifest).kind).toBe("invalid");
  });

  it("still trusts a database that applied a superseded revision of a migration", () => {
    const { manifest, rows } = ledgerRows();
    const [tag, hashes] = Object.entries(SUPERSEDED_MIGRATION_HASHES)[0]!;
    const entry = manifest.entries.find((candidate) => candidate.tag === tag)!;
    // The corrected file must actually differ, otherwise this guard is vacuous.
    expect(hashes).not.toContain(entry.hash);

    const superseded = rows.map((row) =>
      row.created_at === String(entry.createdAt) ? { ...row, hash: hashes[0]! } : row,
    );
    expect(classifyMigrationState(["users"], true, superseded, manifest).kind).toBe("ready");

    const unrelated = rows.map((row) =>
      row.created_at === String(entry.createdAt) ? { ...row, hash: "not-a-known-revision" } : row,
    );
    expect(classifyMigrationState(["users"], true, unrelated, manifest).kind).toBe("invalid");
  });
});

describe("migration manifest validation", () => {
  it("canonicalizes idempotent index creation for drift comparison", () => {
    expect(
      canonicalMigrationStatement(
        'CREATE UNIQUE INDEX IF NOT EXISTS "reads_uq" ON "reads" ("user_id");',
      ),
    ).toBe('CREATE UNIQUE INDEX "reads_uq" ON "reads" ("user_id")');
  });

  it("hashes SQL and rejects a non-monotonic journal", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "aios-migrations-"));
    temporaryDirectories.push(directory);
    mkdirSync(path.join(directory, "meta"));
    writeFileSync(path.join(directory, "0000_first.sql"), "select 1;\n");
    writeFileSync(path.join(directory, "0001_second.sql"), "select 2;\n");
    writeFileSync(
      path.join(directory, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          { idx: 0, version: "7", when: 200, tag: "0000_first", breakpoints: true },
          { idx: 1, version: "7", when: 100, tag: "0001_second", breakpoints: true },
        ],
      }),
    );
    expect(() => loadMigrationManifest(directory)).toThrow("嚴格遞增");
  });

  /**
   * 0018 shipped two statements in one chunk because the separator was missing.
   * Every gate downstream splits on `--> statement-breakpoint`, so the pair was
   * canonicalized into a single string that no drift plan can ever match — the
   * legacy bridge then read it as two unexplained drift statements and refused
   * to adopt. Nothing about that is specific to 0018, so guard the whole folder.
   */
  it("keeps every migration to one statement per breakpoint-delimited chunk", () => {
    const offenders = loadMigrationManifest().entries.flatMap((entry) =>
      entry.sql
        .split("--> statement-breakpoint")
        .map(canonicalMigrationStatement)
        .filter((statement) => statement.includes(";"))
        .map((statement) => `${entry.tag}: ${statement.slice(0, 80)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("never includes a database password in its display target", () => {
    const target = redactDatabaseTarget("postgresql://operator:top-secret@db.internal:5432/product");
    expect(target).toBe("postgresql://operator@db.internal:5432/product");
    expect(target).not.toContain("top-secret");
  });
});

describe("legacy migration adoption bridge", () => {
  const manifest = loadMigrationManifest();
  const pending = manifest.entries.filter((entry) =>
    LEGACY_ADOPTION_PENDING_TAGS.includes(entry.tag as (typeof LEGACY_ADOPTION_PENDING_TAGS)[number]),
  );
  const pendingStatements = pending.flatMap((entry) =>
    entry.sql
      .split("--> statement-breakpoint")
      .map(canonicalMigrationStatement)
      .filter(Boolean),
  );
  // Schema drift only ever reports DDL; the row de-duplication that precedes a
  // new unique index and 0022's reviewed landing-state backfill change rows,
  // so they never appear in a drift plan.
  const expectedStatements = pendingStatements.filter(
    (statement) => !isRowDeduplicationStatement(statement) && !isReviewedLandingBackfillStatement(statement),
  );

  it("recognizes de-duplication only as a keyed self-join delete", () => {
    expect(pendingStatements.length).toBeGreaterThan(expectedStatements.length);
    expect(
      isRowDeduplicationStatement(
        'DELETE FROM "team_members" a USING "team_members" b WHERE a."user_id" = b."user_id"',
      ),
    ).toBe(true);
    // A different table on either side, or an unconditional purge, is not the
    // reviewed idiom and must keep failing the bridge gate.
    expect(
      isRowDeduplicationStatement(
        'DELETE FROM "team_members" a USING "users" b WHERE a."user_id" = b."id"',
      ),
    ).toBe(false);
    expect(isRowDeduplicationStatement('DELETE FROM "team_members"')).toBe(false);
  });

  it("recognizes the landing backfill only in its reviewed 0022 shape", () => {
    // 0022 實際出貨的語句（canonical 形式）必須被放行
    const shipped = pendingStatements.find((statement) => /^UPDATE assets /i.test(statement));
    expect(shipped).toBeDefined();
    expect(isReviewedLandingBackfillStatement(shipped!)).toBe(true);
    // 改動 SET 清單、放寬 WHERE、或換張表都不是經審查的語句，必須照舊擋下人工審查
    expect(isReviewedLandingBackfillStatement("UPDATE assets SET land_state='pending' WHERE true")).toBe(false);
    expect(
      isReviewedLandingBackfillStatement(
        "UPDATE assets SET land_state='pending',land_next_try_at=now(),origin_url=url WHERE storage_path IS NULL",
      ),
    ).toBe(false);
    expect(isReviewedLandingBackfillStatement('UPDATE "users" SET name=NULL')).toBe(false);
  });

  it("accepts reviewed DDL the legacy database already carries when it re-runs as a no-op", () => {
    // The former pushSchema path left 0004's and 0005's indexes in place, so
    // they are absent from drift while their tables are still missing — the
    // exact shape the live database turned out to be in.
    const alreadyCreated = expectedStatements.filter((statement) =>
      /^CREATE (?:UNIQUE )?INDEX "(?:approvals_project_status_idx|generations_group_idx|dm_reads_user_peer_uq|group_members_group_user_uq|message_reactions_msg_user_emoji_uq|message_reads_user_project_uq|project_members_project_user_uq|team_members_team_user_uq)"/.test(statement),
    );
    expect(alreadyCreated).toHaveLength(8);

    const result = verifyLegacyAdoptionBridge(
      manifest,
      {
        hasDataLoss: false,
        warnings: [],
        statements: expectedStatements.filter((statement) => !alreadyCreated.includes(statement)),
      },
      LEGACY_ADOPTION_THROUGH_TAG,
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.alreadyPresent).toBe(8);
  });

  it("rejects absent reviewed DDL that cannot be safely re-run", () => {
    // Same situation, but the migration lacks IF NOT EXISTS, so re-running it
    // would fail against the existing object rather than no-op.
    const fragile = { ...manifest, entries: manifest.entries.map((entry) =>
      entry.tag === "0004_query_indexes"
        ? { ...entry, sql: entry.sql.replace(/ IF NOT EXISTS/g, "") }
        : entry,
    ) };
    const fragileStatements = fragile.entries
      .filter((entry) => LEGACY_ADOPTION_PENDING_TAGS.includes(entry.tag as (typeof LEGACY_ADOPTION_PENDING_TAGS)[number]))
      .flatMap((entry) => entry.sql.split("--> statement-breakpoint").map(canonicalMigrationStatement).filter(Boolean))
      .filter((statement) => !isRowDeduplicationStatement(statement));

    const result = verifyLegacyAdoptionBridge(
      fragile,
      {
        hasDataLoss: false,
        warnings: [],
        statements: fragileStatements.filter(
          (statement) => !/^CREATE INDEX "(?:approvals_project_status_idx|generations_group_idx)"/.test(statement),
        ),
      },
      LEGACY_ADOPTION_THROUGH_TAG,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/無法安全重跑/);
  });

  it("marks CREATE statements re-runnable only when they are guarded", () => {
    expect(isReRunnableCreateStatement('CREATE INDEX IF NOT EXISTS "a" ON "b" ("c")')).toBe(true);
    expect(isReRunnableCreateStatement('CREATE UNIQUE INDEX IF NOT EXISTS "a" ON "b" ("c")')).toBe(true);
    expect(isReRunnableCreateStatement('CREATE TABLE IF NOT EXISTS "a" ("b" text)')).toBe(true);
    expect(isReRunnableCreateStatement('ALTER TABLE "a" ADD COLUMN IF NOT EXISTS "b" text')).toBe(true);
    expect(isReRunnableCreateStatement('CREATE INDEX "a" ON "b" ("c")')).toBe(false);
    expect(isReRunnableCreateStatement('CREATE TABLE "a" ("b" text)')).toBe(false);
    expect(isReRunnableCreateStatement('ALTER TABLE "a" ADD COLUMN "b" text')).toBe(false);
  });

  it("accepts only the reviewed additive drift after 0001", () => {
    const result = verifyLegacyAdoptionBridge(
      manifest,
      { hasDataLoss: false, warnings: [], statements: [...expectedStatements].reverse() },
      LEGACY_ADOPTION_THROUGH_TAG,
    );
    expect(result.ok).toBe(true);
    expect(result.throughIndex).toBe(1);
    expect(result.adoptionFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects extra drift, warnings, destructive flags, and arbitrary prefixes", () => {
    const result = verifyLegacyAdoptionBridge(
      manifest,
      {
        hasDataLoss: true,
        warnings: ["column rewrite"],
        statements: [...expectedStatements, 'ALTER TABLE "users" DROP COLUMN "email";'],
      },
      LEGACY_ADOPTION_THROUGH_TAG,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/資料損失/);
    expect(result.errors.join(" ")).toMatch(/警告/);
    expect(result.errors.join(" ")).toMatch(/非 bridge 預期 drift/);

    const wrongPrefix = verifyLegacyAdoptionBridge(
      manifest,
      { hasDataLoss: false, warnings: [], statements: expectedStatements },
      "0000_0000_baseline",
    );
    expect(wrongPrefix.ok).toBe(false);
  });
});
