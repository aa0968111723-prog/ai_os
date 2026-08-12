/**
 * System-level import of public agent fuel.
 * MUST NOT write into end-user project storage/quota.
 *
 * Usage:
 *   npx tsx scripts/import-public-agent-fuel.ts --dry-run
 *   npx tsx scripts/import-public-agent-fuel.ts --apply
 *
 * Env:
 *   DATABASE_URL  – app database
 *   PUBLIC_FUEL_SCOPE=site  – force site-wide target
 *
 * Design goals:
 * - General public agent materials (NOT limited to any single project e.g. 挑戰營)
 * - Idempotent upsert by key
 * - Agents / MCP / assistants can read after system import
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "public-agent-fuel");
const APPLY = process.argv.includes("--apply");
const DRY = process.argv.includes("--dry-run") || !APPLY;

type Entry = {
  key: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
};

function walkMarkdown(dir: string, category: string): Entry[] {
  if (!fs.existsSync(dir)) return [];
  const out: Entry[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      out.push(...walkMarkdown(full, category));
      continue;
    }
    if (!name.endsWith(".md")) continue;
    const content = fs.readFileSync(full, "utf8");
    const title =
      content.split("\n").find((l) => l.startsWith("#"))?.replace(/^#\s*/, "") || name;
    const key = `public.${category}.${name.replace(/\.md$/, "")}`;
    out.push({
      key,
      category,
      title,
      content,
      tags: [category, "public", "agent-fuel"],
      source: full,
    });
  }
  return out;
}

function loadJsonl(file: string): Entry[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const row = JSON.parse(l) as Entry;
      return { ...row, source: file, tags: [...(row.tags || []), "public"] };
    });
}

function collect(): Entry[] {
  return [
    ...walkMarkdown(path.join(ROOT, "knowledge"), "knowledge"),
    ...walkMarkdown(path.join(ROOT, "catalogs"), "catalog"),
    ...loadJsonl(path.join(ROOT, "prompts", "catalog.jsonl")),
  ];
}

async function main() {
  const entries = collect();
  console.log(`[public-agent-fuel] found ${entries.length} entries`);
  for (const e of entries) {
    console.log(` - ${e.key} (${e.category}) ${e.title.slice(0, 64)}`);
  }

  if (DRY) {
    console.log("\nDry-run only. Pass --apply to write to SYSTEM/SITE scope.");
    console.log("Refusing any --projectId targeting user projects.");
    console.log("Public fuel is general-purpose (not limited to 挑戰營).");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required for --apply");
    process.exit(1);
  }

  // Safety: never accept a user projectId for this importer.
  if (process.argv.some((a) => a.startsWith("--projectId"))) {
    console.error("Refusing --projectId. Public fuel must stay system/site scoped.");
    process.exit(1);
  }

  // TODO: upsert into site-scoped public fuel / system knowledge catalog (idempotent by key).
  // Wire to the real system table once site-scoped knowledge store is available.
  console.log("TODO: upsert into site-scoped public fuel table (idempotent by key).");
  console.log(`Would write ${entries.length} entries to SYSTEM scope only.");
  console.log("This stub intentionally stops before writing user-scoped rows.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
