import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import { assessStoragePersistence, getStorageHealthSummary } from "../services/storageHealth";
import { acknowledgeVolumeChange } from "../services/storage";
import { runStorageAudit } from "../services/storageAudit";
import { getLastBackupAgeHours } from "../services/storageAudit";

export const systemRouter = router({
  health: protectedProcedure.query(async () => {
    return { ok: true };
  }),
  storageHealth: adminProcedure.query(async () => {
    return getStorageHealthSummary();
  }),
  acknowledgeVolumeChange: adminProcedure.mutation(async ({ ctx }) => {
    await acknowledgeVolumeChange(ctx.user.id);
    return { ok: true };
  }),
  runStorageAudit: adminProcedure
    .input(z.object({ mode: z.enum(["sample", "full"]).default("sample") }).optional())
    .mutation(async ({ input }) => {
      return runStorageAudit(input?.mode ?? "sample");
    }),
});
