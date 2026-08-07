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
  isSupersededMigrationHash,
  LEGACY_ADOPTION_PENDING_TAGS,
  LEGACY_ADOPTION_THROUGH_TAG,
  loadMigrationManifest,
  redactDatabaseTarget,
  SchemaDriftInspectError,
  verifyLegacyAdoptionBridge,
  type MigrationLedgerRow,
} from "./migrationState";
import { MIGRATION_REVISIONS } from "./migrationRevisions";

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
    const [tag, revisions] = Object.entries(MIGRATION_REVISIONS).find(([, list]) => list.length > 1)!;
    const entry = manifest.entries.find((candidate) => candidate.tag === tag)!;
    // The corrected file must actually differ, otherwise this guard is vacuous.
    expect(revisions[0]).not.toBe(entry.hash);

    const superseded = rows.map((row) =>
      row.created_at === String(entry.createdAt) ? { ...row, hash: revisions[0]! } : row,
    );
    expect(classifyMigrationState(["users"], true, superseded, manifest).kind).toBe("ready");

    const unrelated = rows.map((row) =>
      row.created_at === String(entry.createdAt) ? { ...row, hash: "not-a-known-revision" } : row,
    );
    expect(classifyMigrationState(["users"], true, unrelated, manifest).kind).toBe("invalid");
  });

  /**
   * The live databases had applied 0029 before 0025's correction rewrote its
   * comment header, and only the raw file is hashed — so every one of them read
   * as tampered history and the service refused to boot. Pin the revision that
   * was actually deployed: the statements never changed, so a ledger carrying it
   * is trustworthy, and dropping it from the table would break booting again.
   */
  it("still trusts the databases that applied 0029 before its comment-only correction", () => {
    const deployed = "ec2496a3bce3cd11dcf1a4d3b9f65af51e52b2695defb38f5ffefe8a88343083";
    expect(isSupersededMigrationHash("0029_prop_ownership", deployed)).toBe(true);

    const { manifest, rows } = ledgerRows();
    const entry = manifest.entries.find((candidate) => candidate.tag === "0029_prop_ownership")!;
    expect(entry.hash).not.toBe(deployed);
    const asDeployed = rows.map((row) =>
      row.created_at === String(entry.createdAt) ? { ...row, hash: deployed } : row,
    );
    expect(classifyMigrationState(["users"], true, asDeployed, manifest).kind).toBe("ready");
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

  /**
   * Editing a released migration — even by one comment byte, which is how 0029
   * broke — changes the hash the ledger recorded when it was applied, so every
   * database that already ran it reads as tampered history and the service stops
   * booting. Nothing used to notice at review time. Pin each file to the last
   * revision recorded for it: correcting one now fails here until the new hash is
   * appended, and appending it is exactly what retires the previous hash, so the
   * accepted-revision set can never fall behind the files again.
   */
  it("pins every released migration to the last revision recorded for it", () => {
    const manifest = loadMigrationManifest();
    const drifted = manifest.entries
      .filter((entry) => MIGRATION_REVISIONS[entry.tag]?.at(-1) !== entry.hash)
      .map((entry) => `${entry.tag}: 登記 ${MIGRATION_REVISIONS[entry.tag]?.at(-1) ?? "(缺)"}，實際 ${entry.hash}`);
    expect(drifted).toEqual([]);

    const stale = Object.keys(MIGRATION_REVISIONS).filter(
      (tag) => !manifest.entries.some((entry) => entry.tag === tag),
    );
    expect(stale).toEqual([]);
  });

  /**
   * A revision list is read as "oldest first, current last", so a hash appended
   * in the wrong place would quietly mark the current file as superseded and
   * accept a ledger that no longer matches anything on disk.
   */
  it("records migration revisions oldest first, with no repeats", () => {
    for (const [tag, revisions] of Object.entries(MIGRATION_REVISIONS)) {
      expect(revisions.length, tag).toBeGreaterThan(0);
      expect(new Set(revisions).size, tag).toBe(revisions.length);
      expect(revisions.every((hash) => /^[0-9a-f]{64}$/.test(hash)), tag).toBe(true);
      expect(isSupersededMigrationHash(tag, revisions.at(-1)!), tag).toBe(false);
    }
  });

  it("never includes a database password in its display target", () => {
    const target = redactDatabaseTarget("postgresql://operator:top-secret@db.internal:5432/product");
    expect(target).toBe("postgresql://operator@db.internal:5432/product");
    expect(target).not.toContain("top-secret");
  });

  it("does not put 0036 (non-additive PK rewrite) into the legacy adoption bridge", () => {
    // 0036 DROP/ADD PK cannot be re-run as IF NOT EXISTS bridge DDL.
    expect(LEGACY_ADOPTION_PENDING_TAGS).not.toContain("0036_community_likes_surrogate_pk");
    const manifest = loadMigrationManifest();
    expect(manifest.entries.some((e) => e.tag === "0036_community_likes_surrogate_pk")).toBe(true);
  });

  it("names SchemaDriftInspectError so start logs are not mistaken for invalid ledger", () => {
    const err = new SchemaDriftInspectError("schema introspect 失敗\nFailed query: SELECT conname AS primary_key", {
      failedQuery: "SELECT conname AS primary_key",
    });
    expect(err.name).toBe("SchemaDriftInspectError");
    expect(err.message).toContain("schema introspect");
    expect(err.failedQuery).toContain("conname");
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
  // Schema drift only ever reports DDL, so the reviewed row-changing statements
  // never appear in a drift plan: the de-duplication that precedes a new unique
  // index (0005), and 0023's landing-state backfill.
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
    // 8 項來自 bridge 前綴；另外 17 項來自 bridge 之後的 0036／0037／0038／0039／0040／0041／0042／0043
    // ——這份合成 drift 只放了 bridge 的語句，那幾支的最終形狀自然不在裡面。它們都寫了
    // IF NOT EXISTS，重跑是 no-op，所以同樣計入 alreadyPresent 而不是判成缺漏。
    //（0038 是 scenes 的兩個環境音欄位，一支 migration 兩句 ADD COLUMN；
    //   0039 是 project_share_links 的建表與建索引，同樣兩句；
    //   0040 是 scenes 的兩個修剪欄位，同樣兩句 ADD COLUMN IF NOT EXISTS；
    //   0041 是 push_subscriptions 的裝置細節欄位，單句 ADD COLUMN IF NOT EXISTS；
    //   0042 是 community_posts 的三個分類欄位＋兩個索引，五句皆 IF NOT EXISTS；
    //   0043 是 content_attachments 的建表與兩個索引，三句；
    //   0044 是 scenes 的動作走位欄位，單句 ADD COLUMN IF NOT EXISTS；
    //   0045 是 scenes 的對白欄位，單句 ADD COLUMN IF NOT EXISTS；
    //   0046 是 scenes 的配樂標記與配樂音檔，兩句 ADD COLUMN IF NOT EXISTS；
    //   0047 是 notifications 的建表與三個索引，四句皆 IF NOT EXISTS——
    //   逐句確認過重跑無害：CREATE TABLE IF NOT EXISTS 一句、
    //   CREATE UNIQUE INDEX IF NOT EXISTS 一句、CREATE INDEX IF NOT EXISTS 兩句，
    //   沒有任何 ALTER 既有欄位或資料搬移；
    //   0048 是 messages 的六個標注欄位與兩個索引，八句皆 IF NOT EXISTS——
    //   六句 ADD COLUMN IF NOT EXISTS 加兩句 CREATE INDEX IF NOT EXISTS，
    //   同樣沒有改動既有欄位型別，也沒有任何資料搬移；
    //   0049 是 ai_site_trace_sessions 的建表與兩個索引，三句皆 IF NOT EXISTS——
    //   純新增全站助手軌跡分表，不動任何既有表、欄位或資料，重跑是 no-op。）
    //
    // 這個數字刻意寫死、不動態算：新增一支 migration 就要有人回來改這一行，
    // 而改之前得先確認新語句真的是「重跑無害」——動態計算會讓非冪等的 DDL 悄悄溜過去。
    expect(result.alreadyPresent).toBe(8 + 36);
  });

  it("bridge 之後的純新增 migration 不算「非 bridge 預期 drift」", () => {
    // 實機踩過：0037 只是 ADD COLUMN IF NOT EXISTS，但因為它排在 bridge 前綴之後，
    // 舊版把它造成的 drift 判成未經審查的分歧，legacy DB 從此永遠 adopt 不了。
    const postBridge = manifest.entries.filter((entry) =>
      ["0036_community_likes_surrogate_pk", "0037_project_cover"].includes(entry.tag),
    );
    expect(postBridge).toHaveLength(2);
    const postBridgeDdl = postBridge
      .flatMap((entry) => entry.sql.split("--> statement-breakpoint").map(canonicalMigrationStatement))
      .filter((statement) => /^ALTER TABLE "projects" ADD COLUMN "cover_asset_id"/.test(statement));
    expect(postBridgeDdl).toHaveLength(1);

    const result = verifyLegacyAdoptionBridge(
      manifest,
      { hasDataLoss: false, warnings: [], statements: [...expectedStatements, ...postBridgeDdl] },
      LEGACY_ADOPTION_THROUGH_TAG,
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("CREATE TABLE 的表層具名主鍵與內嵌主鍵視為同一句", () => {
    // 手寫 migration 慣用 CONSTRAINT "x_pkey" PRIMARY KEY ("id")，drizzle 產生的 drift
    // 一律內嵌。逐字比對會讓同一張表同時被判成「非預期 drift」與「缺漏」（0035 踩過）。
    const named = canonicalMigrationStatement(
      'CREATE TABLE IF NOT EXISTS "community_likes" (\n'
      + '  "id" uuid DEFAULT gen_random_uuid() NOT NULL,\n'
      + '  "post_id" uuid NOT NULL,\n'
      + '  CONSTRAINT "community_likes_pkey" PRIMARY KEY ("id")\n);',
    );
    const inline = canonicalMigrationStatement(
      'CREATE TABLE "community_likes" (\n'
      + '\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,\n'
      + '\t"post_id" uuid NOT NULL\n);',
    );
    expect(named).toBe(inline);
    expect(named).toContain('PRIMARY KEY("id")');
    // 主鍵資訊不能在正規化時被丟掉：欄位相同但主鍵不同的兩張表仍要判成不同
    expect(named).not.toBe(
      canonicalMigrationStatement(
        'CREATE TABLE "community_likes" ("id" uuid DEFAULT gen_random_uuid() NOT NULL,"post_id" uuid PRIMARY KEY NOT NULL);',
      ),
    );
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

/**
 * 防呆：bridge 比對的是「整表 DDL」——一張在 pending 批次內被 CREATE 出來的表，
 * 若欄位是靠同批次的另一份 migration 用 ALTER 補，drift 計畫會出一份「含全部欄位」的
 * CREATE TABLE，和 migration 檔裡那份對不起來，migration job 就會整個紅掉。
 * 0022 的註記寫過這條規則、0029 又踩了一次——改用測試釘住，別再靠人記得。
 */
describe("pending 批次內新建的表，欄位必須寫在 CREATE TABLE 裡", () => {
  const manifest = loadMigrationManifest();
  const pending = manifest.entries.filter((entry) =>
    LEGACY_ADOPTION_PENDING_TAGS.includes(entry.tag as (typeof LEGACY_ADOPTION_PENDING_TAGS)[number]),
  );

  /** pending 批次內被 CREATE 的表 → 該 CREATE TABLE 的欄位定義原文 */
  const createdInBatch = new Map<string, string>();
  for (const entry of pending) {
    for (const match of entry.sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"\s*\(([\s\S]*?)\n\)/gi)) {
      createdInBatch.set(match[1]!, match[2]!);
    }
  }

  it("同批次的 ALTER 不會補上該表 CREATE TABLE 缺少的欄位", () => {
    const offenders: string[] = [];
    for (const entry of pending) {
      for (const match of entry.sql.matchAll(
        /ALTER TABLE "([^"]+)" ADD COLUMN (?:IF NOT EXISTS )?"([^"]+)"/gi,
      )) {
        const [, table, column] = match;
        const columns = createdInBatch.get(table!);
        if (columns === undefined) continue; // 表在 baseline 就有 → ALTER 才是正解
        if (!new RegExp(`"${column}"`).test(columns)) {
          offenders.push(`${entry.tag}: ${table}.${column} 沒寫進 CREATE TABLE`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("認得出這批表確實被掃到（規則沒有因為 regex 失效而空轉）", () => {
    expect(createdInBatch.has("props")).toBe(true);
    expect(createdInBatch.get("props")).toMatch(/"owner_kind"/);
  });
});
