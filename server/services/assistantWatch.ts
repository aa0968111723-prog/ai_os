import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { notify } from "./notify";

export const ASSISTANT_WATCH_KINDS = [
  "deadline_approaching",
  "overdue_task",
  "generation_failed",
  "missing_asset",
  "approval_waiting",
  "agent_blocked",
  "storyboard_incomplete",
] as const;
export type AssistantWatchKind = typeof ASSISTANT_WATCH_KINDS[number];
export const ASSISTANT_ATTENTION_REPEAT_WINDOW_MS = 6 * 60 * 60_000;

/** Same evidence is deduped within a six-hour window, but may alert again if it remains actionable later. */
export function assistantWatchEventKey(watchId: string, evidenceFingerprint: string, now = new Date()): string {
  const window = Math.floor(now.getTime() / ASSISTANT_ATTENTION_REPEAT_WINDOW_MS);
  return `assistant-watch:${watchId}:${evidenceFingerprint}:${window}`;
}

export function shouldTriggerAssistantWatch(
  signal: WatchSignal | null,
  lastFingerprint: string | null,
  lastTriggeredAt: Date | null,
  now = new Date(),
): boolean {
  if (!signal) return false;
  if (signal.fingerprint !== lastFingerprint) return true;
  return !lastTriggeredAt || now.getTime() - lastTriggeredAt.getTime() >= ASSISTANT_ATTENTION_REPEAT_WINDOW_MS;
}

const WATCH_LABELS: Record<AssistantWatchKind, string> = {
  deadline_approaching: "截止時間即將到達",
  overdue_task: "任務逾期",
  generation_failed: "生成失敗",
  missing_asset: "分鏡缺少素材",
  approval_waiting: "核准等待處理",
  agent_blocked: "AI 代理受阻",
  storyboard_incomplete: "分鏡尚未完整",
};

export interface WatchSnapshot {
  tasks: Array<{ id: string; title: string; status: string; taskType: string; dueAt: Date | null }>;
  generations: Array<{ id: string; status: string; error: string | null }>;
  scenes: Array<{ id: string; title: string; assetId: string | null }>;
  agentRuns: Array<{ id: string; status: string; goal: string; error: string | null }>;
}

export interface WatchSignal {
  title: string;
  body: string;
  fingerprint: string;
  refType: string;
  refId: string | null;
}

function fingerprint(kind: AssistantWatchKind, ids: string[]): string {
  return createHash("sha256").update(`${kind}:${[...ids].sort().join(",")}`).digest("hex").slice(0, 20);
}

const ACTIVE_TASK = new Set(["todo", "doing", "waiting", "review"]);

