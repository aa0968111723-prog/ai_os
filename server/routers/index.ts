import { router } from "../trpc";
import { authRouter } from "./auth";
import { sessionBootRouter } from "./sessionBoot";
import { adminRouter } from "./admin";
import { projectsRouter } from "./projects";
import { generationRouter } from "./generation";
import { messagesRouter } from "./messages";
import { scenesRouter } from "./scenes";
import { storyRouter } from "./story";
import { characterLooksRouter } from "./characterLooks";
import { quotaRouter } from "./quota";
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
import { globalAssistantRouter } from "./globalAssistant";
import { mcpTokensRouter } from "./mcpTokens";
import { databasesRouter } from "./databases";
import { dataHubRouter } from "./dataHub";
import { folderImportRouter } from "./folderImport";
import { projectContextRouter } from "./projectContext";
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
import { shareRouter } from "./share";
import { attachmentsRouter } from "./attachments";
import { notificationsRouter } from "./notifications";
import { collaborationRouter } from "./collaboration";
import { decisionsRouter } from "./decisions";
import { intelligenceRouter } from "./intelligence";
import { externalIntakeRouter } from "./externalIntake";
import { externalEditingRouter } from "./externalEditing";

export const appRouter = router({
  models: modelsRouter,
  auth: authRouter,
  sessionBoot: sessionBootRouter,
  admin: adminRouter,
  projects: projectsRouter,
  generation: generationRouter,
  messages: messagesRouter,
  scenes: scenesRouter,
  story: storyRouter,
  characterLooks: characterLooksRouter,
  quota: quotaRouter,
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
  globalAssistant: globalAssistantRouter,
  mcpTokens: mcpTokensRouter,
  databases: databasesRouter,
  // 資料中心 facade（只查詢、不寫入；既有 databases/knowledge/integrations 一個都沒改名）
  dataHub: dataHubRouter,
  folderImport: folderImportRouter,
  projectContext: projectContextRouter,
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
  share: shareRouter,
  attachments: attachmentsRouter,
  notifications: notificationsRouter,
  collaboration: collaborationRouter,
  decisions: decisionsRouter,
  intelligence: intelligenceRouter,
  externalIntake: externalIntakeRouter,
  externalEditing: externalEditingRouter,
});

export type AppRouter = typeof appRouter;
