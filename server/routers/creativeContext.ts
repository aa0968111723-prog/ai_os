import { z } from "zod";
import { authedProcedure, router } from "../trpc";
import { composeProjectCreativeContext } from "../services/projectCreativeContext";
import {
  freezeShotContextPacket,
  listShotContextPackets,
  refreshShotContextStaleness,
} from "../services/shotContextPackets";
import {
  buildDatasetManifest,
  promoteConsistencyVersion,
  queueConsistencyTraining,
  rollbackConsistencyVersion,
  trainingAvailability,
} from "../services/consistencyTraining";
import { projectWorkspaceProjection } from "../services/projectConsistencyGraph";
import { adoptGenerationCurrent } from "../services/consistencyAdopt";
import { extractEndFrame } from "../services/derivedFrames";
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
  workspace: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return projectWorkspaceProjection({ auth: ctx.auth, projectId: input.projectId });
    }),

  adoptGeneration: authedProcedure
    .input(z.object({ generationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return adoptGenerationCurrent({ auth: ctx.auth, generationId: input.generationId });
    }),

  extractEndFrame: authedProcedure
    .input(z.object({ videoAssetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return extractEndFrame({ auth: ctx.auth, videoAssetId: input.videoAssetId });
    }),

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

  /**
   * closure §7：單鏡完整血緣——packet／各軌 asset→generation→parent→canon deps＋
   * derived findings。回答「這支影片從哪張圖來、這段旁白用的是哪個聲線版本」。
   */
  shotLineage: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      shotId: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const { projectMediaLineage } = await import("../services/mediaLineage");
      const result = await projectMediaLineage({
        auth: ctx.auth,
        projectId: input.projectId,
        lineageShotIds: [input.shotId],
      });
      return {
        lineage: result.lineages[0] ?? null,
        projectFindings: result.findings.length,
      };
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
      const changed = input.changedKind && input.changedId
        ? { kind: input.changedKind, id: input.changedId }
        : undefined;
      // 場景 package 與 shot packet 同一次重算（§6：package 也有指紋與 stale）
      const { refreshScenePackageStaleness } = await import("../services/scenePackages");
      const scenePackages = await refreshScenePackageStaleness({
        auth: ctx.auth,
        projectId: input.projectId,
        changed,
      });
      const shots = await refreshShotContextStaleness({
        auth: ctx.auth,
        projectId: input.projectId,
        changed,
      });
      return { ...shots, staleStorySceneIds: scenePackages.staleStorySceneIds };
    }),

  trainingAvailability: authedProcedure.query(async () => trainingAvailability()),

  buildDataset: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      characterId: z.string().uuid().optional(),
      lookId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return buildDatasetManifest({
        auth: ctx.auth,
        projectId: input.projectId,
        characterId: input.characterId,
        lookId: input.lookId,
      });
    }),

  queueTraining: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      characterId: z.string().uuid().optional(),
      lookId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return queueConsistencyTraining({
        auth: ctx.auth,
        projectId: input.projectId,
        characterId: input.characterId,
        lookId: input.lookId,
      });
    }),

  promoteVersion: authedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return promoteConsistencyVersion({ auth: ctx.auth, versionId: input.versionId });
    }),

  rollbackVersion: authedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return rollbackConsistencyVersion({ auth: ctx.auth, versionId: input.versionId });
    }),
});
