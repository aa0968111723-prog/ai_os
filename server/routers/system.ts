import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import { assessStoragePersistence } from "../services/storage";
import { getStorageHealth, acknowledgeVolumeChange } from "../services/storageHealth";
import { runStorageAudit } from "../services/storageAudit";
import { audit } from "../services/audit";

export const systemRouter = router({
  storageHealth: protectedProcedure.query(async () => {
    return getStorageHealth();
  }),

  acknowledgeVolumeChange: adminProcedure.mutation(async ({ ctx }) => {
    await acknowledgeVolumeChange();
    await audit(ctx, "system.acknowledgeVolumeChange", {});
    return { ok: true as const };
  }),

  runStorageAudit: adminProcedure
    .input(z.object({ mode: z.enum(["sample", "full"]).default("sample") }).optional())
    .mutation(async ({ input }) => {
      return runStorageAudit(input?.mode ?? "sample");
    }),
});
