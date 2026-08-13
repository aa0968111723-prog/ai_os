import { TRPCError } from "@trpc/server";
import type { AssistantWirePageContext } from "../../shared/assistantPageContext";
import type { AuthState } from "./auth";
import { callTool } from "./mcp";
import { assistantResourceHealthSnapshot, recordAssistantResourceHealth } from "./assistantResourceHealth";
import { rankHybridItems } from "./hybridRetrieval";
import {
  prioritizeAssistantDatabases,
  retrieveAssistantDatabaseEvidence,
  type AssistantReadableDatabase,
} from "./assistantDatabaseEvidence";
import { getAgentReadableTable, listMcpDatabases } from "./databaseMcp";
import type { DataField } from "../../shared/databaseFields";

export const RESOURCE_OUTCOMES = [
  "OK",
  "EMPTY",
  "TIMEOUT",
  "AUTH_DENIED",
  "NOT_AVAILABLE",
  "TOOL_ERROR",
] as const;
export type ResourceOutcome = (typeof RESOURCE_OUTCOMES)[number];

export const ASSISTANT_RESOURCE_KEYS = [
  "project_status",
  "knowledge",
  "decisions",
  "notes",
  "tasks",
  "schedule",
  "storyboard",
  "assets",
  "generations",
  "agent_runs",
  "watches",
  "collaboration",
  "database",
] as const;
export type AssistantResourceKey = (typeof ASSISTANT_RESOURCE_KEYS)[number];

export type RetrievalMode = "structured" | "keyword" | "metadata" | "hybrid";

export interface ResourceReadResult {
  source: AssistantResourceKey;
  label: string;
  outcome: ResourceOutcome;
  durationMs: number;
  attempts: number;
  itemCount: number;
  retrieval: RetrievalMode;
  text: string;
  errorCode?: string;
  semanticApplied?: boolean;
}

export interface ResourceResolution {
  requestedSources: AssistantResourceKey[];
  results: ResourceReadResult[];
  promptBlock: string;
  metrics: {
    totalMs: number;
    sourceCount: number;
    okCount: number;
    emptyCount: number;
    failedCount: number;
    fallbackUsed: boolean;
    unhealthySources: AssistantResourceKey[];
  };
}

export interface ResourceReader {
  source: AssistantResourceKey;
  label: string;
  retrieval: RetrievalMode;
  read: () => Promise<unknown>;
  prepare?: (value: unknown) => Promise<{ value: unknown; semanticApplied: boolean }>;
}

const SOURCE_LABELS: Record<AssistantResourceKey, string> = {
  project_status: "專案全貌",
  knowledge: "專案知識",
  decisions: "專案決策",
  notes: "筆記與決策",
  tasks: "任務",
  schedule: "行程",
  storyboard: "分鏡",
  assets: "素材",
  generations: "生成紀錄",
  agent_runs: "AI 計畫",
  watches: "持久監看",
  collaboration: "協作與阻塞",
  database: "專案資料庫",
};

const STATUS_QUERY_RE = /(?:進度|做到哪|目前|現在|狀態|卡住|卡在哪|阻塞|完成|還沒完成|社評)/i;
const DECISION_QUERY_RE = /(?:之前|討論|決定|約定|設定|衣服|服裝|角色|世界觀|記得|筆記|知識)/i;
const STORYBOARD_QUERY_RE = /(?:分鏡|鏡頭|場景|腳本|故事|shot|scene)/i;
const ASSET_QUERY_RE = /(?:素材|缺圖|缺素材|參考圖|畫面|生成|成品|asset)/i;
const WORK_QUERY_RE = /(?:待辦|任務|誰|負責|指派|截止|逾期|排程|行程|approval|核准)/i;
const DATABASE_QUERY_RE = /(?:資料庫|資料表|清單|名單|檔案|文件|data|database|file)/i;

/**
 * Route only the relevant portion of the catalog. The result is deterministic, cheap,
 * and safe to test; the model is not asked to remember or choose from 70+ tools.
 */
