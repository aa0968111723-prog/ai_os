import { router } from "../trpc";
import { authRouter } from "./auth";
import { adminRouter } from "./admin";
import { projectsRouter } from "./projects";
import { generationRouter } from "./generation";
import { messagesRouter } from "./messages";
import { scenesRouter } from "./scenes";
import { quotaRouter } from "./quota";
import { approvalsRouter } from "./approvals";
import { directorRouter } from "./director";
import { feedbackRouter } from "./feedback";
import { modelsRouter } from "./models";
import { knowledgeRouter } from "./knowledge";
import { charactersRouter } from "./characters";

export const appRouter = router({
  models: modelsRouter,
  auth: authRouter,
  admin: adminRouter,
  projects: projectsRouter,
  generation: generationRouter,
  messages: messagesRouter,
  scenes: scenesRouter,
  quota: quotaRouter,
  approvals: approvalsRouter,
  director: directorRouter,
  feedback: feedbackRouter,
  knowledge: knowledgeRouter,
  characters: charactersRouter,
});

export type AppRouter = typeof appRouter;
