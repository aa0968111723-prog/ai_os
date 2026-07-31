/**
 * 職能 Playbook（L1）：版本化步驟 *模板*——給規劃器作骨架提示，
 * **不會**在未 plan／approve 的情況下自動執行。
 *
 * 對應 docs/product/ai-project-roles-concept.md §7 L1。
 */

import { getAiProjectRole, listAiProjectRoles, type AiProjectRole } from "./aiProjectRoles";
import { buildSeriesPlannerHint } from "./seriesTemplate";

export interface RolePlaybook {
  id: string;
  roleId: string;
  version: string;
  title: string;
  /** 建議 goal 句型（可當 placeholder） */
  goalTemplate: string;
  /** 給 planner 的骨架說明 */
  plannerHint: string;
  /** 建議步驟 kind 順序（非強制） */
  suggestedKinds: string[];
}

/** 已落地 playbook 的職能（其餘職能仍有 roster，但無專屬骨架） */
export const ROLE_PLAYBOOKS: readonly RolePlaybook[] = [
  {
    id: "playbook.storyboard.v1",
    roleId: "role.storyboard",
    version: "1",
    title: "分鏡助理：拆腳本→分鏡→定裝生成",
    goalTemplate: "把知識庫腳本拆成分鏡，並為每一鏡生成畫面（帶角色定裝）",
    plannerHint:
      "分鏡職能建議骨架（依現況裁剪，勿硬湊）：" +
      "① split_script（有腳本時）→ ② create_scene（或沿用現有分鏡）→ " +
      "③ generate：needs 模型務必 sourceAssetRef／sourceUrl；跨鏡同角請帶 characterRefs（charN）與必要時 scenePresetRefs；" +
      "④ 可選 voiceover（分鏡已有配音詞時）。人員選鏡／擋禁忌用 create_task + wait_for_human 或 request_approval。",
    suggestedKinds: ["split_script", "create_scene", "generate", "voiceover"],
  },
  {
    id: "playbook.generate.v1",
    roleId: "role.generate",
    version: "1",
    title: "生成員：單／多步媒體生成",
    goalTemplate: "為指定分鏡出圖或出片（優先經濟模型，遵守點數預算）",
    plannerHint:
      "生成職能建議骨架：以 generate（與可選 voiceover）為主；" +
      "單目標可一步，多鏡用 dependsOn 串連或平行（無真實依賴則不必硬線）。" +
      "modelId 只抄模型速查；needs 模型必須有來源。生成一律經既有 Command 扣點，勿假設第二條路徑。" +
      "預算／重跑上限由人決定——超額風險列入 summary.risks 或 missingInformation。",
    suggestedKinds: ["generate", "voiceover"],
  },
  {
    id: "playbook.voice.v1",
    roleId: "role.voice",
    version: "1",
    title: "配音統籌：旁白 voiceover",
    goalTemplate: "為已有配音詞的分鏡生成旁白",
    plannerHint:
      "配音職能建議骨架：對有 voiceover 文案的分鏡排 voiceover 步驟（sceneNo）；" +
      "無配音詞則 missingInformation 或先 create_scene／請人補詞。" +
      "音色與過稿由人保留；需要確認時用 wait_for_human。",
    suggestedKinds: ["voiceover", "wait_for_human"],
  },
  {
    id: "playbook.director.v1",
    roleId: "role.director",
    version: "1",
    title: "企劃／導演助理：澄清與計畫摘要",
    goalTemplate: "釐清目標、成功條件與缺資訊，產出可核准的執行計畫",
    plannerHint:
      "導演職能：先把 summary 填完整（successCriteria／missingInformation／risks）；" +
      "能由 AI 做的整理用 create_note；需人定調用 create_task + wait_for_human 或 request_approval。" +
      "若目標已含明確產出（分鏡／出圖），可銜接其他職能 playbook 骨架，仍只輸出一份 steps。",
    suggestedKinds: ["create_note", "create_task", "wait_for_human", "request_approval"],
  },
  {
    id: "playbook.continuity.v1",
    roleId: "role.continuity",
    version: "1",
    title: "定裝守門：生成必帶定裝",
    goalTemplate: "確保分鏡生成綁定角色定裝與場景預設",
    plannerHint:
      "定裝職能：任何 generate 涉及固定角色時，characterRefs 必須使用上下文 charN；" +
      "場景一致用 scenePresetRefs（presetN）。缺定裝資料 → missingInformation，不要幻覺 UUID。" +
      "升版 bible／改設定由人完成（create_task）。",
    suggestedKinds: ["generate", "create_task", "wait_for_human"],
  },
  {
    id: "playbook.qa.v1",
    roleId: "role.qa",
    version: "1",
    title: "品管：送審與人工過片",
    goalTemplate: "送審指定分鏡並列出人工確認項",
    plannerHint:
      "品管職能以人為主：submit_approval（sceneNo）與 request_approval／wait_for_human；" +
      "VLM 自動評分預設不啟用。過片與上架決策不得自動化為無權限步驟。",
    suggestedKinds: ["submit_approval", "request_approval", "wait_for_human", "create_task"],
  },
  // #133 PR-3：創作代理短版——快速可交付影音／圖文，不是完整專案排程長計畫
  {
    id: "playbook.creation.short.v1",
    roleId: "role.storyboard", // 複用分鏡職能席位；短版靠 playbook id 與 plannerHint 區隔
    version: "1",
    title: "創作代理（短版）：腳本→分鏡→定裝生成→可選配音／送審",
    goalTemplate: "依專案世界觀與現有腳本／分鏡，產出可審的一版影音或圖文",
    plannerHint:
      "短版創作：優先 split_script? → create_scene? → generate（必帶定裝／來源）→ voiceover? → submit_approval?。" +
      "除非使用者明確要求排程／物資／多人分工，否則不要預設 create_schedule 或大量 create_task。" +
      "缺日期／缺腳本 → missingInformation，禁止臆測。" +
      "summary.rationale 用 1–3 句說明為何這條短路徑足夠。",
    suggestedKinds: ["split_script", "create_scene", "generate", "voiceover", "submit_approval"],
  },
  // #255 第 2 期：短影音母版備料串鏈——本集專案已從母版複製，代理只補料、關卡留在組長
  {
    id: "playbook.series.master.v1",
    roleId: "role.storyboard",
    version: "1",
    title: "母版備料：週更短影音 5 段串鏈（第 2 期）",
    goalTemplate: "依本集 4 格變數與母版 5 段結構，把這一集的旁白、分鏡提示與素材備齊並送組長待審",
    plannerHint: buildSeriesPlannerHint(),
    suggestedKinds: ["create_scene", "generate", "voiceover", "submit_approval"],
  },
] as const;

