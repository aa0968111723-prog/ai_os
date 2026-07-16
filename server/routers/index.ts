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
import { scenePresetsRouter } from "./scenePresets";
import { promptsRouter } from "./prompts";
import { optionsRouter } from "./options";
import { feedbackReportsRouter } from "./feedbackReports";
import { workflowsRouter } from "./workflows";
import { assistantRouter } from "./assistant";
import { auditRouter } from "./audit";

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
  scenePresets: scenePresetsRouter,
  prompts: promptsRouter,
  workflows: workflowsRouter,
  options: optionsRouter,
  feedbackReports: feedbackReportsRouter,
  assistant: assistantRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;
