import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { DECISION_TITLE_MAX } from "../../shared/collabIntent";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import { publishToProject } from "./realtime";

export type DecisionRefType = "scene" | "asset" | "generation" | "note" | "schedule";

async function loadProjectChecked(auth: AuthState, projectId: string, forEdit: boolean) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  requireGroup(auth, project.groupId);
  if (forEdit) {
    await assertProjectEditable(auth, project);
    assertProjectNotArchived(project);
  }
  return project;
}

export async function listProjectDecisions(auth: AuthState, projectId: string) {
  await loadProjectChecked(auth, projectId, false);
  const rows = await db.select().from(schema.decisions)
    .where(eq(schema.decisions.projectId, projectId))
    .orderBy(desc(schema.decisions.createdAt))
    .limit(100);
  const ids = [...new Set(rows.flatMap((row) => [row.decidedBy, row.revokedBy]).filter((id): id is string => Boolean(id)))];
  const users = ids.length
    ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, ids))
    : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  return rows.map((row) => ({
    ...row,
    decidedByName: names.get(row.decidedBy) ?? null,
    revokedByName: row.revokedBy ? names.get(row.revokedBy) ?? null : null,
  }));
}

export async function createProjectDecisionCore(input: {
  auth: AuthState;
  projectId: string;
  title: string;
  refType?: DecisionRefType;
  refId?: string;
  sourceMessageId?: string;
}) {
  const project = await loadProjectChecked(input.auth, input.projectId, true);
  const title = input.title.trim();
  if (!title || title.length > DECISION_TITLE_MAX) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `決策內容需為 1–${DECISION_TITLE_MAX} 字` });
  }
  if ((input.refType == null) !== (input.refId == null)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "refType 與 refId 必須一起提供" });
  }
  if (input.sourceMessageId) {
    const [source] = await db.select({ projectId: schema.messages.projectId }).from(schema.messages)
      .where(eq(schema.messages.id, input.sourceMessageId));
    if (!source || source.projectId !== project.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "來源留言不屬於此專案" });
    }
  }
  const [existing] = await db.select().from(schema.decisions).where(and(
    eq(schema.decisions.projectId, project.id),
    isNull(schema.decisions.revokedAt),
    input.sourceMessageId
      ? eq(schema.decisions.sourceMessageId, input.sourceMessageId)
      : and(
        eq(schema.decisions.title, title),
        eq(schema.decisions.decidedBy, input.auth.user.id),
      ),
  )).limit(1);
  if (existing) return existing;
  const [row] = await db.insert(schema.decisions).values({
    groupId: project.groupId,
    projectId: project.id,
    title,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    decidedBy: input.auth.user.id,
  }).returning();
  if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "決策未寫入" });
  if (input.sourceMessageId) {
    await db.update(schema.messages).set({ intent: "decision" }).where(eq(schema.messages.id, input.sourceMessageId));
  }
  publishToProject(project.id, { kind: "annotation", id: input.refId ?? null }, "新增專案決策");
  return row;
}

export async function revokeProjectDecisionCore(auth: AuthState, id: string) {
  const [row] = await db.select().from(schema.decisions).where(eq(schema.decisions.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await loadProjectChecked(auth, row.projectId, true);
  if (row.revokedAt) return row;
  const [updated] = await db.update(schema.decisions)
    .set({ revokedAt: new Date(), revokedBy: auth.user.id })
    .where(and(eq(schema.decisions.id, id)))
    .returning();
  return updated ?? row;
}

export async function getProjectDecisionChecked(auth: AuthState, id: string) {
  const [row] = await db.select().from(schema.decisions).where(eq(schema.decisions.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await loadProjectChecked(auth, row.projectId, false);
  return row;
}
