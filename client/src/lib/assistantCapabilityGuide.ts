import { ASSISTANT_CAPABILITIES, type AssistantCapability } from "@shared/assistantExecution";
import type { AssistantEntityType, AssistantPageContext, AssistantPageType } from "./assistantContext";

/**
 * 「AI 助手能做什麼」——會跟著你所在位置與使用習慣重排的能力目錄。
 *
 * ## 為什麼要有這一份
 *
 * 助手畫面上只有一個輸入框、三顆隨頁面變動的快捷鍵，與一句 placeholder。使用者實機回報
 * 「根本不知道怎麼操作、也不知道它能做到什麼」——這不是文案不夠漂亮，是**能力清單從來沒有
 * 出現在畫面上**：站級動作有八種、派工與生成另外兩種，但要先猜對一句話才會撞見其中一種。
 *
 * ## 為什麼是從 ASSISTANT_CAPABILITIES 生出來，而不是另外手寫一張表
 *
 * `ASSISTANT_CAPABILITIES` 是伺服器**判斷能不能直寫**時讀的同一份清單
 * （`canDirectlyExecuteCapability`）。如果這裡另抄一份，畫面上的承諾與後端的行為會各走各的：
 * 最糟的形態是畫面寫著「我可以幫你排行程」而後端根本沒接。因此本檔只做三件事——
 * **分組、排序、補例句**，能力本身一個都不自己發明。`assistantCapabilityGuide.test.ts`
 * 守住「每個能力都恰好被分到一組、且都有例句」，之後有人在 shared 加能力卻忘了這裡，測試會紅。
 *
 * ## 為什麼不是一張固定清單
 *
 * 固定順序的二十幾行對誰都不合身：在分鏡頁盯著第 3 鏡的人，要滑過「讀取組員與工作負荷」
 * 才看得到跟畫面有關的那幾行；而每天都在派工的人，每次都要重新找到同一行。
 * 所以預設只給**這一頁最可能想要的幾行**（依所在頁面、正在看的東西、以及你自己用過的紀錄排序），
 * 完整清單收在「看全部能力」後面一鍵可達——縮短的是路徑，不是能力。
 *
 * 例句也跟著上下文長出來：正在看第 3 鏡時，例句直接是「第 3 鏡…」，
 * 按下去就是一句對得上眼前東西的話，而不是一句要人自己代換名詞的樣板。
 */

/** 第一層使用產品語言分組；風險是每個項目的次要資訊。 */
export type CapabilityGroupId = "data" | "video" | "project" | "work" | "collaboration" | "generation";
export type CapabilityImpact = "read" | "auto" | "confirm" | "cost";

export interface CapabilityGuideItem {
  /** 對應 ASSISTANT_CAPABILITIES 的 id（測試與使用紀錄用，不顯示） */
  id: string;
  /** 能力名稱（沿用 shared 的 label，不另取名——畫面與稽核講的是同一件事） */
  label: string;
  /** 按下去實際送出的那句話（已套用當下上下文） */
  example: string;
  /** 所屬後果組：即使被抽出來單獨顯示，「按了會發生什麼」也要跟著走 */
  group: CapabilityGroupId;
  /** 次要風險提示，不拿來當第一層導覽分類。 */
  impact: CapabilityImpact;
}

export interface CapabilityGuideGroup {
  id: CapabilityGroupId;
  /** 組標題：直接寫後果 */
  title: string;
  /** 一句話講清楚按下去會發生什麼——這句才是使用者敢不敢按的關鍵 */
  note: string;
  items: CapabilityGuideItem[];
}

export interface CapabilityGuide {
  /** 這一頁最可能想要的幾行（預設只顯示這些） */
  suggested: CapabilityGuideItem[];
  /** 完整清單，依後果分組（「看全部能力」展開） */
  groups: CapabilityGuideGroup[];
}

/**
 * 每個能力的例句。
 *
 * `base` 是沒有上下文時的通用問法；`focused` 在使用者正盯著某個東西時取代它，
 * `{it}` 會換成那個東西的名字（第 3 鏡、某支任務、某個素材）。
 * 每一個能力都要寫 base：只給熱門幾個的話，沒被寫到的能力在畫面上會變成一行不能按的字，
 * 使用者不會知道那到底算不算「做得到」。
 */
