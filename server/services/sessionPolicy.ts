/**
 * 所有已認證傳輸層（tRPC、Express、REST、MCP、WebSocket）共用的帳號閘門。
 * 管理員重設密碼後，session 仍用來允許「改密碼／登出」，但不可操作其他功能。
 */
export type SessionGateResult = "unauthenticated" | "password-change-required" | null;

export function sessionGate(auth: { user: { mustChangePassword: boolean } } | null): SessionGateResult {
  if (!auth) return "unauthenticated";
  if (auth.user.mustChangePassword) return "password-change-required";
  return null;
}