export function routeAssistantResources(
  message: string,
  pageContext?: AssistantWirePageContext,
): AssistantResourceKey[] {
  const wanted = new Set<AssistantResourceKey>(["project_status"]);
  const text = message.trim();

  if (STATUS_QUERY_RE.test(text)) {
    wanted.add("tasks");
    wanted.add("schedule");
    wanted.add("storyboard");
    wanted.add("generations");
    wanted.add("agent_runs");
    wanted.add("collaboration");
  }
  if (DECISION_QUERY_RE.test(text)) {
    wanted.add("decisions");
    wanted.add("knowledge");
    wanted.add("notes");
  }
  if (STORYBOARD_QUERY_RE.test(text)) wanted.add("storyboard");
  if (ASSET_QUERY_RE.test(text)) {
    wanted.add("storyboard");
    wanted.add("assets");
    wanted.add("generations");
  }
  if (WORK_QUERY_RE.test(text)) {
    wanted.add("tasks");
    wanted.add("schedule");
    wanted.add("collaboration");
  }
  if (/(?:監看|監控|追蹤|提醒)/i.test(text)) wanted.add("watches");
  if (DATABASE_QUERY_RE.test(text)) wanted.add("database");

  switch (pageContext?.pageType) {
    case "story":
      wanted.add("decisions");
      wanted.add("knowledge");
      break;
    case "storyboard":
      wanted.add("storyboard");
      wanted.add("assets");
      break;
    case "assets":
    case "production":
      wanted.add("assets");
      wanted.add("generations");
      break;
    case "tasks":
      wanted.add("tasks");
      wanted.add("collaboration");
      break;
    case "schedule":
      wanted.add("schedule");
      break;
    case "notes":
      wanted.add("notes");
      wanted.add("knowledge");
      break;
    case "database":
      wanted.add("database");
      break;
    case "agent_run":
    case "collab":
      wanted.add("agent_runs");
      wanted.add("watches");
      wanted.add("collaboration");
      break;
  }

  // A generic question still needs long-term project evidence, not only the status snapshot.
  if (wanted.size === 1) {
    wanted.add("knowledge");
    wanted.add("notes");
  }
  return ASSISTANT_RESOURCE_KEYS.filter((key) => wanted.has(key));
}

function resultCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return value == null || value === "" ? 0 : 1;
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.items)) return row.items.length;
  if (Array.isArray(row.rows)) return row.rows.length;
  return Object.keys(row).length ? 1 : 0;
}

