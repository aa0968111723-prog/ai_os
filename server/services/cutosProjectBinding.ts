import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { loadAuthState, type AuthState } from "./auth";
import { CutosClient, CutosClientError, requireCutosClient } from "./cutosClient";
import type { ProjectBinding } from "../../shared/cutosProtocol";

/**
 * Durable AIOS project ↔ CUTOS project binding.
 *
 * The security property this module exists for: an agent must never be able to
 * choose which CUTOS project it operates on. A run is already scoped to an AIOS
 * project by the runtime; the CUTOS project is *derived* from that scope by a
 * database lookup, so a `cutosProjectId` appearing anywhere in model output is
 * simply ignored. Every resolution re-checks the caller's group membership and
 * the project's group, so a user removed from a group loses access on the very
 * next tool call rather than at the next login.
 *
 * The mapping lives in Postgres (`aios_cutos_project_bindings`) — never in a
 * Map, never in localStorage: a binding that disappears on restart would let a
 * long-running edit resume against the wrong video.
 */

export class CutosBindingError extends Error {
  constructor(
    readonly code:
      | "BINDING_NOT_FOUND"
      | "FORBIDDEN"
      | "ALREADY_BOUND"
      | "CUTOS_PROJECT_NOT_FOUND"
      | "PROJECT_NOT_FOUND",
    /** zh-TW key; the raw message is for logs. */
    readonly messageKey: string,
    message: string,
  ) {
    super(message);
    this.name = "CutosBindingError";
  }
}

type BindingRow = typeof schema.aiosCutosProjectBindings.$inferSelect;

