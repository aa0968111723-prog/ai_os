/**
 * AI 代理規劃供應商低成本 canary。
 *
 * 預設驗 fal.ai 省用量模型；只輸出供應商、模型與 usage，不輸出模型原文或 reasoning。
 * 用法：
 *   npm run check:agent-planner
 *   AGENT_PLANNER_CANARY_MODE=auto npm run check:agent-planner
 */
import {
  agentPlannerModeSchema,
  type AgentPlannerMode,
} from "../shared/agentPlanner";
import { generateAgentPlanDraft } from "../server/services/agentPlannerProvider";

const requested = process.env.AGENT_PLANNER_CANARY_MODE?.trim() || "fal_economy";
const parsedMode = agentPlannerModeSchema.safeParse(requested);
if (!parsedMode.success) {
  console.error("❌ AGENT_PLANNER_CANARY_MODE 不正確");
  process.exitCode = 1;
} else {
  const mode: AgentPlannerMode = parsedMode.data;
  const prompt = `請產生一份最小但完整的 AI 代理計畫，只輸出 JSON：
{
  "summary": {
    "goal": "驗證代理規劃服務",
    "successCriteria": ["產生通過 schema 的計畫"],
    "assumptions": [],
    "missingInformation": [],
    "expectedOutputs": ["驗證筆記"],
    "risks": [],
    "milestones": [{"id":"m1","title":"驗證完成"}],
    "estimatedDurationMinutes": 5
  },
  "steps": [{
    "id": "note",
    "kind": "create_note",
    "title": "記錄驗證結果",
    "content": "AI 代理規劃供應商已完成結構化輸出驗證。",
    "milestoneId": "m1"
  }]
}
不要輸出 markdown、說明、reasoning 或 chain-of-thought。`;

  try {
    const result = await generateAgentPlanDraft(prompt, mode);
    const telemetry = result.telemetry;
    console.log("✅ AI 代理規劃 canary 通過");
    console.log(JSON.stringify({
      requestedMode: telemetry.requestedMode,
      provider: telemetry.provider,
      model: telemetry.model,
      attemptCount: telemetry.attemptCount,
      fallbackFrom: telemetry.fallbackFrom,
      totalTokens: telemetry.totalTokens,
      costUsd: telemetry.costUsd,
      validatedSteps: result.draft.steps.length,
    }, null, 2));
  } catch (error) {
    console.error(`❌ AI 代理規劃 canary 失敗：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
