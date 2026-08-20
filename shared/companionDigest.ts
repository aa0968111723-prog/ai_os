/**
 * Companion 首頁投影：問候語、一句主動提示、最多三張智慧卡。
 *
 * ## 為什麼首頁不是專案列表
 *
 * 打開手機的人心裡只有一個問題：**「我昨天那件事現在怎麼樣了」**。
 * 專案總表回答不了它——它只是把問題原封不動丟回去，要人自己找。
 * 所以首頁只放：一句話的現況、一顆球、一個輸入框，加上最多三張
 * 「現在真的需要你動手」的卡。第四張開始就是在堆功能了。
 *
 * ## 卡片的挑選是有優先序的，不是「有什麼放什麼」
 *
 * 1. `approval` — 有東西等你拍板。**人被擋住**，最貴。
 * 2. `failure`  — 有東西壞了。可以一句話重跑。
 * 3. `running`  — 有東西在跑。看一眼就好，不必動手。
 * 4. `resume`   — 昨天做到一半。這是「主動提示」的來源。
 * 5. `done`     — 剛完成的成果等你看。
 *
 * 同一類只出一張（聚合成「3 個鏡頭失敗」而不是三張卡）。
 *
 * ## 純函式
 *
 * 沒有 Date.now()、沒有 I/O：時間由呼叫端傳 `nowHour` 進來。
 * 問候語會因為機器時區而錯，是最容易上線才發現的那種 bug。
 */

export type CompanionCardKind = "approval" | "failure" | "running" | "resume" | "done";

export interface CompanionProjectSnapshot {
  id: string;
  title: string;
  /** shared/phoneStages 的階段字彙 */
  stage: string;
  shots: number;
  shotsWithVisual: number;
  awaitingGenerations: number;
  runningGenerations: number;
  failedGenerations: number;
  /** 最近一次完成、使用者還沒看過的產出數 */
  freshResults: number;
  updatedAt: string;
}

export interface CompanionDigestInput {
  /** 0–23，使用者本地時 */
  nowHour: number;
  userName?: string;
  projects: readonly CompanionProjectSnapshot[];
}

export interface CompanionCardAction {
  /** compose＝把這句話送給 Aios（走既有助手，不繞過確認流程） */
  kind: "compose" | "open_web" | "open_tab";
  label: string;
  /**
   * 語意完全確定的動作掛上 COMPANION_NATIVE_ACTIONS 的 id（如 retry_generation），
   * 讓 UI 走確定性路徑（確認卡→既有端點）而不是把話丟給助手。
   * 用 id 而不是比對 label——label 是 UI 文案，改一個字不該改變執行路徑。
   */
  actionId?: string;
  /** kind=compose 時要送的話 */
  prompt?: string;
  /** kind=open_web 時的深連結目標 */
  target?: string;
  projectId?: string;
  /** kind=open_tab 時的 Companion 分頁 */
  tab?: "ai" | "tasks" | "me";
}

export interface CompanionCard {
  id: string;
  kind: CompanionCardKind;
  /** 專案名或事件標題 */
  title: string;
  /** 一行狀態，不超過一句話 */
  line: string;
  projectId?: string;
  /** 0–1；只有 running 有 */
  progress?: number;
  actions: CompanionCardAction[];
}

export interface CompanionDigest {
  greeting: string;
  /** AI 主動說的那一句；沒有值得說的事情時是 undefined（不要硬擠） */
  nudge?: string;
  cards: CompanionCard[];
}

/** 首頁最多幾張卡。改大這個數字之前先想清楚第四張要擠掉誰。 */
export const MAX_COMPANION_CARDS = 3;

export function companionGreeting(nowHour: number, userName?: string): string {
  const name = userName?.trim();
  const suffix = name ? `，${name}` : "";
  const hour = Number.isFinite(nowHour) ? ((Math.trunc(nowHour) % 24) + 24) % 24 : 9;
  if (hour < 5) return `夜深了${suffix}`;
  if (hour < 12) return `早安${suffix}`;
  if (hour < 18) return `午安${suffix}`;
  return `晚安${suffix}`;
}

const KIND_RANK: Record<CompanionCardKind, number> = {
  approval: 0,
  failure: 1,
  running: 2,
  resume: 3,
  done: 4,
};

export function companionDigest(input: CompanionDigestInput): CompanionDigest {
  const projects = [...input.projects].sort(
    (a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""),
  );
  const cards: CompanionCard[] = [];

  const awaiting = projects.filter((p) => p.awaitingGenerations > 0);
  if (awaiting.length) cards.push(approvalCard(awaiting));

  const failed = projects.filter((p) => p.failedGenerations > 0);
  if (failed.length) cards.push(failureCard(failed));

  const running = projects.filter((p) => p.runningGenerations > 0);
  if (running.length) cards.push(runningCard(running));

  const fresh = projects.filter((p) => p.freshResults > 0);
  if (fresh.length) cards.push(doneCard(fresh));

  const current = projects[0];
  if (current) cards.push(resumeCard(current));

  const ordered = cards
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])
    .slice(0, MAX_COMPANION_CARDS);

  return {
    greeting: companionGreeting(input.nowHour, input.userName),
    ...(nudgeFor(projects) ? { nudge: nudgeFor(projects) } : {}),
    cards: ordered,
  };
}