export interface CutosBinding {
  id: string;
  userId: string;
  groupId: string;
  aiosProjectId: string;
  cutosProjectId: string;
  cutosProjectName: string | null;
  lastTimelineRevision: number | null;
  cutosBaseUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toBinding(row: BindingRow): CutosBinding {
  return {
    id: row.id,
    userId: row.userId,
    groupId: row.groupId,
    aiosProjectId: row.aiosProjectId,
    cutosProjectId: row.cutosProjectId,
    cutosProjectName: row.cutosProjectName,
    lastTimelineRevision: row.lastTimelineRevision,
    cutosBaseUrl: row.cutosBaseUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The protocol-shaped view handed across the wire / into evidence. */
export function toProtocolBinding(binding: CutosBinding): ProjectBinding {
  return {
    id: binding.id,
    userId: binding.userId,
    groupId: binding.groupId,
    aiosProjectId: binding.aiosProjectId,
    cutosProjectId: binding.cutosProjectId,
    createdAt: binding.createdAt.toISOString(),
    updatedAt: binding.updatedAt.toISOString(),
  };
}

/**
 * Assert the caller may act on this AIOS project, through the same guard the
 * rest of the system uses: the project's group must match, and the caller must
 * currently be a member of it.
 */
async function assertProjectAccess(
  auth: AuthState,
  aiosProjectId: string,
): Promise<{ groupId: string }> {
  const [project] = await db
    .select({ groupId: schema.projects.groupId, status: schema.projects.status })
    .from(schema.projects)
    .where(eq(schema.projects.id, aiosProjectId));
  if (!project) {
    throw new CutosBindingError("PROJECT_NOT_FOUND", "cutos.binding.projectNotFound", "Project not found");
  }
  if (!auth.groups.some((membership) => membership.groupId === project.groupId)) {
    throw new CutosBindingError("FORBIDDEN", "cutos.binding.forbidden", "FORBIDDEN");
  }
  return { groupId: project.groupId };
}

export interface BindProjectInput {
  userId: string;
  aiosProjectId: string;
  cutosProjectId: string;
  /** Verify the CUTOS project exists before persisting the binding. */
  verify?: boolean;
  client?: CutosClient;
}

/**
 * Create (or re-point) the binding for an AIOS project.
 *
 * This is a deliberate human/API action, not something an agent can do to
 * itself mid-run: the tool registry exposes no capability that writes bindings.
 */
export async function bindCutosProject(input: BindProjectInput): Promise<CutosBinding> {
  const auth = await loadAuthState(input.userId);
  if (!auth) throw new CutosBindingError("FORBIDDEN", "cutos.binding.forbidden", "FORBIDDEN");
  const { groupId } = await assertProjectAccess(auth, input.aiosProjectId);

  const client = input.client ?? (input.verify === false ? undefined : requireCutosClient());
  let cutosProjectName: string | null = null;
  let lastTimelineRevision: number | null = null;
  let cutosBaseUrl: string | null = null;

  if (client && input.verify !== false) {
    try {
      const project = await client.invokeRead<{
        id: string;
        name: string;
        timelineRevision: number;
      }>("get_project", { projectId: input.cutosProjectId }, {
        correlation: { aiosProjectId: input.aiosProjectId, cutosProjectId: input.cutosProjectId },
      });
      cutosProjectName = project.result.name ?? null;
      lastTimelineRevision = project.result.timelineRevision ?? null;
      cutosBaseUrl = (client as unknown as { baseUrl?: string }).baseUrl ?? null;
    } catch (error) {
      if (error instanceof CutosClientError && error.code === "PROJECT_NOT_FOUND") {
        throw new CutosBindingError(
          "CUTOS_PROJECT_NOT_FOUND",
          "cutos.binding.cutosProjectNotFound",
          "CUTOS project not found",
        );
      }
      throw error;
    }
  }

  // A CUTOS project already owned by another group must never be re-pointed
  // here: that would be a cross-tenant data path.
  const [conflicting] = await db
    .select({ aiosProjectId: schema.aiosCutosProjectBindings.aiosProjectId, groupId: schema.aiosCutosProjectBindings.groupId })
    .from(schema.aiosCutosProjectBindings)
    .where(eq(schema.aiosCutosProjectBindings.cutosProjectId, input.cutosProjectId));
  if (conflicting && conflicting.aiosProjectId !== input.aiosProjectId) {
    throw new CutosBindingError(
      "ALREADY_BOUND",
      "cutos.binding.alreadyBound",
      "This CUTOS project is already bound to another AIOS project",
    );
  }

  const now = new Date();
  const [row] = await db
    .insert(schema.aiosCutosProjectBindings)
    .values({
      userId: input.userId,
      groupId,
      aiosProjectId: input.aiosProjectId,
      cutosProjectId: input.cutosProjectId,
      cutosProjectName,
      lastTimelineRevision,
      cutosBaseUrl,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.aiosCutosProjectBindings.aiosProjectId,
      set: {
        cutosProjectId: input.cutosProjectId,
        cutosProjectName,
        lastTimelineRevision,
        cutosBaseUrl,
        userId: input.userId,
        groupId,
        updatedAt: now,
      },
    })
    .returning();
  return toBinding(row!);
}

/** Remove a binding. The CUTOS project itself is untouched. */
export async function unbindCutosProject(input: {
  userId: string;
  aiosProjectId: string;
}): Promise<void> {
  const auth = await loadAuthState(input.userId);
  if (!auth) throw new CutosBindingError("FORBIDDEN", "cutos.binding.forbidden", "FORBIDDEN");
  await assertProjectAccess(auth, input.aiosProjectId);
  await db
    .delete(schema.aiosCutosProjectBindings)
    .where(eq(schema.aiosCutosProjectBindings.aiosProjectId, input.aiosProjectId));
}

export async function findBinding(aiosProjectId: string): Promise<CutosBinding | null> {
  const [row] = await db
    .select()
    .from(schema.aiosCutosProjectBindings)
    .where(eq(schema.aiosCutosProjectBindings.aiosProjectId, aiosProjectId));
  return row ? toBinding(row) : null;
}

/**
 * Resolve the CUTOS project a tool call may touch.
 *
 * This is THE authorization choke point for the whole integration. It takes the
 * run's own scope (userId / groupId / projectId) and returns the bound CUTOS
 * project — it does not accept a caller-supplied CUTOS id, so there is no input
 * an agent could craft to reach another tenant's video.
 */
export async function resolveCutosProject(context: {
  userId: string;
  groupId: string;
  projectId: string;
}): Promise<CutosBinding> {
  const auth = await loadAuthState(context.userId);
  if (!auth) throw new CutosBindingError("FORBIDDEN", "cutos.binding.forbidden", "FORBIDDEN");

  const [project] = await db
    .select({ groupId: schema.projects.groupId })
    .from(schema.projects)
    .where(eq(schema.projects.id, context.projectId));
  if (!project) {
    throw new CutosBindingError("PROJECT_NOT_FOUND", "cutos.binding.projectNotFound", "Project not found");
  }
  // Three independent checks: the run's declared group, the project's real
  // group, and live membership. A stale or forged context fails all the same.
  if (
    project.groupId !== context.groupId
    || !auth.groups.some((membership) => membership.groupId === context.groupId)
  ) {
    throw new CutosBindingError("FORBIDDEN", "cutos.binding.forbidden", "FORBIDDEN");
  }

  const [row] = await db
    .select()
    .from(schema.aiosCutosProjectBindings)
    .where(and(
      eq(schema.aiosCutosProjectBindings.aiosProjectId, context.projectId),
      eq(schema.aiosCutosProjectBindings.groupId, context.groupId),
    ));
  if (!row) {
    throw new CutosBindingError(
      "BINDING_NOT_FOUND",
      "cutos.binding.notFound",
      `AIOS project ${context.projectId} is not bound to a CUTOS project`,
    );
  }
  return toBinding(row);
}

/** Record the revision AIOS last observed, so the next mutation can guard on it. */
export async function rememberTimelineRevision(
  aiosProjectId: string,
  timelineRevision: number,
): Promise<void> {
  await db
    .update(schema.aiosCutosProjectBindings)
    .set({ lastTimelineRevision: timelineRevision, updatedAt: new Date() })
    .where(eq(schema.aiosCutosProjectBindings.aiosProjectId, aiosProjectId));
}

export async function listGroupBindings(groupId: string): Promise<CutosBinding[]> {
  const rows = await db
    .select()
    .from(schema.aiosCutosProjectBindings)
    .where(eq(schema.aiosCutosProjectBindings.groupId, groupId));
  return rows.map(toBinding);
}

/**
 * Resolve the AIOS project a CUTOS-initiated request may act on.
 *
 * This is the inbound mirror of {@link resolveCutosProject} and it is THE
 * authorization choke point for the CUTOS → AIOS direction. The asymmetry is
 * deliberate:
 *
 *  - outbound, an agent must not choose the video, so the CUTOS project is
 *    derived from the AIOS project the run is already scoped to;
 *  - inbound, CUTOS legitimately names its own project (it owns that id space),
 *    but it must not be able to name an AIOS project. So the AIOS project is
 *    derived from the durable binding, and the caller's identity is re-checked
 *    against the binding's group on every request.
 *
 * A CUTOS deployment holding a valid AIOS credential therefore still cannot
 * reach an AIOS project that nobody bound to the video it is asking about.
 */
export async function resolveInboundCutosProject(input: {
  auth: AuthState;
  cutosProjectId: string;
}): Promise<CutosBinding> {
  const [row] = await db
    .select()
    .from(schema.aiosCutosProjectBindings)
    .where(eq(schema.aiosCutosProjectBindings.cutosProjectId, input.cutosProjectId));
  // Unbound and forbidden are the same answer on the wire: a caller must not be
  // able to probe which CUTOS project ids exist in someone else's group.
  if (!row) {
    throw new CutosBindingError(
      "BINDING_NOT_FOUND",
      "cutos.binding.notFound",
      "No AIOS project is bound to this CUTOS project",
    );
  }
  if (!input.auth.groups.some((membership) => membership.groupId === row.groupId)) {
    throw new CutosBindingError(
      "BINDING_NOT_FOUND",
      "cutos.binding.notFound",
      "Caller is not a member of the bound group",
    );
  }
  // The project must still exist and still belong to that group — a project
  // moved or deleted since the binding was written must not be reachable.
  const [project] = await db
    .select({ groupId: schema.projects.groupId })
    .from(schema.projects)
    .where(eq(schema.projects.id, row.aiosProjectId));
  if (!project || project.groupId !== row.groupId) {
    throw new CutosBindingError(
      "BINDING_NOT_FOUND",
      "cutos.binding.notFound",
      "Bound AIOS project is gone or moved group",
    );
  }
  return toBinding(row);
}
