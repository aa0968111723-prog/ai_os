import { router } from "../trpc";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { generationRouter } from "./generation";
import { projectsRouter } from "./projects";
import { quotaRouter } from "./quota";
import { scenesRouter } from "./scenes";
import { systemRouter } from "./system";
import { directorRouter } from "./director";
import { modelsRouter } from "./models";
import { approvalsRouter } from "./approvals";

export const appRouter = router({
  admin: adminRouter,
  auth: authRouter,
  generation: generationRouter,
  projects: projectsRouter,
  quota: quotaRouter,
  scenes: scenesRouter,
  system: systemRouter,
  director: directorRouter,
  models: modelsRouter,
  approvals: approvalsRouter,
});

export type AppRouter = typeof appRouter;
