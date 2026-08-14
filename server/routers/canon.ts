/**
 * Team Canon router（master plan §2–§4）。
 *
 * 薄殼風格（同 creativeContext）：ACL 與不變量全部在 server/services/teamCanon.ts；
 * 這裡只做輸入驗證與轉呼叫。所有 mutation 已登記 shared/auditWording.ts。
 */
import { z } from "zod";
import { authedProcedure, router } from "../trpc";
import { CANON_KINDS, CANON_LOCAL_ENTITY_KINDS, CANON_REUSE_SCOPES } from "../../shared/teamCanon";
import {
  addCanonVersionFromPin,
  applyCanonUpgrade,
  archiveCanonVersion,
  canonUpgradeImpact,
  createCanonFromEntity,
  createCanonVersionFromTraining,
  getCanonEntry,
  listCanonEntries,
  listProjectPins,
  pinCanonToProject,
  promoteCanonVersion,
  rollbackCanonVersion,
  setCanonRights,
  unpinCanon,
} from "../services/teamCanon";

export const canonRouter = router({
  list: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      kind: z.enum(CANON_KINDS).optional(),
      includeArchived: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return listCanonEntries({ auth: ctx.auth, ...input });
    }),

  get: authedProcedure
    .input(z.object({ canonId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return getCanonEntry({ auth: ctx.auth, canonId: input.canonId });
    }),

  projectPins: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listProjectPins({ auth: ctx.auth, projectId: input.projectId });
    }),

  upgradeImpact: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      canonId: z.string().uuid(),
      toVersionId: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return canonUpgradeImpact({ auth: ctx.auth, ...input });
    }),

  createFromEntity: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      entityKind: z.enum(CANON_LOCAL_ENTITY_KINDS),
      entityId: z.string().uuid(),
      /** 明確確認 rights 才會開放整組重用；否則先落 private（只有來源專案可用） */
      confirmRights: z.boolean(),
      summary: z.string().trim().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return createCanonFromEntity({ auth: ctx.auth, ...input });
    }),

  addVersionFromPin: authedProcedure
    .input(z.object({ pinId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return addCanonVersionFromPin({ auth: ctx.auth, pinId: input.pinId });
    }),

  addVersionFromTraining: authedProcedure
    .input(z.object({
      canonId: z.string().uuid(),
      modelVersionId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      return createCanonVersionFromTraining({ auth: ctx.auth, ...input });
    }),

  promoteVersion: authedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return promoteCanonVersion({ auth: ctx.auth, versionId: input.versionId });
    }),

  rollbackVersion: authedProcedure
    .input(z.object({
      canonId: z.string().uuid(),
      toVersionId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      return rollbackCanonVersion({ auth: ctx.auth, ...input });
    }),

  archiveVersion: authedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return archiveCanonVersion({ auth: ctx.auth, versionId: input.versionId });
    }),

  setRights: authedProcedure
    .input(z.object({
      canonId: z.string().uuid(),
      reuseScope: z.enum(CANON_REUSE_SCOPES).optional(),
      trainingAllowed: z.boolean().optional(),
      generationAllowed: z.boolean().optional(),
      rightsNote: z.string().trim().max(500).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return setCanonRights({ auth: ctx.auth, ...input });
    }),

  pin: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      canonId: z.string().uuid(),
      versionId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return pinCanonToProject({ auth: ctx.auth, ...input });
    }),

  unpin: authedProcedure
    .input(z.object({ pinId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return unpinCanon({ auth: ctx.auth, pinId: input.pinId });
    }),

  applyUpgrade: authedProcedure
    .input(z.object({
      pinId: z.string().uuid(),
      toVersionId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return applyCanonUpgrade({ auth: ctx.auth, ...input });
    }),
});