const EXAMPLE: Record<string, { base: string; focused?: string }> = {
  read_context: { base: "我現在看的這個專案做到哪了？還差什麼才能完成？", focused: "{it}目前的狀況如何？還差什麼？" },
  read_tasks: { base: "目前有哪些任務逾期或快到期？", focused: "{it}現在卡在哪？誰在負責？" },
  read_notes: { base: "把最近的筆記整理成重點與待辦。" },
  read_storyboard: { base: "目前分鏡做到哪？哪幾鏡還沒有畫面或旁白？", focused: "{it}還缺什麼？節奏合理嗎？" },
  read_script: { base: "目前的腳本節奏如何？開場、轉折與收尾各有什麼問題？" },
  read_assets: { base: "對照目前分鏡，還缺哪些素材沒有備齊？", focused: "{it}適合用在哪幾鏡？" },
  import_local_file: { base: "把這份檔案加入目前專案。" },
  import_url: { base: "把這個連結加入目前專案：https://example.com/file.pdf" },
  import_google_drive: { base: "從 Google Drive 選資料加入目前專案。" },
  import_folder: { base: "把整個資料夾加入目前專案。" },
  import_external_result: { base: "把剛才在外部 AI 做好的成果帶回目前專案。" },
  attach_asset_to_project: { base: "把剛匯入的這些資料加入目前專案脈絡。" },
  attach_asset_to_scene: { base: "把選取素材加入目前場景。", focused: "把選取素材加入{it}。" },
  attach_asset_to_shot: { base: "把選取素材放進目前分鏡。", focused: "把選取素材放進{it}。" },
  classify_asset: { base: "整理剛匯入的這些素材。" },
  add_project_context: { base: "讓目前專案接下來都能使用剛匯入的資料。" },
  read_database: { base: "資料庫裡有哪些資料可以直接用在這個專案？" },
  read_schedule: { base: "這週有哪些交付死線？還來得及嗎？" },
  read_members: { base: "現在組內誰的工作最滿？誰還有餘裕？" },
  read_collaboration: { base: "目前所有專案裡，有哪些卡住了或需要我處理？" },
  inspect_computer_runtime: { base: "你現在可以用真實瀏覽器嗎？" },
  open_browser_runtime: { base: "幫我在目前專案開啟瀏覽器。" },
  read_generations: { base: "這個專案生成過哪些圖片和影片？用了哪些模型？" },
  animation_review_summary: { base: "這一幕還有什麼問題？", focused: "{it}這一幕還有什麼問題？" },
  animation_list_findings: { base: "哪些鏡頭人物不一致？", focused: "{it}為什麼需要修？" },
  animation_plan_repair: { base: "人物跟連戲先修，畫風不要。" },
  animation_execute_repair: { base: "照這個計畫執行。" },
  animation_compare_candidate: { base: "開始檢查修復候選。" },
  animation_adopt_candidate: { base: "採用這版。", focused: "採用{it}的修復候選。" },
  animation_keep_current: { base: "保留現用版本。", focused: "{it}原本比較好，先留現用。" },

  create_task: { base: "幫我在這個專案建一件待辦：明天以前把旁白稿定稿。", focused: "針對{it}幫我建一件待辦，明天以前完成。" },
  add_note: { base: "幫我記一則筆記：這支片的主色調改成暖橘。", focused: "把{it}目前的討論結論記成一則筆記。" },
  save_decision: { base: "把「片長改成 30 秒」記成這個專案的決策。" },
  split_script: { base: "把目前的腳本拆成分鏡。" },

  create_project: { base: "幫我開一個中秋活動宣傳專案。" },
  create_watch: { base: "幫我盯著這個專案，有人卡住就提醒我。" },
  add_database_row: { base: "把這次的拍攝清單寫進資料庫。" },
  // Live leftover: this tap-to-send example still taught 七幕 米白針織外套, not A–F 白帽T.
  add_character: { base: "幫我加一張角色卡：小華，粉橘短髮女孩、白帽T。" },
  add_schedule_item: { base: "下週三下午三點排一小時的分鏡審查。" },
  send_dm: { base: "幫我私訊小明，請他今天內回覆旁白稿。" },

  dispatch_agent: { base: "把這支片的分鏡整理交給專案 AI 去做。", focused: "把{it}的後續交給專案 AI 去做。" },
  orchestrate_group_campaign: { base: "幫我規劃完整中秋宣傳活動：開專案、分工、做影片。" },
  generate_media: { base: "幫我生成第 3 鏡的畫面。", focused: "幫我生成{it}的畫面。" },
  prepare_external_generation: { base: "把第 3 鏡拿去 Flow 生，成果再帶回這個對話。", focused: "把{it}拿去外部 AI 生成。" },
  prepare_editing_handoff: { base: "把目前專案準備成 LumaFusion 剪輯交接。", focused: "把{it}準備成 LumaFusion 剪輯交接。" },
  open_editing_session: { base: "打開剛建立的剪輯工作階段。" },
  return_editing_result: { base: "把 LumaFusion 剪好的成果回傳到原工作階段。" },
  review_editing_result: { base: "審核剛回傳的剪輯成果。", focused: "審核{it}的外部剪輯成果。" },
};

