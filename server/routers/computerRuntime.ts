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
import {
  acquireHumanControl,
  releaseControlToAgent,
  requestHumanTakeover,
} from "../services/computerRuntime/controlLease";
import {
  detectMockArtifact,
  importArtifactToProject,
  listArtifactsForSession,
  registerArtifactFromUrl,
} from "../services/computerRuntime/artifacts";
import {
  createDesktopSession,
  escalateBrowserToDesktop,
  planAndOptionallyPreviewDesktop,
  runDesktopAction,
} from "../services/computerRuntime/desktopCore";
import {
  listAuthContexts,
  revokeAuthContext,
  saveAuthContextFromSession,
} from "../services/computerRuntime/persistedAuth";
import {
  isComputerArtifactIngestionEnabled,
  isComputerBrowserEnabled,
  isComputerDesktopEnabled,
  isComputerHumanTakeoverEnabled,
  isComputerPersistedAuthEnabled,
  isComputerRuntimeEnabled,
} from "../../shared/computerRuntime";
import { BROWSER_EFFECTS, browserEffectPolicy, type BrowserEffect } from "../../shared/browserActionAdapter";
import { TRPCError } from "@trpc/server";

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
const browserEffectSchema = z.enum(BROWSER_EFFECTS);

function assertBrowserEffectContract(action: z.infer<typeof browserActionSchema>, effect: BrowserEffect, confirmedEffect?: BrowserEffect) {
  const fixedEffect: Partial<Record<typeof action.kind, BrowserEffect>> = {
    inspect: "observe", scroll: "observe", wait: "observe", navigate: "navigate", type: "form_fill",
  };
  const required = fixedEffect[action.kind];
  if (required && effect !== required) throw new TRPCError({ code: "BAD_REQUEST", message: `Browser action ${action.kind} must declare effect ${required}` });
  if ((action.kind === "click" || action.kind === "key") && effect === "observe") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Interactive browser actions must declare their final effect" });
  }
  const policy = browserEffectPolicy(effect, confirmedEffect);
  if (policy.confirmationRequired && !policy.allowed) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Explicit confirmation required for browser effect ${effect}` });
  }
}

export const computerRuntimeRouter = router({
  /** Product capability probe for UI */
  status: authedProcedure.query(() => ({
    enabled: isComputerRuntimeEnabled(),
    browserEnabled: isComputerBrowserEnabled(),
    // sessionCore currently provisions MockBrowserProvider only. Expose that truth to the orchestrator/UI.
    browserProvider: "mock" as const,
    liveExternalWebEnabled: false,
    humanTakeoverEnabled: isComputerHumanTakeoverEnabled(),
    artifactIngestionEnabled: isComputerArtifactIngestionEnabled(),
    desktopEnabled: isComputerDesktopEnabled(),
    persistedAuthEnabled: isComputerPersistedAuthEnabled(),
  })),

  createSession: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      runId: z.string().uuid().optional(),
      stepId: z.string().max(100).optional(),
      startUrl: z.string().max(2_000).optional(),
      label: z.string().max(160).optional(),
      /** PR-6E: reuse remembered login (id only; ciphertext never leaves server) */
      authContextId: z.string().uuid().optional(),
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
      effect: browserEffectSchema,
      confirmedEffect: browserEffectSchema.optional(),
      leaseVersion: z.number().int().min(0).optional(),
      expectedSessionRevision: z.number().int().min(0).optional(),
    }))
    .mutation(({ ctx, input }) => {
      assertBrowserEffectContract(input.action, input.effect, input.confirmedEffect);
      return runComputerAction({
        auth: ctx.auth,
        sessionId: input.sessionId,
        actionId: input.actionId,
        action: input.action,
        leaseVersion: input.leaseVersion,
        expectedSessionRevision: input.expectedSessionRevision,
      });
    }),

  stop: authedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) => stopComputerSession({ auth: ctx.auth, sessionId: input.sessionId })),

  /** PR-6B：AI 請求人類接管（登入／2FA／判斷） */
  requestTakeover: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      reasonCode: z.enum([
        "login_required",
        "two_factor",
        "captcha_or_challenge",
        "sensitive_input",
        "subjective_judgment",
        "user_requested",
        "other",
      ]),
      userMessage: z.string().trim().min(1).max(300),
      expectedLeaseVersion: z.number().int().min(0).optional(),
    }))
    .mutation(({ ctx, input }) => requestHumanTakeover({ auth: ctx.auth, ...input })),

  /** PR-6B：使用者取得控制權（AI input 立即失效） */
  acquireControl: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      expectedLeaseVersion: z.number().int().min(0).optional(),
    }))
    .mutation(({ ctx, input }) => acquireHumanControl({ auth: ctx.auth, ...input })),

  /** PR-6B：交回 AI；server 會 re-observe，AI 必須 inspect 後才能再 act */
  releaseToAgent: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      expectedLeaseVersion: z.number().int().min(0).optional(),
    }))
    .mutation(({ ctx, input }) => releaseControlToAgent({ auth: ctx.auth, ...input })),

  /** PR-6C：列出 session 成品 */
  listArtifacts: authedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) => listArtifactsForSession(ctx.auth, input.sessionId)),

  /** PR-6C：mock / demo 偵測下載（1×1 PNG） */
  detectMockArtifact: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      actionId: z.string().min(8).max(120).optional(),
      sceneId: z.string().uuid().optional(),
      title: z.string().max(80).optional(),
    }))
    .mutation(({ ctx, input }) => detectMockArtifact({
      auth: ctx.auth,
      sessionId: input.sessionId,
      actionId: input.actionId,
      outputContract: {
        artifactType: "image",
        attachTo: input.sceneId ? "scene" : "project",
        sceneId: input.sceneId,
        title: input.title,
      },
    })),

  /** PR-6C：從安全 https URL 下載進 quarantine */
  registerFromUrl: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      actionId: z.string().min(8).max(120),
      url: z.string().url().max(2_000),
      filename: z.string().max(200).optional(),
      sceneId: z.string().uuid().optional(),
      title: z.string().max(80).optional(),
    }))
    .mutation(({ ctx, input }) => registerArtifactFromUrl({
      auth: ctx.auth,
      sessionId: input.sessionId,
      actionId: input.actionId,
      url: input.url,
      filename: input.filename,
      outputContract: {
        attachTo: input.sceneId ? "scene" : "project",
        sceneId: input.sceneId,
        title: input.title,
      },
    })),

  /** PR-6C：掃描通過後匯入 Asset（sha256 去重） */
  importArtifact: authedProcedure
    .input(z.object({
      artifactId: z.string().uuid(),
      forceDuplicate: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => importArtifactToProject({
      auth: ctx.auth,
      artifactId: input.artifactId,
      forceDuplicate: input.forceDuplicate,
    })),

  /** PR-6D：建立桌面工作電腦 */
  createDesktopSession: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      runId: z.string().uuid().optional(),
      stepId: z.string().max(100).optional(),
      startApp: z.string().max(40).optional(),
      label: z.string().max(160).optional(),
    }))
    .mutation(({ ctx, input }) => createDesktopSession({ auth: ctx.auth, ...input })),

  /** PR-6D：Browser → Desktop 升級（記錄 observable reason） */
  escalateToDesktop: authedProcedure
    .input(z.object({
      browserSessionId: z.string().uuid(),
      reasonCode: z.enum([
        "native_gui_app",
        "multi_app_file_transfer",
        "canvas_or_unstable_dom",
        "os_file_manager",
        "user_requested",
      ]),
      detail: z.string().max(120).optional(),
      startApp: z.string().max(40).optional(),
    }))
    .mutation(({ ctx, input }) => escalateBrowserToDesktop({ auth: ctx.auth, ...input })),

  /** PR-6D：桌面動作（screenshot / click / type / …） */
  desktopAct: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      actionId: z.string().min(8).max(120),
      action: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("screenshot") }),
        z.object({
          kind: z.literal("click"),
          x: z.number().min(0).max(1000),
          y: z.number().min(0).max(1000),
          button: z.enum(["left", "right"]).optional(),
        }),
        z.object({
          kind: z.literal("type"),
          text: z.string().max(4_000),
          sensitive: z.boolean().optional(),
        }),
        z.object({ kind: z.literal("key"), key: z.string().min(1).max(40) }),
        z.object({
          kind: z.literal("scroll"),
          x: z.number().min(0).max(1000),
          y: z.number().min(0).max(1000),
          dy: z.number().int().min(-5000).max(5000),
        }),
        z.object({
          kind: z.literal("drag"),
          x1: z.number().min(0).max(1000),
          y1: z.number().min(0).max(1000),
          x2: z.number().min(0).max(1000),
          y2: z.number().min(0).max(1000),
        }),
        z.object({ kind: z.literal("wait"), ms: z.number().int().min(0).max(15_000) }),
      ]),
      leaseVersion: z.number().int().min(0).optional(),
      expectedSessionRevision: z.number().int().min(0).optional(),
    }))
    .mutation(({ ctx, input }) => runDesktopAction({
      auth: ctx.auth,
      sessionId: input.sessionId,
      actionId: input.actionId,
      action: input.action,
      leaseVersion: input.leaseVersion,
      expectedSessionRevision: input.expectedSessionRevision,
    })),

  /** PR-6D：vision planner stub（不自動執行，只回傳建議動作） */
  planDesktopActions: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      goal: z.string().trim().min(1).max(500),
    }))
    .mutation(({ ctx, input }) => planAndOptionallyPreviewDesktop({
      auth: ctx.auth,
      sessionId: input.sessionId,
      goal: input.goal,
    })),

  /** PR-6E：明確 opt-in 記住目前 session 的服務登入（加密 opaque） */
  saveAuthContext: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      explicitOptIn: z.literal(true),
      serviceLabel: z.string().max(80).optional(),
    }))
    .mutation(({ ctx, input }) => saveAuthContextFromSession({
      auth: ctx.auth,
      sessionId: input.sessionId,
      explicitOptIn: input.explicitOptIn,
      serviceLabel: input.serviceLabel,
    })),

  listAuthContexts: authedProcedure
    .input(z.object({ includeRevoked: z.boolean().optional() }).optional())
    .query(({ ctx, input }) => listAuthContexts(ctx.auth, {
      includeRevoked: input?.includeRevoked,
    })),

  revokeAuthContext: authedProcedure
    .input(z.object({ authContextId: z.string().uuid() }))
    .mutation(({ ctx, input }) => revokeAuthContext({
      auth: ctx.auth,
      authContextId: input.authContextId,
    })),
});
