/**
 * Computer Runtime observable event types — integrate with agent event stream (PR-6).
 * Do not invent a parallel progress system.
 */

export const COMPUTER_EVENT_TYPES = [
  "computer:provisioning",
  "computer:ready",
  "computer:agent_control",
  "computer:waiting_human",
  "computer:human_control",
  "computer:agent_control_restored",
  "computer:action_started",
  "computer:action_completed",
  "computer:action_failed",
  "computer:artifact_detected",
  "computer:artifact_imported",
  "computer:auth_saved",
  "computer:auth_revoked",
  "computer:auth_reused",
  "computer:stopping",
  "computer:stopped",
  "computer:expired",
  "computer:failed",
] as const;

export type ComputerEventType = (typeof COMPUTER_EVENT_TYPES)[number];

export interface ComputerEventPayload {
  schemaVersion: 1;
  sessionId: string;
  runId?: string;
  stepId?: string;
  projectId: string;
  eventType: ComputerEventType;
  status: string;
  sequence?: number;
  occurredAt: string;
  summary: string;
  reason?: {
    code: string;
    category: string;
    userMessage: string;
    retryable: boolean;
    recommendedAction?: string;
  };
  computer?: {
    sessionId: string;
    runtimeKind: "browser" | "desktop";
    controlHolder: string;
    safeUrl?: string | null;
    actionKind?: string;
  };
}

export function computerEventToAgentObservationSummary(eventType: ComputerEventType, summary: string): string {
  return `[工作電腦] ${summary || eventType}`;
}
