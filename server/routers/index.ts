import { router } from "../trpc";
import { authRouter } from "./auth";
import { adminRouter } from "./admin";
import { projectsRouter } from "./projects";
import { generationRouter } from "./generation";
import { messagesRouter } from "./messages";
import { scenesRouter } from "./scenes";
import { quotaRouter } from "./quota";

export const appRouter = router({
  auth: authRouter,
  admin: adminRouter,
  projects: projectsRouter,
  generation: generationRouter,
  messages: messagesRouter,
  scenes: scenesRouter,
  quota: quotaRouter,
});

export type AppRouter = typeof appRouter;
