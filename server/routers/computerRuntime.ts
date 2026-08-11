/**
 * Computer Runtime tRPC API (PR-6A Browser Foundation).
 * Feature-flagged: when disabled, list endpoints return empty / mutations fail closed.
 */
import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import {
  createComputerSession,
  getComputerSession,
  issueLiveViewToken,
  listActiveComputerSessionsForGroup,
  listComputerSessionsForProject,
  runComputerAction,
  stopComputerSession,
} from "../services/computerRuntime/sessionCore";
import { isComputerBrowserEnabled, isComputerRuntimeEnabled } from "../../shared/computerRuntime";

const browserActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: z.string().min(1).max(2_000) }),
  z.object({ kind: z.literal("click"), selector: z.string().min(1).max(500) }),
  z.object({
    kind: z.literal("type"),
    selector: z.string().min(1).max(500),
    text: z.string().max(8_000),
    sensitive: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("key"), key: z.string().min(1).max(40) }),
  z.object({ kind: z.literal("scroll"), dy: z.number().int().min(-10_000).max(10_000) }),
  z.object({ kind: z.literal("wait"), ms: z.number().int().min(0).max(30_000) }),
  z.object({ kind: z.literal("inspect") }),
]);

export const computerRuntimeRouter = router({
  /** Product capability probe for UI */
  status: authedProcedure.query(() => ({
    enabled: isComputerRuntimeEnabled(),
    browserEnabled: isComputerBrowserEnabled(),
  })),

  createSession: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      runId: z.string().uuid().optional(),
      stepId: z.string().max(100).optional(),
      startUrl: z.string().max(2_000).optional(),
      label: z.string().max(160).optional(),
    }))
    .mutation(({ ctx, input }) => createComputerSession({ auth: ctx.auth, ...input })),

  getSession: authedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) => getComputerSession(ctx.auth, input.sessionId)),

  listByProject: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => listComputerSessionsForProject(ctx.auth, input.projectId)),

  listActiveByGroup: authedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .query(({ ctx, input }) => listActiveComputerSessionsForGroup(ctx.auth, input.groupId)),

  issueLiveView: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      mode: z.enum(["watch", "control"]).optional(),
    }))
    .mutation(({ ctx, input }) => issueLiveViewToken({ auth: ctx.auth, ...input })),

  act: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      actionId: z.string().min(8).max(120),
      action: browserActionSchema,
      leaseVersion: z.number().int().min(0).optional(),
      expectedSessionRevision: z.number().int().min(0).optional(),
    }))
    .mutation(({ ctx, input }) => runComputerAction({
      auth: ctx.auth,
      sessionId: input.sessionId,
      actionId: input.actionId,
      action: input.action,
      leaseVersion: input.leaseVersion,
      expectedSessionRevision: input.expectedSessionRevision,
    })),

  stop: authedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) => stopComputerSession({ auth: ctx.auth, sessionId: input.sessionId })),
});
