/**
 * TD-08 schema orphan report（軟性、best-effort）
 *
 * 在尚未加破壞性 FK 前，用計數報告常見「子列指到不存在父列」的狀況。
 * 不做修復、不 fail 資料；僅可觀測性。
 *
 * 用法：
 *   npm run report:orphans
 *   DATABASE_URL=postgres://... npm run report:orphans
 *
 * 行為：
 * - 未設 DATABASE_URL → 印 "skip no DATABASE_URL" 並 exit 0（不擋 CI）
 * - 有 DATABASE_URL → 連線；表不存在或單筆查詢失敗則跳過該檢查
 * - 報告完成後 exit 0（orphan 計數 > 0 也不視為失敗）
 */
import pg from "pg";

interface OrphanCheck {
  /** 穩定 id（給腳本／文件引用） */
  id: string;
  /** 人類可讀說明 */
  label: string;
  /** 需要同時存在的 public 表（缺一就 skip） */
  tables: string[];
  /** 回傳單一 COUNT 的 SQL；欄位名固定為 n */
  sql: string;
}

/**
 * 常見邏輯 FK（目前多半只有應用層維護，無 DB foreign key）。
 * 只列高價值、可穩定計數的模式；不掃 jsonb 內嵌 id。
 */
const CHECKS: OrphanCheck[] = [
  {
    id: "assets_missing_project",
    label: "assets with missing project",
    tables: ["assets", "projects"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM assets a
      WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = a.project_id)
    `,
  },
  {
    id: "assets_missing_group",
    label: "assets with missing group",
    tables: ["assets", "groups"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM assets a
      WHERE NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = a.group_id)
    `,
  },
  {
    id: "cost_ledger_missing_generation",
    label: "cost_ledger with non-null generation_id missing generation",
    tables: ["cost_ledger", "generations"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM cost_ledger c
      WHERE c.generation_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM generations g WHERE g.id = c.generation_id)
    `,
  },
  {
    id: "cost_ledger_missing_user",
    label: "cost_ledger with missing user",
    tables: ["cost_ledger", "users"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM cost_ledger c
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)
    `,
  },
  {
    id: "cost_ledger_missing_group",
    label: "cost_ledger with missing group",
    tables: ["cost_ledger", "groups"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM cost_ledger c
      WHERE NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = c.group_id)
    `,
  },
  {
    id: "generations_missing_project",
    label: "generations with missing project",
    tables: ["generations", "projects"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM generations g
      WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = g.project_id)
    `,
  },
  {
    id: "generations_missing_group",
    label: "generations with missing group",
    tables: ["generations", "groups"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM generations g
      WHERE NOT EXISTS (SELECT 1 FROM groups gr WHERE gr.id = g.group_id)
    `,
  },
  {
    id: "generations_missing_scene",
    label: "generations with non-null scene_id missing scene",
    tables: ["generations", "scenes"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM generations g
      WHERE g.scene_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM scenes s WHERE s.id = g.scene_id)
    `,
  },
  {
    id: "scenes_missing_project",
    label: "scenes with missing project",
    tables: ["scenes", "projects"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM scenes s
      WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = s.project_id)
    `,
  },
  {
    id: "scenes_missing_asset",
    label: "scenes with non-null asset_id missing asset",
    tables: ["scenes", "assets"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM scenes s
      WHERE s.asset_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id = s.asset_id)
    `,
  },
  {
    id: "projects_missing_group",
    label: "projects with missing group",
    tables: ["projects", "groups"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM projects p
      WHERE NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = p.group_id)
    `,
  },
  {
    id: "groups_missing_team",
    label: "groups with missing team",
    tables: ["groups", "teams"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM groups g
      WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = g.team_id)
    `,
  },
  {
    id: "group_members_missing_group",
    label: "group_members with missing group",
    tables: ["group_members", "groups"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM group_members gm
      WHERE NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = gm.group_id)
    `,
  },
  {
    id: "group_members_missing_user",
    label: "group_members with missing user",
    tables: ["group_members", "users"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM group_members gm
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = gm.user_id)
    `,
  },
  {
    id: "project_members_missing_project",
    label: "project_members with missing project",
    tables: ["project_members", "projects"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM project_members pm
      WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = pm.project_id)
    `,
  },
  {
    id: "knowledge_missing_project",
    label: "knowledge with missing project",
    tables: ["knowledge", "projects"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM knowledge k
      WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = k.project_id)
    `,
  },
  {
    id: "characters_missing_project",
    label: "characters with missing project",
    tables: ["characters", "projects"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM characters c
      WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = c.project_id)
    `,
  },
  {
    id: "workflow_runs_missing_project",
    label: "workflow_runs with missing project",
    tables: ["workflow_runs", "projects"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM workflow_runs w
      WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = w.project_id)
    `,
  },
  {
    id: "agent_runs_missing_project",
    label: "agent_runs with missing project",
    tables: ["agent_runs", "projects"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM agent_runs ar
      WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = ar.project_id)
    `,
  },
  {
    id: "agent_events_missing_run",
    label: "agent_events with missing agent_run",
    tables: ["agent_events", "agent_runs"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM agent_events e
      WHERE NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = e.run_id)
    `,
  },
  {
    id: "agent_step_effects_missing_run",
    label: "agent_step_effects with missing agent_run",
    tables: ["agent_step_effects", "agent_runs"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM agent_step_effects e
      WHERE NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = e.run_id)
    `,
  },
  {
    id: "data_rows_missing_table",
    label: "data_rows with missing data_table",
    tables: ["data_rows", "data_tables"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM data_rows r
      WHERE NOT EXISTS (SELECT 1 FROM data_tables t WHERE t.id = r.table_id)
    `,
  },
  {
    id: "data_files_missing_table",
    label: "data_files with missing data_table",
    tables: ["data_files", "data_tables"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM data_files f
      WHERE NOT EXISTS (SELECT 1 FROM data_tables t WHERE t.id = f.table_id)
    `,
  },
  {
    id: "export_jobs_missing_project",
    label: "export_jobs with missing project",
    tables: ["export_jobs", "projects"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM export_jobs j
      WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = j.project_id)
    `,
  },
  {
    id: "message_reactions_missing_message",
    label: "message_reactions with missing message",
    tables: ["message_reactions", "messages"],
    sql: `
      SELECT COUNT(*)::int AS n
      FROM message_reactions r
      WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = r.message_id)
    `,
  },
];

function redactTarget(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function listPublicTables(client: pg.PoolClient): Promise<Set<string>> {
  const res = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  return new Set(res.rows.map((r) => r.table_name));
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.log("skip no DATABASE_URL");
    process.exit(0);
  }

  const pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15_000,
    application_name: "ai-director-os-schema-orphan-report",
  });

  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    console.log(`[orphans] target: ${redactTarget(connectionString)}`);
    console.log(`[orphans] soft best-effort report (no FK enforcement; counts only)`);

    let existing: Set<string>;
    try {
      existing = await listPublicTables(client);
    } catch (err) {
      console.error(
        "[orphans] FAILED: cannot list public tables:",
        err instanceof Error ? err.message : err,
      );
      process.exitCode = 1;
      return;
    }

    console.log(`[orphans] public tables: ${existing.size}`);

    let ran = 0;
    let skipped = 0;
    let withOrphans = 0;
    let totalOrphans = 0;

    for (const check of CHECKS) {
      const missingTables = check.tables.filter((t) => !existing.has(t));
      if (missingTables.length > 0) {
        console.log(
          `[orphans] SKIP ${check.id}: missing table(s) ${missingTables.join(", ")}`,
        );
        skipped += 1;
        continue;
      }

      try {
        const res = await client.query<{ n: number }>(check.sql);
        const n = Number(res.rows[0]?.n ?? 0);
        ran += 1;
        totalOrphans += n;
        if (n > 0) withOrphans += 1;
        console.log(`[orphans] ${n === 0 ? "OK" : "HIT"} ${check.id}: ${n} — ${check.label}`);
      } catch (err) {
        skipped += 1;
        console.log(
          `[orphans] SKIP ${check.id}: query failed (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }

    console.log(
      `[orphans] done: ran=${ran} skipped=${skipped} patterns_with_hits=${withOrphans} total_orphan_rows≈${totalOrphans}`,
    );
    console.log(
      "[orphans] note: non-zero counts are informational; this script always exits 0 after a successful run",
    );
  } catch (err) {
    console.error("[orphans] FAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

void main();
