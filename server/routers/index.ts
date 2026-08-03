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
import { propsRouter } from "./props";
import { promptsRouter } from "./prompts";
import { optionsRouter } from "./options";
import { feedbackReportsRouter } from "./feedbackReports";
import { workflowsRouter } from "./workflows";
import { assistantRouter } from "./assistant";
import { agentsRouter } from "./agents";
import { auditRouter } from "./audit";
import { insightsRouter } from "./insights";
import { notesRouter } from "./notes";
import { scheduleRouter } from "./schedule";
import { teamAssistantRouter } from "./teamAssistant";
import { mcpTokensRouter } from "./mcpTokens";
import { databasesRouter } from "./databases";
import { directoryRouter } from "./directory";
import { dmRouter } from "./dm";
import { googleCalendarRouter } from "./googleCalendar";
import { integrationsRouter } from "./integrations";
import { adobeRouter } from "./adobe";
import { knowledgeMapRouter } from "./knowledgeMap";
import { pushRouter } from "./push";
import { exportJobsRouter } from "./exportJobs";
import { tasksRouter } from "./tasks";
import { systemRouter } from "./system";
import { aiTraceRouter } from "./aiTrace";
import { userAiKeysRouter } from "./userAiKeys";
import { communityRouter } from "./community";

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
  props: propsRouter,
  prompts: promptsRouter,
  workflows: workflowsRouter,
  options: optionsRouter,
  feedbackReports: feedbackReportsRouter,
  assistant: assistantRouter,
  agents: agentsRouter,
  audit: auditRouter,
  insights: insightsRouter,
  notes: notesRouter,
  schedule: scheduleRouter,
  teamAssistant: teamAssistantRouter,
  mcpTokens: mcpTokensRouter,
  databases: databasesRouter,
  directory: directoryRouter,
  dm: dmRouter,
  googleCalendar: googleCalendarRouter,
  integrations: integrationsRouter,
  adobe: adobeRouter,
  knowledgeMap: knowledgeMapRouter,
  push: pushRouter,
  exportJobs: exportJobsRouter,
  tasks: tasksRouter,
  system: systemRouter,
  aiTrace: aiTraceRouter,
  userAiKeys: userAiKeysRouter,
  community: communityRouter,
});

export type AppRouter = typeof appRouter;
