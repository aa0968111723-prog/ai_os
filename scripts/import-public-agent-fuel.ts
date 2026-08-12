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
    if (fs.statSync(full).isDirectory()) continue;
    if (!name.endsWith(".md")) continue;
    const content = fs.readFileSync(full, "utf8");
    const title = content.split("\n").find((l) => l.startsWith("#"))?.replace(/^#\s*/, "") || name;
    const key = `public.${category}.${name.replace(/\.md$/, "")}`;
    out.push({ key, category, title, content, tags: [category, "public"], source: full });
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
    .map((l) => JSON.parse(l) as Entry);
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
    console.log(` - ${e.key} (${e.category}) ${e.title.slice(0, 48)}`);
  }

  if (DRY) {
    console.log("\nDry-run only. Pass --apply to write to SYSTEM/SITE scope.");
    console.log("Refusing any --projectId targeting user projects.");
    return;
  }

  // Placeholder: wire to site-scoped table / system catalog.
  // Implementors must NOT insert into user project knowledge/assets.
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required for --apply");
    process.exit(1);
  }

  console.log("TODO: upsert into site-scoped public fuel table (idempotent by key).");
  console.log("This stub intentionally stops before writing user-scoped rows.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
