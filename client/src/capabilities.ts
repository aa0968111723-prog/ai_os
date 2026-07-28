/**
 * 前端 capability 輔助（TD-05a／TD-05b）。
 * 真相來源是 auth.me 回傳的 capabilitiesByGroupId／capabilities（由 Policy Engine 計算）；
 * 請勿在 UI 自行拼 isAdmin||isLeader。
 */

/** 與 server/services/policyEngine Capability 對齊（字串 union，便於 client 不依賴 server 路徑） */
export type Capability =
  | "team.view"
  | "team.manage"
  | "group.manage_members"
  | "project.view"
  | "project.edit"
  | "generation.submit"
  | "generation.approve"
  | "agent.dispatch"
  | "task.create"
  | "schedule.create"
  | "note.write"
  | "database.read"
  | "database.write"
  | "audit.view";

/** Policy Engine 承認的 capability 集合（UI-only 字串不在此列 → 導覽回退 require） */
export const POLICY_CAPABILITIES: ReadonlySet<string> = new Set<Capability>([
  "team.view",
  "team.manage",
  "group.manage_members",
  "project.view",
  "project.edit",
  "generation.submit",
  "generation.approve",
  "agent.dispatch",
  "task.create",
  "schedule.create",
  "note.write",
  "database.read",
  "database.write",
  "audit.view",
]);

export function isPolicyCapability(cap: string): cap is Capability {
  return POLICY_CAPABILITIES.has(cap);
}

/** auth.me 登入後附加的 capability 欄位（未登入為 null） */
export type MeWithCapabilities = {
  capabilitiesByGroupId?: Record<string, readonly string[]>;
  /** 全域／跨組：superAdmin 全套、team admin 含 team.manage */
  capabilities?: readonly string[];
} | null | undefined;

/** auth.me 是否已附上 capability 欄位（TD-05a 之後登入必有；缺欄則導覽回退 require） */
export function meHasCapabilitiesData(me: MeWithCapabilities): boolean {
  if (!me) return false;
  return me.capabilities !== undefined || me.capabilitiesByGroupId !== undefined;
}

/**
 * 是否具備指定 capability。
 * - 有 groupId：先看該組 capabilitiesByGroupId，再 fallback 全域 capabilities
 * - 無 groupId：只查全域 capabilities（例如未分組的團隊管理員）
 */
export function hasCap(
  me: MeWithCapabilities,
  groupId: string | null | undefined,
  cap: Capability,
): boolean {
  if (!me) return false;
  if (groupId) {
    const groupCaps = me.capabilitiesByGroupId?.[groupId];
    if (groupCaps?.includes(cap)) return true;
  }
  return me.capabilities?.includes(cap) ?? false;
}

/** 任一組或全域具備該 capability（導覽「只要在任一組是組長」類閘門） */
export function hasCapInAnyGroup(me: MeWithCapabilities, cap: Capability): boolean {
  if (!me) return false;
  if (me.capabilities?.includes(cap)) return true;
  const byGroup = me.capabilitiesByGroupId;
  if (!byGroup) return false;
  return Object.values(byGroup).some((caps) => caps.includes(cap));
}