/**
 * 能力與「在哪一頁／正在看什麼」的親和度。
 *
 * 只列出**明顯相關**的那幾個；沒列到不代表用不了（能力永遠是全站可用的），
 * 只代表它不該在這一頁排前面。刻意不做成完整矩陣：那會變成一份要跟著每個新頁面維護的表，
 * 而漏維護的下場只是排序稍差，不值得那個成本。
 */
const AFFINITY: Record<string, { pages?: AssistantPageType[]; entities?: AssistantEntityType[] }> = {
  read_context: { pages: ["project", "home", "studio"] },
  read_tasks: { pages: ["tasks", "home"], entities: ["task"] },
  create_task: { pages: ["tasks", "home", "project"], entities: ["task"] },
  read_notes: { pages: ["notes"] },
  add_note: { pages: ["notes", "project"] },
  save_decision: { pages: ["notes", "project"] },
  read_storyboard: { pages: ["storyboard", "studio", "production"], entities: ["shot", "scene"] },
  split_script: { pages: ["story", "storyboard"], entities: ["script", "scene"] },
  read_script: { pages: ["story"], entities: ["script"] },
  read_assets: { pages: ["assets", "storyboard", "production"], entities: ["asset"] },
  import_local_file: { pages: ["assets", "project", "home"] },
  import_url: { pages: ["assets", "project", "home"] },
  import_google_drive: { pages: ["assets", "project", "home"] },
  import_folder: { pages: ["assets", "project"] },
  import_external_result: { pages: ["assets", "storyboard", "production"], entities: ["shot", "asset"] },
  attach_asset_to_project: { pages: ["assets", "project"], entities: ["asset"] },
  attach_asset_to_scene: { pages: ["story", "storyboard"], entities: ["scene", "asset"] },
  attach_asset_to_shot: { pages: ["storyboard", "production"], entities: ["shot", "asset"] },
  classify_asset: { pages: ["assets"], entities: ["asset"] },
  add_project_context: { pages: ["assets", "project"], entities: ["asset"] },
  read_database: { pages: ["database"] },
  add_database_row: { pages: ["database"] },
  add_character: { pages: ["story", "storyboard", "studio"] },
  read_schedule: { pages: ["schedule", "home"] },
  add_schedule_item: { pages: ["schedule", "home"] },
  read_members: { pages: ["collab", "home"] },
  read_collaboration: { pages: ["home", "collab", "agent_run"] },
  send_dm: { pages: ["chat", "collab"] },
  create_project: { pages: ["home"] },
  create_watch: { pages: ["project", "agent_run"] },
  dispatch_agent: { pages: ["project", "agent_run", "home"] },
  orchestrate_group_campaign: { pages: ["home", "collab", "agent_run"] },
  generate_media: { pages: ["storyboard", "production", "studio"], entities: ["shot", "asset"] },
  prepare_external_generation: { pages: ["storyboard", "production", "studio"], entities: ["shot"] },
  prepare_editing_handoff: { pages: ["storyboard", "production", "final", "studio"], entities: ["shot", "scene"] },
  open_editing_session: { pages: ["production", "final", "project"] },
  return_editing_result: { pages: ["production", "final", "assets"], entities: ["shot"] },
  review_editing_result: { pages: ["production", "final", "studio"], entities: ["shot", "asset"] },
  read_generations: { pages: ["production", "final", "studio"] },
  // 只在製作／工作室頁推修復閉環，避免分鏡頁盯某一鏡時把 read_storyboard 擠出前五
  animation_review_summary: { pages: ["production", "studio", "project"] },
  animation_list_findings: { pages: ["production", "studio"] },
  animation_plan_repair: { pages: ["production", "studio"] },
  animation_execute_repair: { pages: ["production", "studio"] },
  animation_compare_candidate: { pages: ["production", "studio"] },
  animation_adopt_candidate: { pages: ["production", "studio"] },
  animation_keep_current: { pages: ["production", "studio"] },
};

function impactOf(capability: AssistantCapability): CapabilityImpact {
  if (capability.risk === "READ") return "read";
  if (capability.risk === "COSTFUL") return "cost";
  // EXTERNAL（私訊、可能同步到 Google Calendar 的排程）與未開放直寫的 SAFE_WRITE
  // 一律歸「先給你確認」：對使用者而言後果相同——沒按之前什麼都不會發生。
  if (capability.risk === "SAFE_WRITE" && capability.direct) return "auto";
  return "confirm";
}

