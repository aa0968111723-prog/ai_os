/**
 * Policy Engine（TD-01）：統一團隊／組／專案／成本相關授權問題。
 *
 * 設計：
 * - 所有 transport（web/tRPC、rest、mcp、workflow、agent、system）應問同一組 PolicyAction。
 * - 前端 capability 只能來自後端回傳或本模組的純函式映射，不可自行拼 isAdmin||isLeader。
 * - 本模組「不」直接讀 DB 專案列；projectRole（editor/viewer）由呼叫端注入，避免循環依賴。
 * - 成本門檻（requiresApproval）在 generation 路徑由 submitGenerationCore 依 group 設定落地；
 *   evaluatePolicy 可依 estimatedPoints + threshold 預判 requiresApproval。
 *
 * 相容：capabilitiesFromAuth 將既有 admin/leader/member + isSuperAdmin 映成 capability 集合。
 */
import { TRPCError } from "@trpc/server";
import type { AuthState } from "./auth";

export type PolicyAction =
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
  | "note.create"
  | "note.append"
  | "database.read"
  | "database.write"
  | "audit.view";

/** transport 來源；tRPC direct 歸 web（見架構文件） */
export type PolicySource = "web" | "rest" | "mcp" | "workflow" | "agent" | "system";

export type GroupRole = "admin" | "leader" | "member";
export type ProjectRole = "editor" | "viewer";

export interface PolicyContext {
  actorId: string;
  teamId?: string;
  groupId?: string;
  projectId?: string;
  source: PolicySource;
  /** 估點；與 group 門檻一併用來 requiresApproval */
  estimatedPoints?: number;
  /** 組成本審核門檻（點）；null/undefined＝無門檻 */
  approvalThresholdPoints?: number | null;
  /** 組內角色；缺 group 或非成員時不給寫入類 action */
  groupRole?: GroupRole | null;
  /** 專案層角色；缺省視為 editor（與 projectAcl 無列＝editor 相容） */
  projectRole?: ProjectRole | null;
  /** 開發者／超級管理員 */
  isSuperAdmin?: boolean;
  /** 是否為該 team 的 team admin */
  isTeamAdmin?: boolean;
}

export type PolicyDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  /** 拒絕時建議的 tRPC code（供 assertPolicy 使用） */
  code?: "FORBIDDEN" | "UNAUTHORIZED" | "BAD_REQUEST" | "PRECONDITION_FAILED";
};

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

/** 舊角色 → capability（不改 DB；純映射） */
export function capabilitiesForGroupRole(
  role: GroupRole | null | undefined,
  opts: { isSuperAdmin?: boolean; isTeamAdmin?: boolean; projectRole?: ProjectRole | null } = {},
): Set<Capability> {
  const caps = new Set<Capability>();
  if (opts.isSuperAdmin || opts.isTeamAdmin) {
    for (const c of [
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
    ] as Capability[]) {
      caps.add(c);
    }
    return caps;
  }
  if (!role) return caps;

  // 所有組員至少可看專案與讀庫
  caps.add("project.view");
  caps.add("database.read");
  caps.add("team.view");

  const canEditProject = opts.projectRole !== "viewer";

  if (role === "admin" || role === "leader") {
    caps.add("group.manage_members");
    caps.add("generation.approve");
    caps.add("audit.view");
    if (role === "admin") caps.add("team.manage");
  }

  if (canEditProject) {
    caps.add("project.edit");
    caps.add("generation.submit");
    caps.add("agent.dispatch");
    caps.add("task.create");
    caps.add("schedule.create");
    caps.add("note.write");
    caps.add("database.write");
  }

  return caps;
}

/** 從 AuthState 取某組的 capability（純函式，便於前端 contract test） */
export function capabilitiesFromAuth(
  auth: AuthState,
  groupId: string,
  projectRole: ProjectRole | null = "editor",
): Set<Capability> {
  const membership = auth.groups.find((g) => g.groupId === groupId);
  const isTeamAdmin = membership ? auth.adminTeamIds.includes(membership.teamId) : false;
  return capabilitiesForGroupRole(membership?.role ?? null, {
    isSuperAdmin: auth.user.isSuperAdmin,
    isTeamAdmin,
    projectRole,
  });
}

/** 排序後的 capability 字串陣列（穩定序列化，供 auth.me 與 contract test） */
function sortedCapList(caps: Set<Capability>): Capability[] {
  return [...caps].sort();
}

/**
 * 為 auth.groups 中每一組計算 capability（預設 projectRole=editor）。
 * 回傳 Record<groupId, sorted Capability[]>，供前端導覽取代 isAdmin||isLeader。
 */
export function capabilitiesByGroupFromAuth(
  auth: AuthState,
  projectRole: ProjectRole | null = "editor",
): Record<string, Capability[]> {
  const out: Record<string, Capability[]> = {};
  for (const g of auth.groups) {
    out[g.groupId] = sortedCapList(capabilitiesFromAuth(auth, g.groupId, projectRole));
  }
  return out;
}

/**
 * 跨組／全域 capability：superAdmin 全套；team admin 至少 team.view + team.manage。
 * 未分組的團隊管理員仍可依此顯示「團隊管理」入口。
 */
