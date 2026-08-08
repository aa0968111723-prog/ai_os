import type { AssistantWirePageContext } from "@shared/assistantPageContext";
import type { AssistantPageContext } from "./assistantContext";

/**
 * 前端 context → 線上格式（白名單）。
 *
 * 刻意**不送** route 與 projectTitle：route 可能夾帶查詢字串，projectTitle 伺服器
 * 自己查得到（而且它查到的才是真的）。id 欄非 uuid 一律丟棄——這些值會進提示詞。
 */
export function toWirePageContext(ctx: AssistantPageContext): AssistantWirePageContext {
  const uuid = (v: string | undefined) =>
    v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined;
  const ids = (ctx.selectedEntityIds ?? []).map(uuid).filter((v): v is string => !!v).slice(0, 20);
  return {
    pageType: ctx.pageType,
    entityType: ctx.entityType,
    entityId: uuid(ctx.entityId),
    entityLabel: ctx.entityLabel,
    selectedEntityIds: ids.length ? ids : undefined,
    activeTab: ctx.activeTab,
    recentAction: ctx.recentAction,
  };
}

/**
 * 依頁面上下文決定的快捷動作（取代原本四顆寫死的 QUICK_PROMPTS）。
 *
 * 為什麼要換掉寫死的：那四顆（爆款短片主題／分鏡腳本規劃／全組專案進度／開場鉤子技巧）
 * 在任何頁面都一樣——人在分鏡頁盯著第 3 鏡時，「爆款短片主題」是最不相關的一件事。
 * 快捷鍵的價值是「省下打字」，前提是它剛好就是你現在想做的；不是的話它只是佔位。
 *
 * 規則：**最多 3 顆**（再多就變選項牆，回到「不知道要拿它幹嘛」的老問題），
 * 選取狀態優先於作用中實體，作用中實體優先於頁面，頁面優先於全站。
 */

export interface AssistantQuickAction {
  /** 穩定 id（測試與遙測用；不顯示） */
  id: string;
  /** 按鈕上的字（≤6 字，手機一行三顆放得下） */
  label: string;
  /** 按下去實際送出的問題——寫成人話，因為它會出現在對話裡當作使用者說的那句 */
  prompt: string;
}

const MAX = 3;

/** 中文數量詞：selection 多筆時的「這幾鏡／這幾張」 */
function many(n: number, unit: string): string {
  return `這 ${n} ${unit}`;
}