/** Pure evaluator: only actionable current facts produce a signal. */
export function evaluateAssistantWatch(kind: AssistantWatchKind, snapshot: WatchSnapshot, now = new Date()): WatchSignal | null {
  const activeTasks = snapshot.tasks.filter((task) => ACTIVE_TASK.has(task.status));
  if (kind === "deadline_approaching") {
    const horizon = now.getTime() + 24 * 60 * 60_000;
    const hits = activeTasks.filter((task) => task.dueAt && task.dueAt.getTime() >= now.getTime() && task.dueAt.getTime() <= horizon);
    if (!hits.length) return null;
    return {
      title: `${hits.length} 個任務將在 24 小時內到期`,
      body: hits.slice(0, 3).map((task) => task.title).join("、"),
      fingerprint: fingerprint(kind, hits.map((task) => `${task.id}:${task.dueAt?.toISOString()}`)),
      refType: "task",
      refId: hits[0]?.id ?? null,
    };
  }
  if (kind === "overdue_task") {
    const hits = activeTasks.filter((task) => task.dueAt && task.dueAt.getTime() < now.getTime());
    if (!hits.length) return null;
    return { title: `${hits.length} 個任務已逾期`, body: hits.slice(0, 3).map((task) => task.title).join("、"), fingerprint: fingerprint(kind, hits.map((task) => task.id)), refType: "task", refId: hits[0]?.id ?? null };
  }
  if (kind === "approval_waiting") {
    const hits = activeTasks.filter((task) => task.taskType === "approval");
    if (!hits.length) return null;
    return { title: `${hits.length} 個核准正在等待`, body: hits.slice(0, 3).map((task) => task.title).join("、"), fingerprint: fingerprint(kind, hits.map((task) => task.id)), refType: "task", refId: hits[0]?.id ?? null };
  }
  if (kind === "generation_failed") {
    const hits = snapshot.generations.filter((generation) => generation.status === "failed");
    if (!hits.length) return null;
    return { title: `${hits.length} 個生成失敗`, body: hits[0]?.error ?? "請檢查生成紀錄", fingerprint: fingerprint(kind, hits.map((generation) => generation.id)), refType: "generation", refId: hits[0]?.id ?? null };
  }
  if (kind === "agent_blocked") {
    const hits = snapshot.agentRuns.filter((run) => run.status === "failed" || run.status === "waiting");
    if (!hits.length) return null;
    return { title: `${hits.length} 個 AI 計畫需要處理`, body: hits.slice(0, 3).map((run) => run.goal).join("、"), fingerprint: fingerprint(kind, hits.map((run) => `${run.id}:${run.status}`)), refType: "agent_run", refId: hits[0]?.id ?? null };
  }
  const missing = snapshot.scenes.filter((scene) => !scene.assetId);
  if (kind === "missing_asset") {
    if (!missing.length) return null;
    return { title: `${missing.length} 個分鏡缺少素材`, body: missing.slice(0, 3).map((scene) => scene.title).join("、"), fingerprint: fingerprint(kind, missing.map((scene) => scene.id)), refType: "scene", refId: missing[0]?.id ?? null };
  }
  if (!snapshot.scenes.length || missing.length) {
    const ids = snapshot.scenes.length ? missing.map((scene) => scene.id) : ["empty"];
    return { title: snapshot.scenes.length ? "分鏡尚未補齊畫面" : "專案尚未建立分鏡", body: snapshot.scenes.length ? `${missing.length} 格待補` : "請先建立腳本或分鏡", fingerprint: fingerprint(kind, ids), refType: "scene", refId: missing[0]?.id ?? null };
  }
  return null;
}

async function loadProject(auth: AuthState, projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  requireGroup(auth, project.groupId);
  return project;
}

export async function createAssistantWatchCore(input: { auth: AuthState; projectId: string; kind: AssistantWatchKind; label?: string }) {
  const project = await loadProject(input.auth, input.projectId);
  const [watch] = await db.insert(schema.assistantWatches).values({
    groupId: project.groupId,
    projectId: project.id,
    userId: input.auth.user.id,
    kind: input.kind,
    label: input.label?.trim().slice(0, 160) || WATCH_LABELS[input.kind],
    active: true,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [schema.assistantWatches.userId, schema.assistantWatches.projectId, schema.assistantWatches.kind],
    set: { active: true, label: input.label?.trim().slice(0, 160) || WATCH_LABELS[input.kind], updatedAt: new Date() },
  }).returning();
  if (!watch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "監看未建立" });
  return watch;
}

export async function listAssistantWatches(auth: AuthState, projectId: string) {
  await loadProject(auth, projectId);
  return db.select().from(schema.assistantWatches)
    .where(and(eq(schema.assistantWatches.projectId, projectId), eq(schema.assistantWatches.userId, auth.user.id)))
    .orderBy(asc(schema.assistantWatches.createdAt));
}

export async function cancelAssistantWatchCore(auth: AuthState, id: string) {
  const [watch] = await db.select().from(schema.assistantWatches).where(eq(schema.assistantWatches.id, id));
  if (!watch) throw new TRPCError({ code: "NOT_FOUND" });
  requireGroup(auth, watch.groupId);
  if (watch.userId !== auth.user.id) throw new TRPCError({ code: "FORBIDDEN" });
  const [updated] = await db.update(schema.assistantWatches).set({ active: false, updatedAt: new Date() })
    .where(eq(schema.assistantWatches.id, id)).returning();
  return updated ?? watch;
}