export function globalCapabilitiesFromAuth(auth: AuthState): Capability[] {
  if (auth.user.isSuperAdmin) {
    return sortedCapList(capabilitiesForGroupRole(null, { isSuperAdmin: true }));
  }
  if (auth.adminTeamIds.length > 0) {
    return sortedCapList(new Set<Capability>(["team.view", "team.manage"]));
  }
  return [];
}

/** auth.me 登入時附加的 capability 欄位（不改 AuthState 本體） */
export function authMeCapabilities(auth: AuthState): {
  capabilitiesByGroupId: Record<string, Capability[]>;
  capabilities: Capability[];
} {
  return {
    capabilitiesByGroupId: capabilitiesByGroupFromAuth(auth),
    capabilities: globalCapabilitiesFromAuth(auth),
  };
}

function actionToCapability(action: PolicyAction): Capability {
  if (action === "note.create" || action === "note.append") return "note.write";
  return action as Capability;
}

/**
 * 同步政策評估（純函式、可單元測試）。
 * source 目前不改變允許結果（跨入口一致）；保留在 context 供稽核與未來細則。
 */
export function evaluatePolicy(action: PolicyAction, context: PolicyContext): PolicyDecision {
  void context.source; // 跨入口一致性：source 不作為繞過權限的依據

  if (!context.actorId) {
    return { allowed: false, requiresApproval: false, reason: "請先登入", code: "UNAUTHORIZED" };
  }

  const caps = capabilitiesForGroupRole(context.groupRole, {
    isSuperAdmin: context.isSuperAdmin,
    isTeamAdmin: context.isTeamAdmin,
    projectRole: context.projectRole ?? "editor",
  });

  // 無組歸屬時：僅 superAdmin 的 team.* 可能另走 adminProcedure；此處 generically 拒絕需組的 action
  const needsGroup: PolicyAction[] = [
    "project.view",
    "project.edit",
    "generation.submit",
    "generation.approve",
    "agent.dispatch",
    "task.create",
    "schedule.create",
    "note.create",
    "note.append",
    "database.read",
    "database.write",
    "group.manage_members",
    "audit.view",
  ];
  if (needsGroup.includes(action) && !context.groupRole && !context.isSuperAdmin && !context.isTeamAdmin) {
    return { allowed: false, requiresApproval: false, reason: "你不屬於這個組", code: "FORBIDDEN" };
  }

  const need = actionToCapability(action);
  if (!caps.has(need)) {
    if (context.projectRole === "viewer" && ["project.edit", "generation.submit", "agent.dispatch", "task.create", "schedule.create", "note.create", "note.append", "database.write"].includes(action)) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: "你在此專案是「檢視者」（唯讀）——要編輯請組長到專案權限卡調整",
        code: "FORBIDDEN",
      };
    }
    if (action === "generation.approve" || action === "group.manage_members") {
      return { allowed: false, requiresApproval: false, reason: "需要組長權限", code: "FORBIDDEN" };
    }
    if (action === "team.manage") {
      return { allowed: false, requiresApproval: false, reason: "需要團隊管理權限", code: "FORBIDDEN" };
    }
    return { allowed: false, requiresApproval: false, reason: "沒有執行此操作的權限", code: "FORBIDDEN" };
  }

  // 成本門檻：僅 member 的 generation.submit 觸發（與 submitGenerationCore 同語意）
  let requiresApproval = false;
  if (action === "generation.submit" && context.groupRole === "member") {
    const threshold = context.approvalThresholdPoints;
    const est = context.estimatedPoints ?? 0;
    if (threshold != null && threshold > 0 && est >= threshold) {
      requiresApproval = true;
    }
  }

  return { allowed: true, requiresApproval };
}

/** 拒絕時拋 TRPCError；允許時回 decision（含 requiresApproval） */
export function assertPolicy(action: PolicyAction, context: PolicyContext): PolicyDecision {
  const decision = evaluatePolicy(action, context);
  if (!decision.allowed) {
    throw new TRPCError({
      code: decision.code ?? "FORBIDDEN",
      message: decision.reason ?? "沒有執行此操作的權限",
    });
  }
  return decision;
}

/** 從 AuthState + groupId 組出 PolicyContext 骨架（projectRole／估點由呼叫端補） */
export function policyContextFromAuth(
  auth: AuthState,
  opts: {
    groupId?: string;
    projectId?: string;
    source: PolicySource;
    projectRole?: ProjectRole | null;
    estimatedPoints?: number;
    approvalThresholdPoints?: number | null;
  },
): PolicyContext {
  const membership = opts.groupId ? auth.groups.find((g) => g.groupId === opts.groupId) : undefined;
  const isTeamAdmin = membership ? auth.adminTeamIds.includes(membership.teamId) : false;
  return {
    actorId: auth.user.id,
    teamId: membership?.teamId,
    groupId: opts.groupId,
    projectId: opts.projectId,
    source: opts.source,
    groupRole: membership?.role ?? null,
    projectRole: opts.projectRole ?? "editor",
    isSuperAdmin: auth.user.isSuperAdmin,
    isTeamAdmin,
    estimatedPoints: opts.estimatedPoints,
    approvalThresholdPoints: opts.approvalThresholdPoints,
  };
}