export function getAssistantQuickActions(ctx: AssistantPageContext): AssistantQuickAction[] {
  const sel = ctx.selectedEntityIds ?? [];
  const multi = sel.length > 1;

  // ── 多選優先：使用者已經明確圈出對象，快捷就該是「對這幾個做什麼」 ──
  if (multi) {
    if (ctx.entityType === "shot" || ctx.pageType === "storyboard") {
      return [
        { id: "shots.batch-improve", label: "批次改善", prompt: `${many(sel.length, "鏡")}節奏偏平，請逐鏡給具體的改善建議（景別、動作、鏡頭運動）。` },
        { id: "shots.unify-style", label: "統一風格", prompt: `請檢查${many(sel.length, "鏡")}的畫面風格是否一致，並指出要調整哪幾鏡。` },
        { id: "shots.batch-prompt", label: "批次提示詞", prompt: `請為${many(sel.length, "鏡")}各寫一段可直接生成的畫面提示詞。` },
      ];
    }
    if (ctx.entityType === "asset" || ctx.pageType === "assets") {
      return [
        { id: "assets.pick-best", label: "挑最合適", prompt: `${many(sel.length, "張")}素材裡，哪一張最適合目前的分鏡？請說明理由。` },
        { id: "assets.organize", label: "整理這些", prompt: `請幫我整理${many(sel.length, "張")}素材：命名、分類與可以用在哪幾鏡。` },
        { id: "assets.gaps", label: "找缺漏", prompt: "對照目前分鏡，還缺哪些素材沒有備齊？" },
      ];
    }
    if (ctx.entityType === "task" || ctx.pageType === "tasks") {
      return [
        { id: "tasks.batch-schedule", label: "批次排期", prompt: `請幫我把${many(sel.length, "件")}任務排出合理的先後順序與期限。` },
        { id: "tasks.overdue", label: "找逾期", prompt: "目前有哪些任務已經逾期或快到期？" },
        { id: "tasks.today", label: "安排今天", prompt: "依照目前的任務與期限，幫我安排今天最該做的三件事。" },
      ];
    }
  }

  // ── 單一作用中實體 ──
  if (ctx.entityType === "shot" && ctx.entityId) {
    const which = ctx.entityLabel ?? "這一鏡";
    return [
      { id: "shot.improve", label: "改善這鏡", prompt: `${which}節奏偏平，請給我具體的改法（景別、動作、鏡頭運動）。` },
      { id: "shot.next", label: "建立下一鏡", prompt: `接在${which}之後，建議下一鏡怎麼拍，並幫我建立分鏡草稿。` },
      { id: "shot.assets", label: "找缺素材", prompt: `${which}目前缺哪些素材？還需要準備什麼才能開拍？` },
    ];
  }
  if (ctx.entityType === "scene" && ctx.entityId) {
    const which = ctx.entityLabel ?? "這一場";
    return [
      { id: "scene.pace", label: "檢查節奏", prompt: `${which}的節奏與資訊量合理嗎？哪裡該加、哪裡該刪？` },
      { id: "scene.split", label: "拆成分鏡", prompt: `請把${which}拆成具體的分鏡，一鏡一句畫面描述。` },
      { id: "scene.gaps", label: "找缺漏", prompt: `${which}還缺哪些素材或資訊？` },
    ];
  }
  if (ctx.entityType === "task" && ctx.entityId) {
    return [
      { id: "task.reschedule", label: "改期限", prompt: "這件任務幫我改到明天，並說明會不會影響其他排程。" },
      { id: "task.breakdown", label: "拆步驟", prompt: "這件任務要怎麼拆成可執行的小步驟？" },
      { id: "task.today", label: "安排今天", prompt: "依照目前的任務與期限，幫我安排今天最該做的三件事。" },
    ];
  }
  if (ctx.entityType === "script" || ctx.pageType === "story") {
    return [
      { id: "script.improve", label: "改善這段", prompt: "目前這段故事哪裡不夠有力？請給具體的修改建議。" },
      { id: "script.to-board", label: "拆成分鏡", prompt: "請把目前的故事拆成分鏡草稿。" },
      { id: "script.pace", label: "檢查節奏", prompt: "整體故事節奏如何？開場、轉折與收尾各有什麼問題？" },
    ];
  }

  // ── 頁面層級 ──
  switch (ctx.pageType) {
    case "storyboard":
      return [
        { id: "board.progress", label: "看進度", prompt: "目前分鏡做到哪？哪幾鏡還沒有畫面或旁白？" },
        { id: "board.next", label: "建立下一鏡", prompt: "依照目前的分鏡，建議下一鏡怎麼拍，並幫我建立草稿。" },
        { id: "board.gaps", label: "找缺素材", prompt: "哪幾鏡缺素材？請列出還要準備什麼。" },
      ];
    case "assets":
      return [
        { id: "assets.gaps", label: "找缺素材", prompt: "對照目前分鏡，還缺哪些素材沒有備齊？" },
        { id: "assets.organize", label: "整理素材", prompt: "請幫我看素材庫目前的狀況，哪些可以直接用、哪些該補。" },
        { id: "assets.recommend", label: "推薦用哪張", prompt: "目前的分鏡各適合用素材庫裡的哪一張？" },
      ];
    case "tasks":
      return [
        { id: "tasks.today", label: "安排今天", prompt: "依照目前的任務與期限，幫我安排今天最該做的三件事。" },
        { id: "tasks.overdue", label: "找逾期", prompt: "目前有哪些任務已經逾期或快到期？" },
        { id: "tasks.blocked", label: "誰卡住了", prompt: "現在有哪些人或哪些事情卡住了？" },
      ];
    case "notes":
      return [
        { id: "notes.summary", label: "整理重點", prompt: "請把最近的筆記整理成重點與待辦。" },
        { id: "notes.to-task", label: "轉成任務", prompt: "筆記裡有哪些該變成任務？請幫我建立。" },
        { id: "notes.decisions", label: "摘要決策", prompt: "最近做了哪些決定？請條列並註明出處。" },
      ];
    case "schedule":
      return [
        { id: "schedule.conflict", label: "找衝突", prompt: "目前的行程有沒有衝突或太擠的地方？" },
        { id: "schedule.next", label: "安排下一步", prompt: "依照目前進度，接下來該排什麼？請幫我加到行程。" },
        { id: "schedule.deadline", label: "看死線", prompt: "這週有哪些交付死線？還來得及嗎？" },
      ];
    case "database":
      return [
        { id: "db.find", label: "找資料", prompt: "請幫我在資料庫裡找出相關的資料。" },
        { id: "db.organize", label: "整理資料", prompt: "目前資料庫的內容有哪些缺漏或重複？" },
        { id: "db.to-project", label: "用在專案", prompt: "資料庫裡有哪些資料可以直接用在目前的專案？" },
      ];
    case "agent_run":
      return [
        { id: "run.status", label: "跑到哪了", prompt: "目前的 AI 計畫進行到哪一步？有沒有卡住？" },
        { id: "run.blocked", label: "為什麼卡住", prompt: "計畫停在哪裡、在等什麼？我該做什麼才能繼續？" },
        { id: "run.next", label: "下一步", prompt: "這份計畫完成後，接下來最該做什麼？" },
      ];
    case "project":
    case "production":
    case "final":
    case "studio":
      return [
        { id: "project.progress", label: "看進度", prompt: "這個專案目前做到哪？還差什麼才能完成？" },
        { id: "project.continue", label: "繼續製作", prompt: "依照目前進度，接下來最該做的是什麼？請直接幫我開始。" },
        { id: "project.gaps", label: "找缺漏", prompt: "這個專案目前有哪些缺漏或風險？" },
      ];
    default:
      return [
        { id: "home.today", label: "安排今天", prompt: "依照目前的任務、行程與專案進度，幫我安排今天。" },
        { id: "home.continue", label: "繼續上次", prompt: "我最近在做的專案進行到哪？接下來該做什麼？" },
        { id: "home.blocked", label: "哪裡卡住", prompt: "目前所有專案裡，有哪些卡住了或需要我處理？" },
      ];
  }
}

