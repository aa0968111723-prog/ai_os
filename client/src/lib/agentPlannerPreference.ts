import {
  agentPlannerModeSchema,
  DEFAULT_AGENT_PLANNER_MODE,
  type AgentPlannerMode,
} from "@shared/agentPlanner";

export const AGENT_PLANNER_STORAGE_KEY = "aios.agentPlannerMode";

export function readAgentPlannerMode(): AgentPlannerMode {
  if (typeof window === "undefined") return DEFAULT_AGENT_PLANNER_MODE;
  try {
    const parsed = agentPlannerModeSchema.safeParse(window.localStorage.getItem(AGENT_PLANNER_STORAGE_KEY));
    return parsed.success ? parsed.data : DEFAULT_AGENT_PLANNER_MODE;
  } catch {
    return DEFAULT_AGENT_PLANNER_MODE;
  }
}

export function writeAgentPlannerMode(mode: AgentPlannerMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AGENT_PLANNER_STORAGE_KEY, mode);
  } catch {
    // 隱私模式／儲存空間被封鎖時只維持當次頁面選擇。
  }
}

/**
 * 聊天助手的「回答模型」是另一個偏好，預設免費。
 *
 * 兩者刻意分開：代理規劃一次決定整份計畫要燒多少執行點數，值得用高品質模型（並依 token 計點）；
 * 而聊天是整天在問的高頻動作，預設就該是免費額度。共用一個鍵的話，把規劃調成高品質會連帶
 * 讓每一句閒聊都跑付費模型——使用者從沒同意過那件事。
 */
export const ASSISTANT_ANSWER_MODE_STORAGE_KEY = "aios.assistantAnswerMode";
export const DEFAULT_ASSISTANT_ANSWER_MODE: AgentPlannerMode = "nim";

export function readAssistantAnswerMode(): AgentPlannerMode {
  if (typeof window === "undefined") return DEFAULT_ASSISTANT_ANSWER_MODE;
  try {
    const parsed = agentPlannerModeSchema.safeParse(window.localStorage.getItem(ASSISTANT_ANSWER_MODE_STORAGE_KEY));
    return parsed.success ? parsed.data : DEFAULT_ASSISTANT_ANSWER_MODE;
  } catch {
    return DEFAULT_ASSISTANT_ANSWER_MODE;
  }
}

export function writeAssistantAnswerMode(mode: AgentPlannerMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ASSISTANT_ANSWER_MODE_STORAGE_KEY, mode);
  } catch {
    // 隱私模式／儲存空間被封鎖時只維持當次頁面選擇。
  }
}
