import { router } from "../trpc";
import { authRouter } from "./auth";
import { adminRouter } from "./admin";
import { projectsRouter } from "./projects";
import { generationRouter } from "./generation";
import { messagesRouter } from "./messages";

export const appRouter = router({
  auth: authRouter,
  admin: adminRouter,
  projects: projectsRouter,
  generation: generationRouter,
  messages: messagesRouter,
});

export type AppRouter = typeof appRouter;