/** 給提示詞用的 compact context 區塊（Context = pointer；真正資料交給工具查） */
export function formatContextForPrompt(ctx: AssistantPageContext): string {
  const lines: string[] = [];
  const pageLabel = PAGE_LABEL[ctx.pageType];
  if (pageLabel) lines.push(`頁面：${pageLabel}`);
  if (ctx.entityLabel) lines.push(`正在看：${ctx.entityLabel}`);
  else if (ctx.entityType) lines.push(`正在看：${ENTITY_LABEL[ctx.entityType] ?? ctx.entityType}`);
  const sel = ctx.selectedEntityIds ?? [];
  if (sel.length) {
    lines.push(`已選取：${sel.length} 個${ctx.entityType ? ENTITY_LABEL[ctx.entityType] ?? "項目" : "項目"}`);
  }
  if (ctx.recentAction) lines.push(`剛剛做了：${ctx.recentAction}`);
  if (!lines.length) return "";
  return lines.join("\n");
}

/** 頁面／實體的中文標籤（麵包屑與提示詞共用一份，畫面與模型看到的是同一個名字） */
export const PAGE_LABEL: Partial<Record<AssistantPageContext["pageType"], string>> = {
  home: "今日工作台",
  project: "專案",
  story: "故事",
  storyboard: "分鏡",
  production: "製作",
  final: "成片",
  settings: "專案設定",
  studio: "動畫創作室",
  assets: "素材庫",
  tasks: "任務",
  notes: "筆記",
  schedule: "行程",
  database: "資料庫",
  agent_run: "AI 計畫",
  collab: "協作中心",
  chat: "私訊",
  community: "社群",
};

export const ENTITY_LABEL: Partial<Record<NonNullable<AssistantPageContext["entityType"]>, string>> = {
  scene: "場",
  shot: "分鏡",
  asset: "素材",
  task: "任務",
  note: "筆記",
  schedule_item: "行程",
  generation: "生成",
  agent_run: "AI 計畫",
  database: "資料庫",
  script: "故事",
};

/** 麵包屑：專案 · 頁面 · 實體（不顯示任何 id） */
export function formatContextBreadcrumb(ctx: AssistantPageContext): string {
  const parts: string[] = [];
  if (ctx.projectTitle) parts.push(ctx.projectTitle);
  const page = PAGE_LABEL[ctx.pageType];
  if (page) parts.push(page);
  const sel = ctx.selectedEntityIds ?? [];
  if (sel.length > 1) {
    parts.push(`已選 ${sel.length} 個${ctx.entityType ? ENTITY_LABEL[ctx.entityType] ?? "" : ""}`);
  } else if (ctx.entityLabel) {
    parts.push(ctx.entityLabel);
  }
  return parts.join(" · ");
}
