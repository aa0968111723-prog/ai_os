/**
 * 助手一次提議多個動作時的「總影響」（PE 計畫 §33 變更預覽的批次粒度）。
 *
 * 為什麼需要：每個動作各自有確認卡，安全性已經夠；但使用者面對 5 顆按鈕時
 * 看不到「這批做完專案會變成什麼樣」，也看不到「哪幾顆會花錢」——
 * 於是要嘛逐顆點下去、要嘛整批不敢動。這一行把總帳先講清楚。
 *
 * 純函式，不碰 React：批次摘要的措辭是產品承諾（尤其「會花點數」那句），必須可窮舉測。
 */

/** 只取摘要需要的形狀——避免與 ProjectAssistant 的完整 Action 型別互相綁死 */
export interface BatchAction {
  type: string;
  /** direct_shot 已經算好的差異行 */
  changes?: string[];
}

/** 會實際扣點的動作（其餘站內免費）。plan_agent 依 token 計價，也算花錢。 */
const COSTS_POINTS = new Set(["generate", "run_workflow", "plan_agent"]);

export interface BatchSummary {
  total: number;
  /** 會新增分鏡的動作數 */
  addsShots: number;
  /** 會修改既有分鏡的動作數（改欄位或調鏡頭語言） */
  editsShots: number;
  /** 會花點數的動作數 */
  costly: number;
  /** 會改動專案層設定（世界觀基調）的動作數 */
  projectLevel: number;
  /** 會新增角色卡的動作數 */
  addsCharacters: number;
}

export function summarizeActionBatch(actions: BatchAction[]): BatchSummary {
  let addsShots = 0;
  let editsShots = 0;
  let costly = 0;
  let projectLevel = 0;
  let addsCharacters = 0;
  for (const a of actions) {
    if (a.type === "create_scene" || a.type === "split_script") addsShots += 1;
    if (a.type === "update_scene" || a.type === "direct_shot") editsShots += 1;
    if (a.type === "apply_worldview_chips") projectLevel += 1;
    if (a.type === "add_character") addsCharacters += 1;
    if (COSTS_POINTS.has(a.type)) costly += 1;
  }
  return { total: actions.length, addsShots, editsShots, costly, projectLevel, addsCharacters };
}

/**
 * 一句話總帳。回 null＝不值得占版面（少於兩個動作時，逐顆的確認卡本來就講得夠清楚）。
 *
 * 措辭原則：先講會動到什麼，再講要不要花錢；不承諾「一鍵套用」——
 * 每一顆仍然要各自確認，這一行只是讓人先看懂全貌（不假裝有批次執行）。
 */
export function batchSummaryText(actions: BatchAction[]): string | null {
  if (actions.length < 2) return null;
  const s = summarizeActionBatch(actions);
  const parts: string[] = [];
  if (s.addsShots) parts.push(`新增分鏡 ${s.addsShots}`);
  if (s.editsShots) parts.push(`修改分鏡 ${s.editsShots}`);
  if (s.projectLevel) parts.push(`調整專案基調 ${s.projectLevel}`);
  if (s.addsCharacters) parts.push(`新增角色卡 ${s.addsCharacters}`);
  const head = `這批 ${s.total} 個建議${parts.length ? `：${parts.join("・")}` : ""}`;
  const cost = s.costly
    ? `其中 ${s.costly} 個會花點數`
    : "都不花點數";
  return `${head}；${cost}。每個都要你各自確認才會執行。`;
}