function safeJson(value: unknown, maxChars = 2_800): string {
  const seen = new WeakSet<object>();
  const raw = JSON.stringify(value, (key, entry) => {
    if (/(?:token|secret|password|authorization|cookie)/i.test(key)) return "[redacted]";
    if (typeof entry === "string" && /(?:url|download)/i.test(key)) return "[available]";
    if (entry && typeof entry === "object") {
      if (seen.has(entry)) return "[circular]";
      seen.add(entry);
    }
    return entry;
  });
  if (!raw) return "";
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}…[truncated]` : raw;
}

function errorOutcome(error: unknown): { outcome: ResourceOutcome; code: string } {
  const code = error instanceof TRPCError
    ? error.code
    : typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  if (code === "FORBIDDEN" || code === "UNAUTHORIZED") return { outcome: "AUTH_DENIED", code };
  if (code === "NOT_FOUND" || code === "NOT_IMPLEMENTED") return { outcome: "NOT_AVAILABLE", code };
  return { outcome: "TOOL_ERROR", code: code || "UNKNOWN" };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("resource timeout"), { code: "TIMEOUT" })), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Execute independent reads concurrently. One source never rejects the whole resolution.
 * `EMPTY` is a successful read with no evidence, while timeout/auth/tool failures remain distinct.
 */
export async function executeResourceReads(
  readers: ResourceReader[],
  options: { timeoutMs?: number; retryTransientReads?: number } = {},
): Promise<ResourceReadResult[]> {
  const timeoutMs = Math.max(50, options.timeoutMs ?? 4_000);
  const maxRetries = Math.min(Math.max(options.retryTransientReads ?? 1, 0), 1);
  return Promise.all(readers.map(async (reader) => {
    const startedAt = Date.now();
    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        const prepared = await withTimeout((async () => {
          const rawValue = await reader.read();
          return reader.prepare
            ? reader.prepare(rawValue)
            : { value: rawValue, semanticApplied: false };
        })(), timeoutMs);
        const value = prepared.value;
        const itemCount = resultCount(value);
        return {
          source: reader.source,
          label: reader.label,
          outcome: itemCount > 0 ? "OK" : "EMPTY",
          durationMs: Date.now() - startedAt,
          attempts,
          itemCount,
          retrieval: reader.retrieval,
          text: itemCount > 0 ? safeJson(value) : "",
          semanticApplied: prepared.semanticApplied,
        } satisfies ResourceReadResult;
      } catch (error) {
        const isTimeout = typeof error === "object" && error !== null && "code" in error
          && (error as { code?: unknown }).code === "TIMEOUT";
        const mapped = isTimeout ? { outcome: "TIMEOUT" as const, code: "TIMEOUT" } : errorOutcome(error);
        const retryable = mapped.outcome === "TOOL_ERROR" && attempts <= maxRetries;
        if (retryable) continue;
        return {
          source: reader.source,
          label: reader.label,
          outcome: mapped.outcome,
          durationMs: Date.now() - startedAt,
          attempts,
          itemCount: 0,
          retrieval: reader.retrieval,
          text: "",
          errorCode: mapped.code,
        } satisfies ResourceReadResult;
      }
    }
  }));
}

async function readProjectDatabaseResource(
  auth: AuthState,
  projectId: string,
  message: string,
  pageContext?: AssistantWirePageContext,
): Promise<{ items: Array<Record<string, unknown>>; focusedTableId?: string }> {
  const listed = await listMcpDatabases(auth, { projectId, linkedOnly: true });
  const tables: AssistantReadableDatabase[] = listed.map((table, index) => ({
    ref: `db${index + 1}`,
    id: table.tableId,
    name: table.name,
    fields: table.fields,
    rowCount: table.rowCount,
    canWrite: table.canWriteRows,
  }));

  const selectedId = pageContext?.entityType === "database" ? pageContext.entityId : undefined;
  if (selectedId && !tables.some((table) => table.id === selectedId)) {
    const extra = await getAgentReadableTable(auth, selectedId);
    if (extra) {
      tables.unshift({
        ref: "dbFocus",
        id: extra.table.id,
        name: extra.table.name,
        fields: extra.table.fields as DataField[],
        rowCount: 0,
        canWrite: extra.access.canWriteRows,
      });
    }
  }

  const ordered = prioritizeAssistantDatabases(tables, pageContext);
  const rows = await retrieveAssistantDatabaseEvidence(ordered, message);
  if (rows.length) {
    return {
      items: rows.map((row) => ({
        kind: "row",
        tableId: row.tableId,
        tableRef: row.tableRef,
        tableName: row.tableName,
        rowId: row.rowId,
        text: row.text,
        score: row.score,
      })),
      focusedTableId: ordered[0]?.id,
    };
  }
  return {
    items: ordered.map((table) => ({
      kind: "table",
      tableId: table.id,
      tableRef: table.ref,
      tableName: table.name,
      rowCount: table.rowCount,
      canWrite: table.canWrite,
      fields: table.fields.slice(0, 12).map((field) => ({ key: field.key, label: field.label, type: field.type })),
    })),
    focusedTableId: ordered[0]?.id,
  };
}

function buildPromptBlock(results: ResourceReadResult[]): string {
  const lines = results.map((result) => {
    const semantic = result.retrieval === "hybrid" ? ` semanticApplied=${result.semanticApplied === true ? "yes" : "no"}` : "";
    const header = `[${result.label}] outcome=${result.outcome} retrieval=${result.retrieval}${semantic} durationMs=${result.durationMs}`;
    return result.outcome === "OK" ? `${header}\n${result.text}` : header;
  });
  return [
    "<resource_evidence>",
    "Only use OK evidence as factual support. EMPTY means the source was read successfully but had no matches; it is not an error. Other outcomes are unavailable evidence and must not be invented.",
    ...lines,
    "</resource_evidence>",
  ].join("\n");
}

export async function resolveProjectResources(input: {
  auth: AuthState;
  projectId: string;
  message: string;
  pageContext?: AssistantWirePageContext;
  timeoutMs?: number;
}): Promise<ResourceResolution> {
  const startedAt = Date.now();
  const requestedSources = routeAssistantResources(input.message, input.pageContext);
  const args = { projectId: input.projectId };
  const toolBySource: Record<AssistantResourceKey, { name: string; args?: Record<string, unknown>; retrieval: RetrievalMode }> = {
    project_status: { name: "get_project_status", retrieval: "structured" },
    knowledge: { name: "list_knowledge", args: { limit: 30 }, retrieval: "hybrid" },
    decisions: { name: "list_decisions", retrieval: "structured" },
    notes: { name: "list_notes", retrieval: "hybrid" },
    tasks: { name: "list_tasks", retrieval: "structured" },
    schedule: { name: "list_schedule", retrieval: "structured" },
    storyboard: { name: "list_scenes", retrieval: "structured" },
    assets: { name: "list_assets", args: { limit: 50 }, retrieval: "hybrid" },
    generations: { name: "list_generations", args: { limit: 50 }, retrieval: "structured" },
    agent_runs: { name: "list_agent_runs", retrieval: "structured" },
    watches: { name: "list_watches", retrieval: "structured" },
    collaboration: { name: "get_agent_insights", retrieval: "structured" },
    database: { name: "list_databases", args: { linkedOnly: true }, retrieval: "hybrid" },
  };
  const readers: ResourceReader[] = requestedSources.map((source) => {
    const tool = toolBySource[source];
    if (source === "database") {
      return {
        source,
        label: SOURCE_LABELS[source],
        retrieval: "hybrid",
        read: () => readProjectDatabaseResource(input.auth, input.projectId, input.message, input.pageContext),
      };
    }
    return {
      source,
      label: SOURCE_LABELS[source],
      retrieval: tool.retrieval,
      read: () => callTool(input.auth, { readOnly: true }, tool.name, { ...args, ...tool.args }),
      prepare: tool.retrieval === "hybrid"
        ? async (value) => {
            if (Array.isArray(value)) {
              const ranked = await rankHybridItems(value, input.message, undefined, 30);
              return { value: ranked.items, semanticApplied: ranked.semanticApplied };
            }
            if (value && typeof value === "object" && Array.isArray((value as { items?: unknown[] }).items)) {
              const ranked = await rankHybridItems((value as { items: unknown[] }).items, input.message, undefined, 30);
              return { value: { ...(value as Record<string, unknown>), items: ranked.items }, semanticApplied: ranked.semanticApplied };
            }
            return { value, semanticApplied: false };
          }
        : undefined,
    };
  });
  const results = await executeResourceReads(readers, { timeoutMs: input.timeoutMs, retryTransientReads: 1 });
  recordAssistantResourceHealth(results);
  const okCount = results.filter((result) => result.outcome === "OK").length;
  const emptyCount = results.filter((result) => result.outcome === "EMPTY").length;
  const failedCount = results.length - okCount - emptyCount;
  return {
    requestedSources,
    results,
    promptBlock: buildPromptBlock(results),
    metrics: {
      totalMs: Date.now() - startedAt,
      sourceCount: results.length,
      okCount,
      emptyCount,
      failedCount,
      fallbackUsed: results.some((result, index) => index > 0 && result.outcome === "OK")
        && results.some((result) => result.outcome !== "OK"),
      unhealthySources: assistantResourceHealthSnapshot()
        .filter((health) => health.unhealthy && requestedSources.includes(health.source))
        .map((health) => health.source),
    },
  };
}
