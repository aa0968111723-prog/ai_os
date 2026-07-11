import { router, memberProcedure } from "../trpc";
import { projectsRouter } from "./projects";
import { generationRouter } from "./generation";
import { messagesRouter } from "./messages";

export const appRouter = router({
  me: memberProcedure.query(({ ctx }) => ctx.user),
  projects: projectsRouter,
  generation: generationRouter,
  messages: messagesRouter,
});

export type AppRouter = typeof appRouter;