/** 使用者找的是工作，不是權限等級；風險仍由 impactOf 獨立保留。 */
function groupOf(capability: AssistantCapability): CapabilityGroupId {
  if (["INTAKE", "ASSET", "DATABASE"].includes(capability.domain)) return "data";
  if (["STORYBOARD", "SCRIPT"].includes(capability.domain)) return "video";
  if (["PROJECT", "NOTE", "MEMORY"].includes(capability.domain)) return "project";
  if (["TASK", "SCHEDULE"].includes(capability.domain)) return "work";
  if (["MEMBER", "COLLABORATION"].includes(capability.domain)) return "collaboration";
  return "generation";
}

const GROUP_META: Record<CapabilityGroupId, { title: string; note: string }> = {
  data: {
    title: "加入資料",
    note: "從檔案、資料夾、網址或 Google Drive 把資料安全帶進 Aios。",
  },
  video: {
    title: "創作影片",
    note: "閱讀腳本與分鏡、拆分內容，並把素材放到正確的場景或鏡頭。",
  },
  project: {
    title: "整理專案",
    note: "建立專案、保存筆記與決策，或整理目前工作還缺什麼。",
  },
  work: {
    title: "任務與排程",
    note: "建立任務、查看期限，並安排需要確認的行程。",
  },
  collaboration: {
    title: "團隊協作",
    note: "查看團隊狀況；只有真的跨人員與長時間工作才會升級成協作計畫。",
  },
  generation: {
    title: "生成與外部工具",
    note: "生成媒體或準備外部工具交接；涉及成本或對外操作時會先請你確認。",
  },
};

/** 眼前這個東西的名字（沒有就退回沒有——寧可用通用例句，也不要「這個 undefined」） */
function focusLabel(ctx?: AssistantPageContext): string | null {
  const label = ctx?.entityLabel?.trim();
  return label && ctx?.entityId ? label : null;
}

/** 例句：正在盯著某個東西且該能力有專屬問法時，就直接對著它問 */
export function capabilityExample(id: string, ctx?: AssistantPageContext): string {
  const entry = EXAMPLE[id];
  if (!entry) return "";
  const it = focusLabel(ctx);
  return it && entry.focused ? entry.focused.replaceAll("{it}", it) : entry.base;
}

/**
 * 相關度分數（越高越前面）。
 *
 * 權重的順序就是「哪一種訊號比較能代表使用者現在想幹嘛」：
 * 自己用過 > 正在看的東西 > 所在頁面。用過的給最高分是刻意的——
 * 它是唯一由使用者本人產生的訊號，猜錯的機率最低。
 */
function score(id: string, ctx: AssistantPageContext | undefined, recent: string[]): number {
  let s = 0;
  const usedAt = recent.indexOf(id);
  if (usedAt >= 0) s += 100 - usedAt; // 越近期用過越前面
  const aff = AFFINITY[id];
  if (ctx && aff) {
    if (ctx.entityType && aff.entities?.includes(ctx.entityType)) s += 40;
    if (aff.pages?.includes(ctx.pageType)) s += 20;
  }
  return s;
}

/** 預設露出幾行：夠看出「它真的能做事」，又不至於變回一面字牆 */
export const SUGGESTED_LIMIT = 5;

export function assistantCapabilityGuide(options?: {
  /** 目前頁面／正在看的東西；沒有就用通用排序與通用例句 */
  ctx?: AssistantPageContext;
  /** 使用者用過的能力（最近的在前）；見 assistantCapabilityUsage */
  recent?: string[];
  limit?: number;
}): CapabilityGuide {
  const { ctx, recent = [], limit = SUGGESTED_LIMIT } = options ?? {};

  const all: CapabilityGuideItem[] = ASSISTANT_CAPABILITIES.map((c) => ({
    id: c.id,
    label: c.label,
    example: capabilityExample(c.id, ctx),
    group: groupOf(c),
    impact: impactOf(c),
  }));

  const ranked = all
    .map((item, index) => ({ item, index, s: score(item.id, ctx, recent) }))
    // 同分時維持型錄原本的順序（穩定排序，不會每次開都跳來跳去）
    .sort((a, b) => b.s - a.s || a.index - b.index);

  // 完全沒有訊號（沒上下文、沒用過）時仍然給前幾個：空的建議區等於又回到「不知道能幹嘛」
  const suggested = ranked.slice(0, Math.max(0, limit)).map((r) => r.item);

  const order: CapabilityGroupId[] = ["data", "video", "project", "work", "collaboration", "generation"];
  const groups = order.map((id) => ({
    id,
    ...GROUP_META[id],
    items: all.filter((item) => item.group === id),
  }));

  return { suggested, groups };
}
