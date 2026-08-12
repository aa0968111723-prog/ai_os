/**
 * System-level import of public agent fuel into GLOBAL scope data_tables.
 * MUST NOT write into end-user project storage/quota.
 *
 * Usage:
 *   npx tsx scripts/import-public-agent-fuel.ts --dry-run
 *   npx tsx scripts/import-public-agent-fuel.ts --apply
 *
 * Env:
 *   DATABASE_URL – required for --apply
 *   PUBLIC_FUEL_CREATED_BY – uuid of a developer/system user (required for --apply)
 *
 * Safety:
 *   - scope is always "global"
 *   - refuses any --projectId
 *   - general-purpose materials (not limited to 挑戰營)
 */

import fs from "node:fs";
import path from "node:path";
import { eq, and, isNull } from "drizzle-orm";
import { connectDatabase, printTarget, runCli } from "./db/cli";
import { dataTables, dataRows } from "../server/db/schema/databases";

const ROOT = path.resolve(process.cwd(), "public-agent-fuel");
const TABLE_NAME = "公共Agent素材庫";
const APPLY = process.argv.includes("--apply");
const DRY = !APPLY;

type Entry = {
  key: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
};

const FIELDS = [
  { key: "key", label: "Key", type: "text" },
  { key: "category", label: "Category", type: "text" },
  { key: "title", label: "Title", type: "text" },
  { key: "content", label: "Content", type: "long_text" },
  { key: "tags", label: "Tags", type: "text" },
];

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
    out.push({ key, category, title, content, tags: [category, "public", "agent-fuel"] });
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
      return {
        key: row.key,
        category: row.category,
        title: row.title,
        content: row.content,
        tags: [...(row.tags || []), "public"],
      };
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
  if (process.argv.some((a) => a.startsWith("--projectId"))) {
    console.error("[public-agent-fuel] Refusing --projectId. Public fuel is global scope only.");
    process.exit(1);
  }

  const entries = collect();
  console.log(`[public-agent-fuel] found ${entries.length} entries`);
  for (const e of entries) {
    console.log(` - ${e.key} :: ${e.title.slice(0, 60)}`);
  }

  if (DRY) {
    console.log("\nDry-run only. Pass --apply to write to GLOBAL scope data_tables.");
    console.log("Materials are general-purpose (not limited to 挑戰營).");
    return;
  }

  const createdBy = process.env.PUBLIC_FUEL_CREATED_BY;
  if (!createdBy) {
    console.error("PUBLIC_FUEL_CREATED_BY (developer uuid) required for --apply");
    process.exit(1);
  }

  const { pool, database, connectionString } = await connectDatabase();
  printTarget(connectionString);

  try {
    const existing = await database
      .select()
      .from(dataTables)
      .where(and(eq(dataTables.scope, "global"), eq(dataTables.name, TABLE_NAME), isNull(dataTables.deletedAt)))
      .limit(1);

    let tableId: string;
    if (existing[0]) {
      tableId = existing[0].id;
      console.log(`[public-agent-fuel] using existing global table ${tableId}`);
      await database
        .update(dataTables)
        .set({
          description: "Public agent fuel for all users / assistants / MCP. System-managed.",
          fields: FIELDS,
          agentAccess: "read",
          memberWritable: false,
          updatedAt: new Date(),
        })
        .where(eq(dataTables.id, tableId));
    } else {
      const inserted = await database
        .insert(dataTables)
        .values({
          scope: "global",
          name: TABLE_NAME,
          description: "Public agent fuel for all users / assistants / MCP. System-managed.",
          fields: FIELDS,
          memberWritable: false,
          agentAccess: "read",
          createdBy,
        })
        .returning({ id: dataTables.id });
      tableId = inserted[0].id;
      console.log(`[public-agent-fuel] created global table ${tableId}`);
    }

    const existingRows = await database
      .select()
      .from(dataRows)
      .where(eq(dataRows.tableId, tableId));

    const byKey = new Map<string, (typeof existingRows)[number]>();
    for (const row of existingRows) {
      const key = (row.data as { key?: string })?.key;
      if (key) byKey.set(key, row);
    }

    let insertedCount = 0;
    let updatedCount = 0;

    for (const entry of entries) {
      const payload = {
        key: entry.key,
        category: entry.category,
        title: entry.title,
        content: entry.content,
        tags: entry.tags.join(","),
      };
      const prev = byKey.get(entry.key);
      if (prev) {
        await database
          .update(dataRows)
          .set({ data: payload, updatedBy: createdBy, updatedAt: new Date() })
          .where(eq(dataRows.id, prev.id));
        updatedCount += 1;
      } else {
        await database.insert(dataRows).values({
          tableId,
          data: payload,
          createdBy,
        });
        insertedCount += 1;
      }
    }

    console.log(
      `[public-agent-fuel] done. inserted=${insertedCount} updated=${updatedCount} total=${entries.length}`,
    );
    console.log(`[public-agent-fuel] global table: ${TABLE_NAME} (${tableId})`);
    console.log("[public-agent-fuel] agents can now read this table via MCP / data hub.");
  } finally {
    await pool.end();
  }
}

runCli(main);
