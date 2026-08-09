/**
 * Browser execution is a last-resort adapter, never the implementation for an
 * Aios-owned capability. Production browser sessions can implement this
 * contract later without teaching the Command Center to click its own UI.
 */
export interface BrowserActionRequest {
  url: string;
  objective: string;
  returnContextId: string;
  reason: "no_internal_tool" | "no_connector" | "ui_required";
}

export interface BrowserActionHandle {
  sessionId: string;
  status: "prepared" | "running" | "waiting_user" | "completed" | "failed";
  externalUrl?: string;
}

export interface BrowserActionAdapter {
  readonly kind: "browser_fallback";
  canHandle(request: BrowserActionRequest): Promise<boolean>;
  prepare(request: BrowserActionRequest): Promise<BrowserActionHandle>;
  status(sessionId: string): Promise<BrowserActionHandle>;
  cancel(sessionId: string): Promise<void>;
}

export function browserFallbackAllowed(input: {
  hasInternalTool: boolean;
  hasConnector: boolean;
  requiresUiInteraction: boolean;
}): boolean {
  return !input.hasInternalTool && !input.hasConnector && input.requiresUiInteraction;
}