function total(list: readonly CompanionProjectSnapshot[], pick: (p: CompanionProjectSnapshot) => number): number {
  return list.reduce((sum, p) => sum + pick(p), 0);
}

/** 單一專案時講專案名，跨專案時講總數——「A07 等待確認」比「1 件事」有用得多。 */
function scopeTitle(list: readonly CompanionProjectSnapshot[]): string {
  return list.length === 1 ? list[0].title : `${list.length} 個專案`;
}

function approvalCard(list: readonly CompanionProjectSnapshot[]): CompanionCard {
  const count = total(list, (p) => p.awaitingGenerations);
  const single = list.length === 1 ? list[0] : undefined;
  return {
    id: "approval",
    kind: "approval",
    title: scopeTitle(list),
    line: `${count} 筆生成等你確認`,
    ...(single ? { projectId: single.id } : {}),
    actions: [
      { kind: "compose", label: "帶我看", prompt: "把等待確認的生成一個一個給我看" },
      ...(single
        ? [{ kind: "open_web" as const, label: "在瀏覽器開", target: "production", projectId: single.id }]
        : []),
    ],
  };
}

function failureCard(list: readonly CompanionProjectSnapshot[]): CompanionCard {
  const count = total(list, (p) => p.failedGenerations);
  const single = list.length === 1 ? list[0] : undefined;
  return {
    id: "failure",
    kind: "failure",
    title: scopeTitle(list),
    line: `${count} 個生成失敗了`,
    ...(single ? { projectId: single.id } : {}),
    actions: [
      // 單一專案時 UI 走確定性重跑（確認卡→逐筆 generation.retry）；
      // prompt 保留＝多專案聚合卡與舊版 UI 的後備路徑（丟給助手）。
      { kind: "compose", label: "全部重跑", prompt: "把失敗的生成全部重新跑一次", actionId: "retry_generation" },
      { kind: "compose", label: "先看原因", prompt: "失敗的那幾筆是為什麼失敗？" },
    ],
  };
}

function runningCard(list: readonly CompanionProjectSnapshot[]): CompanionCard {
  const count = total(list, (p) => p.runningGenerations);
  const single = list.length === 1 ? list[0] : undefined;
  return {
    id: "running",
    kind: "running",
    title: scopeTitle(list),
    line: `${count} 個生成進行中`,
    ...(single ? { projectId: single.id } : {}),
    actions: [{ kind: "compose", label: "看進度", prompt: "現在跑到哪了？" }],
  };
}

function doneCard(list: readonly CompanionProjectSnapshot[]): CompanionCard {
  const count = total(list, (p) => p.freshResults);
  const single = list.length === 1 ? list[0] : undefined;
  return {
    id: "done",
    kind: "done",
    title: scopeTitle(list),
    line: `${count} 個生成任務已完成`,
    ...(single ? { projectId: single.id } : {}),
    actions: [
      { kind: "compose", label: "看結果", prompt: "把剛完成的結果給我看" },
      ...(single
        ? [{ kind: "open_web" as const, label: "在瀏覽器開", target: "project", projectId: single.id }]
        : []),
    ],
  };
}

function resumeCard(project: CompanionProjectSnapshot): CompanionCard {
  return {
    id: `resume:${project.id}`,
    kind: "resume",
    title: project.title,
    line: stageLine(project),
    projectId: project.id,
    actions: [
      { kind: "compose", label: "繼續", prompt: `繼續做「${project.title}」，接下來最該做的先開始` },
      { kind: "open_web", label: "查看", target: "project", projectId: project.id },
    ],
  };
}

function stageLine(p: CompanionProjectSnapshot): string {
  switch (p.stage) {
    case "story":
      return "還沒有故事";
    case "storyboard":
      return p.shots > 0 ? `分鏡 ${p.shots} 鏡` : "接下來拆分鏡";
    case "visual":
      return `${p.shots} 鏡還沒有畫面`;
    case "generate":
      // 百分比讓「做到哪」一眼可讀（任務書 B9 Progress）；分母為 0 不出現這個分支
      return `畫面 ${p.shotsWithVisual}／${p.shots} 鏡（${Math.round((100 * p.shotsWithVisual) / Math.max(1, p.shots))}%）`;
    case "deliver":
      return "可以收尾了";
    default:
      return "";
  }
}

/**
 * 主動提示。
 *
 * 只在**真的有一件具體的事**時開口。沒事就沉默——一個每次打開都要說話的
 * 桌寵，第三天就會被關掉通知。
 */
function nudgeFor(projects: readonly CompanionProjectSnapshot[]): string | undefined {
  const awaiting = total(projects, (p) => p.awaitingGenerations);
  if (awaiting > 0) return `有 ${awaiting} 筆生成在等你決定，要現在看嗎？`;
  const failed = total(projects, (p) => p.failedGenerations);
  if (failed > 0) return `${failed} 個生成失敗了，我可以幫你重跑。`;
  const running = total(projects, (p) => p.runningGenerations);
  if (running > 0) return `${running} 個生成還在跑，要我盯著嗎？`;
  const current = projects[0];
  if (current) return `要繼續昨天的「${current.title}」嗎？`;
  return undefined;
}
