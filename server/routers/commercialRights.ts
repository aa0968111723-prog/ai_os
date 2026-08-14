import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import {
  evaluateRightsInputSchema,
  submitRightsAttestationSchema,
  RIGHTS_USAGE_CONTEXTS,
} from "../../shared/commercialRights";
import {
  evaluateAndStoreAssetRights,
  getAssetRights,
  listAssetRightsHistory,
  listProjectRights,
  projectDeliveryRights,
  submitRightsAttestation,
} from "../services/commercialRights";

export const commercialRightsRouter = router({
  get: authedProcedure
    .input(z.object({ assetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => getAssetRights({ auth: ctx.auth, assetId: input.assetId })),

  history: authedProcedure
    .input(z.object({ assetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => listAssetRightsHistory({ auth: ctx.auth, assetId: input.assetId })),

  project: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => listProjectRights({ auth: ctx.auth, projectId: input.projectId })),

  delivery: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      usageContext: z.enum(RIGHTS_USAGE_CONTEXTS).optional(),
    }))
    .query(async ({ ctx, input }) => projectDeliveryRights({
      auth: ctx.auth,
      projectId: input.projectId,
      usageContext: input.usageContext,
    })),

  recheck: authedProcedure
    .input(evaluateRightsInputSchema.pick({
      assetId: true,
      sourceType: true,
      sourceUrl: true,
      usageContext: true,
    }).extend({
      licenseText: z.string().trim().max(8_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => evaluateAndStoreAssetRights({
      auth: ctx.auth,
      assetId: input.assetId,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      licenseText: input.licenseText,
      usageContext: input.usageContext,
      trigger: "recheck",
    })),

  submitEvidence: authedProcedure
    .input(submitRightsAttestationSchema)
    .mutation(async ({ ctx, input }) => submitRightsAttestation({ auth: ctx.auth, ...input })),
});
