/**
 * AI 專案職能目錄（L0／L1 產品敘事＋規劃提示用）。
 *
 * 定錨：人是專案成員；AI 是可啟用的職能席位——不是 memberships 假帳號，
 * 也不是獨立 multi-agent runtime。執行時仍建立一筆既有 agent_run。
 *
 * 見 docs/product/ai-project-roles-concept.md
 */

export type AiProjectRolePrimary = "llm" | "runner" | "fal" | "human" | "rules";

export interface AiProjectRole {
  /** 穩定 id，例 role.storyboard — 勿任意改動（測試守門） */
  id: string;
  /** 使用者稱呼（繁中） */
  title: string;
  /** 一句話摘要 */
  summary: string;
  /** 主要由誰完成 */
  primary: AiProjectRolePrimary;
  /** 典型 agent step kinds（提示／UI 用，非強制 schema） */
  kindHints: string[];
  /** 人必須保留的決策 */
  humanKeeps: string[];
  /** 下目標時可用的預設 goal 提示 */
  defaultGoalHint: string;
}

/** 產品初稿職能表（順序＝UI 展示順序） */
export const AI_PROJECT_ROLES: readonly AiProjectRole[] = [
  {
    id: "role.director",
    title: "企劃／導演助理",
    summary: "澄清目標、補齊缺資訊、產出可核准的計畫摘要。",
    primary: "llm",
    kindHints: ["create_note", "create_task", "wait_for_human", "request_approval"],
    humanKeeps: ["核准計畫", "定調"],
    defaultGoalHint: "幫我釐清這支短片的目標、成功條件與還缺什麼資訊",
  },
  {
    id: "role.storyboard",
    title: "分鏡助理",
    summary: "拆腳本 → 建分鏡 → 帶定裝生成畫面（可選配音）。",
    primary: "llm",
    kindHints: ["split_script", "create_scene", "generate", "voiceover"],
    humanKeeps: ["選鏡", "擋禁忌"],
    defaultGoalHint: "把知識庫的腳本拆成分鏡，並為每一鏡生成畫面（記得帶角色定裝）",
  },
  {
    id: "role.generate",
    title: "生成員",
    summary: "單步／多步媒體生成與旁白，一律經 generationCommand 扣點。",
    primary: "fal",
    kindHints: ["generate", "voiceover"],
    humanKeeps: ["預算與重跑上限"],
    defaultGoalHint: "為現有分鏡逐鏡出圖，優先經濟模型",
  },
  {
    id: "role.continuity",
    title: "定裝守門",
    summary: "確保 generate 帶 characterIds／presets／continuity，不讓跨鏡走樣。",
    primary: "rules",
    kindHints: ["generate", "create_scene"],
    humanKeeps: ["升版 bible", "改設定"],
    defaultGoalHint: "檢查分鏡生成是否都綁定角色定裝與場景預設",
  },
  {
    id: "role.voice",
    title: "配音統籌",
    summary: "為有配音詞的分鏡產出旁白（模型白名單內）。",
    primary: "fal",
    kindHints: ["voiceover"],
    humanKeeps: ["選音色", "過稿"],
    defaultGoalHint: "為已有配音詞的分鏡都生成旁白",
  },
  {
    id: "role.qa",
    title: "品管",
    summary: "過片與品質把關；VLM 評分預設關閉，以人類為主。",
    primary: "human",
    kindHints: ["request_approval", "wait_for_human", "create_task"],
    humanKeeps: ["過片", "上架"],
    defaultGoalHint: "列出第 1 鏡仍需人工確認的風險",
  },
] as const;

const ROLE_BY_ID = new Map(AI_PROJECT_ROLES.map((r) => [r.id, r]));

export function listAiProjectRoles(): readonly AiProjectRole[] {
  return AI_PROJECT_ROLES;
}

export function getAiProjectRole(id: string): AiProjectRole | undefined {
  return ROLE_BY_ID.get(id);
}

/**
 * 濃縮職能花名冊，注入規劃 prompt。
 * 提醒 LLM：職能是心智標籤，不是假 user；步驟仍用既有 kind。
 */
export function formatRoleRosterForPrompt(): string {
  const lines = AI_PROJECT_ROLES.map(
    (r) =>
      `- ${r.id}「${r.title}」｜主體=${r.primary}｜典型步驟=${r.kindHints.join(",") || "—"}｜人保留：${r.humanKeeps.join("、")}`,
  );
  return [
    "【AI 職能席位】（產品敘事／規劃心智；不是真人成員，禁止假設有 AI 假帳號）",
    "規劃時可依目標對應職能拆步，但輸出 steps 仍只能使用既有 kind；執行時仍是一筆 agent_run。",
    ...lines,
  ].join("\n");
}
