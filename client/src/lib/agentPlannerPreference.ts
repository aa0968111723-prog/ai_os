import {
  agentPlannerModeSchema,
  type AgentPlannerMode,
} from "@shared/agentPlanner";

export const AGENT_PLANNER_STORAGE_KEY = "aios.agentPlannerMode";

export function readAgentPlannerMode(): AgentPlannerMode {
  if (typeof window === "undefined") return "auto";
  try {
    const parsed = agentPlannerModeSchema.safeParse(window.localStorage.getItem(AGENT_PLANNER_STORAGE_KEY));
    return parsed.success ? parsed.data : "auto";
  } catch {
    return "auto";
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
