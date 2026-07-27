import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalMigrationStatement,
  classifyMigrationState,
  LEGACY_ADOPTION_PENDING_TAGS,
  LEGACY_ADOPTION_THROUGH_TAG,
  loadMigrationManifest,
  redactDatabaseTarget,
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
});

describe("migration manifest validation", () => {
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
  const expectedStatements = pending.flatMap((entry) =>
    entry.sql
      .split("--> statement-breakpoint")
      .map(canonicalMigrationStatement)
      .filter(Boolean),
  );

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
