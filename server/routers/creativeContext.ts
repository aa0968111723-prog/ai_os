import { z } from "zod";
import { authedProcedure, router } from "../trpc";
import { composeProjectCreativeContext } from "../services/projectCreativeContext";
import {
  freezeShotContextPacket,
  listShotContextPackets,
  refreshShotContextStaleness,
} from "../services/shotContextPackets";
import {
  confirmStoryEntityProposal,
  dismissStoryEntityProposal,
  listStoryEntityBindings,
  resolveStoryEntityBindings,
  setStoryEntityBindingLock,
  undoStoryEntityBinding,
} from "../services/storyEntityBinding";

export const creativeContextRouter = router({
  /**
   * 組出這個專案目前真正會用到的創作脈絡。
   * 回的是引用與出處，不是第二份角色／場景庫。
   */
  compose: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      sceneId: z.string().uuid().optional(),
      shotId: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return composeProjectCreativeContext({
        auth: ctx.auth,
        projectId: input.projectId,
        sceneId: input.sceneId,
        shotId: input.shotId,
      });
    }),

  resolveBindings: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return resolveStoryEntityBindings({
        auth: ctx.auth,
        projectId: input.projectId,
        persist: true,
      });
    }),

  listBindings: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listStoryEntityBindings({ auth: ctx.auth, projectId: input.projectId });
    }),

  confirmProposal: authedProcedure
    .input(z.object({
      proposalId: z.string().uuid(),
      entityId: z.string().uuid(),
      lock: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return confirmStoryEntityProposal({
        auth: ctx.auth,
        proposalId: input.proposalId,
        entityId: input.entityId,
        lock: input.lock,
      });
    }),

  dismissProposal: authedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return dismissStoryEntityProposal({ auth: ctx.auth, proposalId: input.proposalId });
    }),

  setLock: authedProcedure
    .input(z.object({ bindingId: z.string().uuid(), locked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return setStoryEntityBindingLock({
        auth: ctx.auth,
        bindingId: input.bindingId,
        locked: input.locked,
      });
    }),

  undoBinding: authedProcedure
    .input(z.object({ bindingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return undoStoryEntityBinding({ auth: ctx.auth, bindingId: input.bindingId });
    }),

  freezeShotPacket: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      shotId: z.string().uuid(),
      modelId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return freezeShotContextPacket({
        auth: ctx.auth,
        projectId: input.projectId,
        shotId: input.shotId,
        modelId: input.modelId,
      });
    }),

  listShotPackets: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      shotId: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return listShotContextPackets({
        auth: ctx.auth,
        projectId: input.projectId,
        shotId: input.shotId,
      });
    }),

  refreshStalePackets: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      changedKind: z.string().optional(),
      changedId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return refreshShotContextStaleness({
        auth: ctx.auth,
        projectId: input.projectId,
        changed: input.changedKind && input.changedId
          ? { kind: input.changedKind, id: input.changedId }
          : undefined,
      });
    }),
});
