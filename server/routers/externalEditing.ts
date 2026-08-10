import { z } from "zod";
import { authedProcedure, router } from "../trpc";
import {
  editingEditorIdSchema,
  editingHandoffModeSchema,
  editingSelectionTypeSchema,
  LUMAFUSION_ADAPTER,
} from "../../shared/externalEditing";
import {
  cancelEditingSession,
  completeEditingSession,
  listEditingSessions,
  markEditingSessionHandedOff,
  prepareEditingHandoff,
  previewEditingHandoff,
  reprepareEditingPackage,
} from "../services/externalEditingBridge";

const selectionSchema = z.object({
  projectId: z.string().uuid(),
  selectionType: editingSelectionTypeSchema,
  storySceneIds: z.array(z.string().uuid()).max(100).default([]),
  shotIds: z.array(z.string().uuid()).max(500).default([]),
  primaryAssetOverrides: z.record(z.string().uuid(), z.string().uuid()).default({}),
});

const returnContextSchema = z.object({
  assistantSurface: z.enum(["global", "project", "group_campaign"]),
  conversationId: z.string(),
  runId: z.string().optional(),
  originRoute: z.string(),
  originScrollY: z.number().optional(),
  focusAnchor: z.string().optional(),
  projectId: z.string().optional(),
  groupId: z.string().optional(),
});

export const externalEditingRouter = router({
  adapters: authedProcedure.query(() => [LUMAFUSION_ADAPTER]),

  preview: authedProcedure.input(selectionSchema).query(({ ctx, input }) =>
    previewEditingHandoff(ctx.auth, input)),

  prepare: authedProcedure.input(selectionSchema.extend({
    editorId: editingEditorIdSchema.default("lumafusion"),
    handoffMode: editingHandoffModeSchema.default("download"),
    originAssistantRunId: z.string().uuid().optional(),
    originConversationId: z.string().max(200).optional(),
    originSurface: z.string().max(100).optional(),
    returnContext: returnContextSchema.optional(),
  })).mutation(({ ctx, input }) => prepareEditingHandoff(ctx.auth, input)),

  list: authedProcedure.input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => listEditingSessions(ctx.auth, input.projectId)),

  markHandedOff: authedProcedure.input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) => markEditingSessionHandedOff(ctx.auth, input.sessionId)),

  reprepare: authedProcedure.input(z.object({
    sessionId: z.string().uuid(),
    handoffMode: editingHandoffModeSchema.optional(),
  })).mutation(({ ctx, input }) => reprepareEditingPackage(ctx.auth, input.sessionId, input.handoffMode)),

  cancel: authedProcedure.input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) => cancelEditingSession(ctx.auth, input.sessionId)),

  complete: authedProcedure.input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) => completeEditingSession(ctx.auth, input.sessionId)),
});