export async function getAssistantWatchChecked(auth: AuthState, id: string) {
  const [watch] = await db.select().from(schema.assistantWatches).where(eq(schema.assistantWatches.id, id));
  if (!watch) throw new TRPCError({ code: "NOT_FOUND" });
  requireGroup(auth, watch.groupId);
  if (watch.userId !== auth.user.id) throw new TRPCError({ code: "FORBIDDEN" });
  return watch;
}

async function readSnapshot(projectId: string): Promise<WatchSnapshot> {
  const [tasks, generations, scenes, agentRuns] = await Promise.all([
    db.select({ id: schema.projectTasks.id, title: schema.projectTasks.title, status: schema.projectTasks.status, taskType: schema.projectTasks.taskType, dueAt: schema.projectTasks.dueAt })
      .from(schema.projectTasks).where(eq(schema.projectTasks.projectId, projectId)),
    db.select({ id: schema.generations.id, status: schema.generations.status, error: schema.generations.error })
      .from(schema.generations).where(eq(schema.generations.projectId, projectId)),
    db.select({ id: schema.scenes.id, title: schema.scenes.title, assetId: schema.scenes.assetId })
      .from(schema.scenes).where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt))),
    db.select({ id: schema.agentRuns.id, status: schema.agentRuns.status, goal: schema.agentRuns.goal, error: schema.agentRuns.error })
      .from(schema.agentRuns).where(eq(schema.agentRuns.projectId, projectId)),
  ]);
  return { tasks, generations, scenes, agentRuns };
}

/** One bounded sweep; notifications are deduped by user + watch + evidence fingerprint. */
export async function sweepAssistantWatches(limit = 40): Promise<{ checked: number; triggered: number }> {
  const watches = await db.select().from(schema.assistantWatches)
    .where(eq(schema.assistantWatches.active, true))
    .orderBy(asc(schema.assistantWatches.lastCheckedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  let triggered = 0;
  for (const watch of watches) {
    const now = new Date();
    try {
      const signal = evaluateAssistantWatch(watch.kind, await readSnapshot(watch.projectId), now);
      const shouldTrigger = shouldTriggerAssistantWatch(signal, watch.lastFingerprint, watch.lastTriggeredAt, now);
      if (shouldTrigger && signal) {
        await notify({
          userIds: [watch.userId], groupId: watch.groupId, projectId: watch.projectId,
          kind: "assistant_attention", title: signal.title, body: signal.body,
          url: `/p/${watch.projectId}`, eventKey: assistantWatchEventKey(watch.id, signal.fingerprint, now),
          refType: signal.refType, refId: signal.refId, pushTag: `assistant-watch:${watch.id}`,
        });
        triggered += 1;
      }
      await db.update(schema.assistantWatches).set({
        lastCheckedAt: now,
        lastTriggeredAt: shouldTrigger ? now : watch.lastTriggeredAt,
        lastFingerprint: signal?.fingerprint ?? null,
        updatedAt: now,
      }).where(eq(schema.assistantWatches.id, watch.id));
    } catch (error) {
      console.warn("[assistant-watch] evaluation failed", watch.id, error instanceof Error ? error.message : error);
      await db.update(schema.assistantWatches).set({ lastCheckedAt: now, updatedAt: now }).where(eq(schema.assistantWatches.id, watch.id)).catch(() => undefined);
    }
  }
  return { checked: watches.length, triggered };
}

let started = false;
let running = false;
export function startAssistantWatchRunner(): void {
  if (started || process.env.ASSISTANT_WATCH_RUNNER === "0") return;
  started = true;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await sweepAssistantWatches(); } finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref?.();
}
