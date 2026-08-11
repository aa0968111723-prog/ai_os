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
  /** Final external effect, not merely the fact that a browser is used. */
  effect: BrowserEffect;
  confirmedEffect?: BrowserEffect;
}

export const BROWSER_EFFECTS = ["observe", "navigate", "download", "form_fill", "submit", "send_message", "publish", "purchase", "delete", "oauth_login_takeover"] as const;
export type BrowserEffect = typeof BROWSER_EFFECTS[number];
export type BrowserEffectRisk = "read" | "safe_write" | "external" | "financial" | "destructive" | "identity";

export function browserEffectPolicy(effect: BrowserEffect, confirmedEffect?: BrowserEffect) {
  const risk: BrowserEffectRisk = effect === "observe" || effect === "navigate"
    ? "read"
    : effect === "download" || effect === "form_fill"
      ? "safe_write"
      : effect === "purchase"
        ? "financial"
        : effect === "delete"
          ? "destructive"
          : effect === "oauth_login_takeover"
            ? "identity"
            : "external";
  const confirmationRequired = ["submit", "send_message", "publish", "purchase", "delete", "oauth_login_takeover"].includes(effect);
  return {
    effect,
    risk,
    confirmationRequired,
    allowed: !confirmationRequired || confirmedEffect === effect,
    reason: confirmationRequired && confirmedEffect !== effect ? "EXPLICIT_EFFECT_CONFIRMATION_REQUIRED" as const : null,
  };
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