// roleId 對映保留「第一個」宣告的 playbook（storyboard 主 playbook 不被短版蓋掉）；
// 短版等追加款以 playbook id 取用。
const PLAYBOOK_BY_ROLE = new Map<string, RolePlaybook>();
for (const pb of ROLE_PLAYBOOKS) {
  if (!PLAYBOOK_BY_ROLE.has(pb.roleId)) PLAYBOOK_BY_ROLE.set(pb.roleId, pb);
}
const PLAYBOOK_BY_ID = new Map(ROLE_PLAYBOOKS.map((p) => [p.id, p]));

export function listPlaybooks(): readonly RolePlaybook[] {
  return ROLE_PLAYBOOKS;
}

export function getPlaybook(roleId: string): RolePlaybook | undefined {
  return PLAYBOOK_BY_ROLE.get(roleId) ?? PLAYBOOK_BY_ID.get(roleId);
}

/**
 * 注入 planAgentCore 的職能＋playbook 區塊（保持精簡，避免吃光 knowledge 預算）。
 */
export function buildPlannerRoleBlock(): string {
  const rosterLines = listAiProjectRoles().map((r: AiProjectRole) => {
    const pb = PLAYBOOK_BY_ROLE.get(r.id);
    const kinds = pb?.suggestedKinds.join("→") ?? r.kindHints.join(",");
    return `- ${r.id}「${r.title}」步驟骨架：${kinds}`;
  });

  const hints = ROLE_PLAYBOOKS.map(
    (p) => `### ${p.title} (${p.id})\n${p.plannerHint}`,
  ).join("\n");

  return [
    "【AI 職能與 Playbook】（心智標籤，非假成員、非第二 runtime）",
    "依使用者目標對應 1～2 個職能來拆步即可；steps 只能用既有 kind；媒體生成只走 generate／voiceover（站內 Command）。",
    "職能速查：",
    ...rosterLines,
    "Playbook 提示（模板，非自動執行）：",
    hints,
  ].join("\n");
}

/** 便利：職能標題＋playbook goal 給 UI 示例 */
export function playbookGoalHint(roleId: string): string | undefined {
  const pb = getPlaybook(roleId);
  if (pb) return pb.goalTemplate;
  return getAiProjectRole(roleId)?.defaultGoalHint;
}
