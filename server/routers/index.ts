import { router } from "../trpc";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { generationRouter } from "./generation";
import { projectsRouter } from "./projects";
import { systemRouter } from "./system";
import { modelsRouter } from "./models";
import { scenesRouter } from "./scenes";
import { approvalsRouter } from "./approvals";
import { directorRouter } from "./director";
import { quotaRouter } from "./quota";

export const appRouter = router({
  auth: authRouter,
  admin: adminRouter,
  generation: generationRouter,
  projects: projectsRouter,
  system: systemRouter,
  models: modelsRouter,
  scenes: scenesRouter,
  approvals: approvalsRouter,
  director: directorRouter,
  quota: quotaRouter,
});

export type AppRouter = typeof appRouter;
