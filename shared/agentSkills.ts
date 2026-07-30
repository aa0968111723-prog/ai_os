/**
 * 工作台「＋ 技能」目錄：把模式與 AI 職能收成同一套可掛選項。
 * 執行仍是既有 mode／agent_run——技能只改入口偏好與目標提示，不開第二 runtime。
 *
 * 見 docs/product/agent-skills-composer-ux.md
 */
import {
  AI_PROJECT_ROLES,
  type AiProjectRole,
  getAiProjectRole,
} from "./aiProjectRoles";

export type CreationModeSkillId = "ask" | "generate" | "template" | "plan";

export type AgentSkillId = CreationModeSkillId | AiProjectRole["id"];

export type AgentSkillKind = "mode" | "role";

/** 前端 Icon 名（與 client IconName 對齊的子集；字串避免 shared 依賴 React） */
export type AgentSkillIcon =
  | "MessageCircle"
  | "Image"
  | "Clapperboard"
  | "Film"
  | "Lightbulb"
  | "Sparkles"
  | "Palette"
  | "Mic"
  | "Check"
  | "User";

export interface AgentSkill {
  id: AgentSkillId;
  kind: AgentSkillKind;
  /** 短標籤（chip／卡面）— 人話，禁止露出 id */
  title: string;
  /** 選單一句話（創作者語） */
  summary: string;
  /** 對應工作台模式（role 技能預設帶去 plan） */
  mode: CreationModeSkillId;
  /** 空 goal 時可帶入的提示句 */
  goalHint?: string;
  /** 卡面圖示 */
  icon: AgentSkillIcon;
  /** 卡面情境小標（畫面感） */
  scene: string;
}

const MODE_SKILLS: readonly AgentSkill[] = [
  {
    id: "ask",
    kind: "mode",
    title: "一起想",
    summary: "發想開場、問專案現況、拆分鏡建議——先聊不扣點。",
    mode: "ask",
    goalHint: "幫我想這支短片怎麼開場比較有力量",
    icon: "Lightbulb",
    scene: "對談桌",
  },
  {
    id: "generate",
    kind: "mode",
    title: "直接出圖",
    summary: "選模型出圖或出片；送出前會先跟你確認點數。",
    mode: "generate",
    goalHint: "禪堂晨光，暖色，留白莊嚴",
    icon: "Image",
    scene: "攝影棚",
  },
  {
    id: "template",
    kind: "mode",
    title: "套用範本",
    summary: "固定套路一次串起：文字→圖→影…像剪輯預設流程。",
    mode: "template",
    goalHint: "用經濟路線做一段開場：圖＋短影片",
    icon: "Clapperboard",
    scene: "流水線",
  },
  {
    id: "plan",
    kind: "mode",
    title: "多步開拍",
    summary: "先排出步驟與花費，你過目後才背景開拍。",
    mode: "plan",
    goalHint: "把知識庫腳本拆成分鏡並逐鏡出圖",
    icon: "Film",
    scene: "導演場記",
  },
];

const ROLE_VISUAL: Record<string, { icon: AgentSkillIcon; scene: string; title?: string }> = {
  "role.director": { icon: "Lightbulb", scene: "企劃桌", title: "導演助理" },
  "role.storyboard": { icon: "Clapperboard", scene: "分鏡板", title: "分鏡助理" },
  "role.generate": { icon: "Sparkles", scene: "出圖台", title: "生成員" },
  "role.continuity": { icon: "Palette", scene: "定裝間", title: "定裝守門" },
  "role.voice": { icon: "Mic", scene: "配音室", title: "配音統籌" },
  "role.qa": { icon: "Check", scene: "審片間", title: "品管" },
};

function roleToSkill(role: AiProjectRole): AgentSkill {
  const v = ROLE_VISUAL[role.id] ?? { icon: "User" as const, scene: "劇組" };
  return {
    id: role.id,
    kind: "role",
    title: v.title ?? role.title,
    summary: role.summary,
    mode: "plan",
    goalHint: role.defaultGoalHint,
    icon: v.icon,
    scene: v.scene,
  };
}

const ROLE_SKILLS: readonly AgentSkill[] = AI_PROJECT_ROLES.map(roleToSkill);

/** 選單順序：先模式、再職能 */
export const AGENT_SKILLS: readonly AgentSkill[] = [...MODE_SKILLS, ...ROLE_SKILLS];

export function listAgentSkills(): readonly AgentSkill[] {
  return AGENT_SKILLS;
}

export function listModeSkills(): readonly AgentSkill[] {
  return MODE_SKILLS;
}

export function listRoleSkills(): readonly AgentSkill[] {
  return ROLE_SKILLS;
}

export function getAgentSkill(id: string): AgentSkill | undefined {
  return AGENT_SKILLS.find((s) => s.id === id);
}

/** 目前掛上的技能 → 建議工作台 mode（優先 role／plan，否則最後一個 mode 技能） */
export function resolveModeFromSkills(skillIds: readonly string[]): CreationModeSkillId | undefined {
  const skills = skillIds.map(getAgentSkill).filter(Boolean) as AgentSkill[];
  if (!skills.length) return undefined;
  const roleOrPlan = [...skills].reverse().find((s) => s.kind === "role" || s.id === "plan");
  if (roleOrPlan) return roleOrPlan.mode;
  const modeSkill = [...skills].reverse().find((s) => s.kind === "mode");
  return modeSkill?.mode;
}

/**
 * 若 goal 為空，用技能提示合成一句可送出的目標。
 * 多個職能時用「請 A、B：…」口吻（產品敘事，非真 multi-agent mesh）。
 */
export function composeGoalFromSkills(
  skillIds: readonly string[],
  currentGoal: string,
): string {
  const trimmed = currentGoal.trim();
  if (trimmed.length >= 5) return currentGoal;

  const skills = skillIds.map(getAgentSkill).filter(Boolean) as AgentSkill[];
  if (!skills.length) return currentGoal;

  const roles = skills.filter((s) => s.kind === "role");
  if (roles.length === 1) {
    return roles[0]!.goalHint?.trim() || currentGoal;
  }
  if (roles.length > 1) {
    const names = roles.map((r) => r.title.replace(/助理$|統籌$|守門$|／.*$/, "").trim() || r.title);
    const body =
      roles.find((r) => r.goalHint)?.goalHint?.replace(/^請[^：:]+[：:]/, "").trim() ||
      "完成這次製作目標";
    return `請${names.join("、")}：${body}`;
  }

  const mode = skills.find((s) => s.kind === "mode");
  return mode?.goalHint?.trim() || currentGoal;
}

/** 職能 id 是否仍存在（避免舊 draft 殘留） */
export function isKnownSkillId(id: string): boolean {
  return Boolean(getAgentSkill(id) || getAiProjectRole(id));
}
