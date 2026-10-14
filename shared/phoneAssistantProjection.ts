import type { AgentEvent } from "./agentEvents";
import type { AssistantActiveGoal } from "./assistantGoalFrame";
import type { AssistantActionResult } from "./assistantActions";
import type { AssistantInteractionRequest } from "./assistantInteractions";
import { interactionIsWaiting } from "./assistantInteractions";
import {
  ASSISTANT_CAPABILITIES,
  type AssistantCapability,
} from "./assistantExecution";
import {
  ASSISTANT_ENTITY_LABEL,
  ASSISTANT_PAGE_LABEL,
  type AssistantWirePageContext,
} from "./assistantPageContext";

/**
 * Phone Action-first 投影（Phone UX，<768px）。
 *
 * ## 這是視圖模型，不是第二份真相
 *
 * 這個模組**只做純函式推導**：輸入是既有的 `AgentEvent[]`、`AssistantActiveGoal`、
 * `AssistantActionResult[]`、`AssistantInteractionRequest`、`AssistantWirePageContext`——
 * 全部都是站內既有的型別與既有的權威狀態。它不查資料庫、不呼叫模型、不發請求、
 * 不落地任何東西，也不定義新的完成度／進度語意。
 *
 * 換句話說：**手機看到的每一行字，都必須能指回一個已經存在的事件或收據**。
 * 這一點是可測的（`phoneAssistantProjection.test.ts` 逐條驗），也是它與
 * 「再做一個 AssistantV2」的分界線。
 *
 * ## 三條紅線
 *
 * 1. **不顯示 chain-of-thought。** `agent.thinking` 被 `PHONE_WORK_EVENT_TYPES`
 *    白名單擋在外面。手機只顯示「做了什麼、讀到幾筆、在等什麼」，不顯示模型自述。
 * 2. **不做假進度。** 沒有百分比，只有具名階段與真實計數（`resultCount`）。
 *    事件沒發生就沒有那一行；不足三行就顯示兩行。
 * 3. **不把提議當成執行。** `PhoneCard.kind` 由權威狀態決定：有待確認動作 →
 *    `proposal`；只有拿到 verified 收據才會變 `result`。部分成功一律顯示
 *    「完成 n / m」，不摺疊成「完成」。
 */

/* ── 可稽核的工作事件白名單 ───────────────────────────────────────── */

/**
 * 手機工作進度只認這些事件。
 *
 * 刻意**不含** `agent.thinking`：那是「目前在整理哪些資料」的自述，
 * 即使伺服器保證它不含隱藏推理，把它畫成一列打勾的步驟仍然會讓使用者
 * 以為那是一件已完成的工作。手機空間太小，模稜兩可的行就是錯的行。
 */
export const PHONE_WORK_EVENT_TYPES = [
  "plan.created",
  "tool.started", "tool.completed", "tool.failed",
  "source.reading", "source.read", "source.failed",
  "action.started", "action.completed", "action.failed",
  "verification.started", "verification.completed",
  "waiting.permission", "waiting.user_input",
  "interaction.requested",
  "agent.completed", "agent.failed",
] as const;

const PHONE_WORK_EVENT_SET = new Set<string>(PHONE_WORK_EVENT_TYPES);

/** 手機一張卡最多顯示幾列工作階段——超過就是在小螢幕上重建一份 log */
export const MAX_PHONE_WORK_STEPS = 4;
/** 一張卡最多幾行狀態文字（標題不算） */
export const MAX_PHONE_CARD_LINES = 3;

export type PhoneWorkStepState = "done" | "active" | "pending" | "blocked" | "failed";

export interface PhoneWorkStep {
  /** 穩定 key（事件的 stepId，沒有就用 eventId）——React key 與測試都用它 */
  key: string;
  /** 給使用者看的一行字，直接取自事件的 title（伺服器已保證是人話、不含 id） */
  label: string;
  state: PhoneWorkStepState;
  /** 真實計數（例：讀到 12 筆）。undefined＝沒量到，就不顯示，不補零。 */
  count?: number;
}

const STATE_BY_EVENT_STATUS: Record<string, PhoneWorkStepState> = {
  running: "active",
  waiting: "blocked",
  ok: "done",
  empty: "done",
  skipped: "done",
  failed: "failed",
};

/**
 * 把事件流摺成「一件事一列」。
 *
 * started/completed 共用 `stepId`，所以後到的同 stepId 事件覆寫前一筆的狀態——
 * 這正是「◉ 進行中 → ✓ 完成」在畫面上該有的行為，而不是兩列。
 *
 * 只保留最後 `MAX_PHONE_WORK_STEPS` 列：手機要的是「現在在哪一步」，
 * 完整軌跡在助手面板裡（既有的 AssistantTrace），這裡不重做一份。
 */
export function derivePhoneWorkSteps(
  events: readonly AgentEvent[] | undefined,
  limit = MAX_PHONE_WORK_STEPS,
): PhoneWorkStep[] {
  if (!events?.length) return [];
  const byKey = new Map<string, PhoneWorkStep>();
  for (const event of events) {
    if (!PHONE_WORK_EVENT_SET.has(event.type)) continue;
    const label = event.title?.trim();
    if (!label) continue;
    const key = event.stepId || event.eventId;
    byKey.set(key, {
      key,
      label,
      state: STATE_BY_EVENT_STATUS[event.status] ?? "pending",
      ...(typeof event.resultCount === "number" ? { count: event.resultCount } : {}),
    });
  }
  const all = [...byKey.values()];
  return all.length > limit ? all.slice(-limit) : all;
}

/**
 * 真實的完成／失敗計數（部分成功的唯一來源）。
 *
 * 只數 `action.*`：那是「真的動了東西」的事件。讀取與驗證不算工作項，
 * 否則「完成 5 / 6」會把三次查詢也算進使用者以為的產出裡。
 */
export function derivePhoneActionTally(
  events: readonly AgentEvent[] | undefined,
): { done: number; failed: number; total: number } {
  const seen = new Map<string, "done" | "failed" | "pending">();
  for (const event of events ?? []) {
    if (!event.type.startsWith("action.")) continue;
    const key = event.stepId || event.eventId;
    if (event.type === "action.completed") seen.set(key, event.status === "failed" ? "failed" : "done");
    else if (event.type === "action.failed") seen.set(key, "failed");
    else if (!seen.has(key)) seen.set(key, "pending");
  }
  let done = 0;
  let failed = 0;
  for (const state of seen.values()) {
    if (state === "done") done += 1;
    else if (state === "failed") failed += 1;
  }
  return { done, failed, total: seen.size };
}

/* ── 能力可供性（capability affordance）───────────────────────────── */

export interface PhoneCapabilityAffordance {
  capabilityId: string;
  label: string;
  access: "READ" | "WRITE";
  /** 會花到站內點數／付費供應商——UI 必須把這件事講出來，不得隱藏 */
  paid: boolean;
  /** 需要既有的確認／核准路徑；手機不得代按 */
  requiresConfirmation: boolean;
  /** 需要外部系統（行程同步、外部剪輯／生成）才算數 */
  external: boolean;
  /** 真的有「直接執行」路徑（既有 direct capability）；false＝只能提議或引導 */
  executable: boolean;
  requiredContextSlots: readonly string[];
}

/**
 * 把既有的 `ASSISTANT_CAPABILITIES` 投影成手機動作卡需要知道的那幾件事。
 *
 * **刻意不新增能力清單**：新增一份手機專用的 registry，等於兩邊的風險分級
 * 遲早會分岔，而分岔的那一天沒有人會發現——直到某個 COSTFUL 動作在手機上
 * 變成免確認的一鍵。所以這裡只讀既有那份，不維護第二份。
 */
export function phoneCapabilityAffordance(
  capabilityId: string | undefined,
): PhoneCapabilityAffordance | undefined {
  if (!capabilityId) return undefined;
  const capability = ASSISTANT_CAPABILITIES.find((item) => item.id === capabilityId);
  return capability ? affordanceOf(capability) : undefined;
}

function affordanceOf(capability: AssistantCapability): PhoneCapabilityAffordance {
  const paid = capability.risk === "COSTFUL";
  return {
    capabilityId: capability.id,
    label: capability.label,
    access: capability.access,
    paid,
    // SAFE_WRITE 之外的每一種寫入都要走既有確認／核准；READ 不需要。
    requiresConfirmation: capability.access === "WRITE" && capability.risk !== "SAFE_WRITE",
    external: capability.risk === "EXTERNAL",
    executable: capability.direct && capability.risk !== "DESTRUCTIVE",
    requiredContextSlots: capability.requiredContextSlots,
  };
}

/* ── 上下文膠囊 ───────────────────────────────────────────────────── */

export interface PhoneContextCapsule {
  /** 顯示行（已經是人話，永遠不含 uuid）；空陣列＝沒有值得顯示的上下文 */
  lines: string[];
  projectTitle?: string;
  focusLabel?: string;
  selectionCount: number;
}

export interface PhoneContextInput {
  projectTitle?: string;
  page?: AssistantWirePageContext | null;
  /** 專案頁已經算好的一句話進度（沿用 mobile/stages 的 stageSentence，不另算一份） */
  statusLine?: string;
}

/**
 * 上下文膠囊：讓「這個／這幕／這一鏡」在手機上看得見。
 *
 * 規則（計畫 §3.2）：只用既有註冊的 page/focus 上下文、不顯示 uuid、
 * **沒有具體焦點就整塊收起來**（回傳空 lines，呼叫端不渲染）。
 *
 * 最後那一條不是美學考量。手機首頁與專案頁的第一屏本來就把專案名與一句話進度
 * 印在標題區，膠囊若在沒有焦點時也顯示同樣兩行，畫面上會出現一模一樣的字兩次——
 * 佔掉的正是「一眼看到下一步」的那半屏。膠囊只在它**多提供了資訊**時才存在：
 * 使用者打開了某一鏡，或勾選了幾個東西。
 *
 * `projectTitle` 與 `focusLabel` 仍然一律回傳：它們是 `composePhoneGoal` 的輸入，
 * 與「要不要顯示」是兩件事。
 */
export function derivePhoneContextCapsule(input: PhoneContextInput): PhoneContextCapsule {
  const page = input.page ?? undefined;
  const entityName = page?.entityType ? ASSISTANT_ENTITY_LABEL[page.entityType] : undefined;
  const focusLabel = page?.entityLabel || entityName;
  const selectionCount = page?.selectedEntityIds?.length ?? 0;
  const hasFocus = selectionCount > 1 || !!focusLabel;

  const lines: string[] = [];
  if (hasFocus) {
    if (input.projectTitle) lines.push(input.projectTitle);
    else if (page) {
      const pageLabel = ASSISTANT_PAGE_LABEL[page.pageType];
      if (pageLabel) lines.push(pageLabel);
    }
    lines.push(selectionCount > 1 ? `已選 ${selectionCount} 個${entityName ?? "項目"}` : focusLabel!);
    if (input.statusLine) lines.push(input.statusLine);
  }

  return {
    lines: lines.slice(0, MAX_PHONE_CARD_LINES),
    ...(input.projectTitle ? { projectTitle: input.projectTitle } : {}),
    ...(focusLabel ? { focusLabel } : {}),
    selectionCount,
  };
}

/* ── 手機動作 ─────────────────────────────────────────────────────── */

/**
 * 手機動作只有三種，而且**沒有一種是「直接寫入」**。
 *
 * - `compose`：把一句已經帶好上下文的話送進既有助手（走完全相同的意圖判定／
 *   能力路由／確認卡／執行與驗證）。手機省下的是**打字與跨頁**，不是安全檢查。
 * - `open_assistant`：把使用者帶到既有的確認卡／選擇器前面（付費與高風險動作
 *   一律走這條，手機不得代按）。
 * - `navigate`：只用來看結果（深連結）。**導航成功不等於任務成功**，
 *   所以它永遠不會被拿來當「已完成」的證據。
 */
export type PhoneActionKind = "compose" | "open_assistant" | "navigate" | "phone_command";

export interface PhoneAssistantAction {
  id: string;
  label: string;
  kind: PhoneActionKind;
  /** kind=compose：要送出的那句話（已內含專案／幕／鏡的人話指涉） */
  prompt?: string;
  /** kind=navigate：站內路徑（含錨點）。不接受外部網址。 */
  href?: string;
  /** 這顆按鈕背後對應的既有能力（有的話）；決定要不要標示付費／需確認 */
  affordance?: PhoneCapabilityAffordance;
  /** 會花點數——按鈕上必須看得到（計畫 §2.5） */
  paid?: boolean;
  /** kind=phone_command：動畫 Production adapter 的 typed 指令（不含寫入權限） */
  command?: { type: string } & Record<string, unknown>;
}

/* ── 手機卡片 ─────────────────────────────────────────────────────── */

export type PhoneCardKind = "answer" | "proposal" | "progress" | "result" | "clarify";

export interface PhoneCard {
  kind: PhoneCardKind;
  title: string;
  /** 1–3 行狀態；每一行都必須對得上一個事件或收據 */
  lines: string[];
  steps: PhoneWorkStep[];
  primaryAction?: PhoneAssistantAction;
  secondaryAction?: PhoneAssistantAction;
  /** 失敗／部分成功時為真，UI 用它決定語氣與 aria 提示（不只靠顏色） */
  attention?: boolean;
  /** Clarify 選項（人話標籤）。選了才送 typed command，不猜。 */
  choices?: ReadonlyArray<{ id: string; label: string }>;
  /** 手機 Compare 用的現用／候選預覽。沒有就不要渲染，避免空框。 */
  media?: {
    current?: { kind: string; url: string } | null;
    candidate?: { kind: string; url: string } | null;
    currentLabel?: string;
    candidateLabel?: string;
  };
}

export interface PhoneProjectionInput {
  /** 這一輪助手回答的純文字（只取前幾行當摘要；不重寫、不加工） */
  answer?: string;
  /** 這一輪的可稽核事件流 */
  events?: readonly AgentEvent[];
  /** 尚待使用者確認的提議（既有助手的 action 卡；這裡只要標題） */
  pendingProposals?: readonly { id: string; label: string; capabilityId?: string }[];
  /** 既有 GoalFrame 的作用中目標 */
  activeGoal?: AssistantActiveGoal | null;
  /** 既有的 typed 交接（選擇器／確認卡／預算卡） */
  pendingInteraction?: AssistantInteractionRequest | null;
  /** 這一輪產生、且已通過驗證的收據 */
  results?: readonly AssistantActionResult[];
  /** 串流仍在跑 */
  running?: boolean;
  /** 供 result 卡做「看結果」深連結（呼叫端提供，通常是目前專案） */
  projectId?: string;
  now?: number;
}

const RESULT_LABEL: Record<AssistantActionResult["type"], string> = {
  import: "已加入素材",
  create_project: "已建立專案",
  create_task: "已建立任務",
  generation: "已送出生成",
  editing_handoff: "已準備外部剪輯",
  database_row: "資料庫已更新",
};

function firstLines(text: string | undefined, max: number): string[] {
  if (!text) return [];
  return text
    .split(/\n+/u)
    .map((line) => line.replace(/^[-*#>\s]+/u, "").trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * P4 修復：answer 落到純文字 fallback（「我不太確定…」）但事件流已有完成讀取時，
 * 卡片標題不得沿用那句不確定的首行——取最後一列已完成步驟的人話標籤。
 * 只認白名單事件摺出的 steps（derivePhoneWorkSteps），不讀自由文字、不猜意圖。
 */
function answerFallbackTitle(answer: string | undefined, steps: readonly PhoneWorkStep[]): string | undefined {
  if (!answer) return undefined;
  const first = firstLines(answer, 1)[0] ?? "";
  if (!/不太確定|換個問法/u.test(first)) return undefined;
  const done = [...steps].reverse().find((s) => s.state === "done" && s.label && !/不太確定|換個問法/u.test(s.label));
  return done?.label;
}

/**
 * 把一輪助手工作投影成一張手機卡。
 *
 * 判斷順序即優先序，而且**每一階都由權威狀態決定**，不是由文字猜的：
 *
 *   等待使用者輸入 → clarify
 *   仍在跑／目標未收斂 → progress
 *   有待確認提議 → proposal（絕不因為「模型說做完了」就跳到 result）
 *   有 verified 收據或 agent.completed → result
 *   其餘 → answer
 */
export function derivePhoneCard(input: PhoneProjectionInput): PhoneCard | null {
  const now = input.now ?? Date.now();
  const steps = derivePhoneWorkSteps(input.events);
  const goal = input.activeGoal ?? undefined;
  const verified = (input.results ?? []).filter((r) => r.verification.status === "verified");

  // 1) 在等使用者選／確認：這是最該被看見的狀態，優先於一切
  if (interactionIsWaiting(input.pendingInteraction, now)) {
    const request = input.pendingInteraction!;
    return {
      kind: "clarify",
      title: request.title,
      lines: firstLines(request.description, 2),
      steps,
      primaryAction: {
        id: "phone.interaction.open",
        label: request.expectedResultType === "confirmation" ? "查看確認內容" : "選擇",
        kind: "open_assistant",
      },
      attention: true,
    };
  }

  // 2) 還在做：只顯示真的發生過的階段
  const goalRunning = goal
    ? ["resolving", "running", "executing", "verifying", "ready"].includes(goal.status)
    : false;
  if (input.running || goalRunning) {
    return {
      kind: "progress",
      title: goalTitle(input) ?? "處理中",
      lines: [],
      steps,
      primaryAction: {
        id: "phone.progress.open",
        label: "查看進度",
        kind: "open_assistant",
      },
    };
  }

  // 3) 有待確認的提議：提議 ≠ 已寫入
  const proposals = input.pendingProposals ?? [];
  // waiting_user_input **without** a typed handoff or a listed proposal has nothing
  // to show on a proposal card — an empty "準備執行" card is worse than the answer
  // text that explains what is missing. The typed handoff case already returned above.
  if (proposals.length > 0 || goal?.status === "waiting_confirmation") {
    const affordances = proposals
      .map((proposal) => phoneCapabilityAffordance(proposal.capabilityId))
      .filter((a): a is PhoneCapabilityAffordance => !!a);
    const paid = affordances.some((a) => a.paid);
    return {
      kind: "proposal",
      title: goalTitle(input) ?? "準備執行",
      lines: proposals.slice(0, MAX_PHONE_CARD_LINES).map((p) => p.label),
      steps,
      primaryAction: {
        id: "phone.proposal.open",
        label: paid ? "查看內容與費用" : "查看並確認",
        kind: "open_assistant",
        ...(affordances[0] ? { affordance: affordances[0] } : {}),
        ...(paid ? { paid: true } : {}),
      },
    };
  }

  // 4) 已完成／部分完成：只認收據與 agent.completed
  const tally = derivePhoneActionTally(input.events);
  const failedRun = goal?.status === "failed"
    || (input.events ?? []).some((e) => e.type === "agent.failed" && e.status === "failed");
  const completedRun = goal?.status === "completed"
    || (input.events ?? []).some((e) => e.type === "agent.completed" && e.status === "ok");

  if (verified.length > 0 || failedRun || (completedRun && tally.total > 0)) {
    const partial = tally.total > 0 && tally.done < tally.total;
    const lines: string[] = [];
    if (tally.total > 0) lines.push(`完成 ${tally.done} / ${tally.total}`);
    for (const result of verified.slice(0, MAX_PHONE_CARD_LINES - lines.length)) {
      lines.push(resultLine(result));
    }
    if (failedRun && !lines.some((line) => line.startsWith("完成"))) lines.push("這次沒有完成");
    return {
      kind: "result",
      title: failedRun && !verified.length
        ? (goalTitle(input) ?? "沒有完成")
        : partial
          ? "部分完成"
          : (goalTitle(input) ?? "已完成"),
      lines: lines.slice(0, MAX_PHONE_CARD_LINES),
      steps,
      primaryAction: resultPrimaryAction(verified, input.projectId),
      secondaryAction: {
        id: "phone.result.detail",
        label: "查看詳情",
        kind: "open_assistant",
      },
      ...(partial || failedRun ? { attention: true } : {}),
    };
  }

  // 5) 純回答（P4：不確定 fallback＋已有完成步驟時，標題取步驟，不沿用不確定首行）
  const lines = firstLines(input.answer, MAX_PHONE_CARD_LINES);
  if (!lines.length && !steps.length) return null;
  const fallbackTitle = answerFallbackTitle(input.answer, steps);
  return {
    kind: "answer",
    title: fallbackTitle ?? lines[0] ?? "已回覆",
    lines: fallbackTitle ? lines : lines.slice(1),
    steps,
    secondaryAction: {
      id: "phone.answer.open",
      label: "看完整回覆",
      kind: "open_assistant",
    },
  };
}

function goalTitle(input: PhoneProjectionInput): string | undefined {
  const target = input.activeGoal?.frame.target;
  if (target?.label) return target.label;
  return undefined;
}

function resultLine(result: AssistantActionResult): string {
  const label = RESULT_LABEL[result.type];
  if (result.type === "import") return `${label}：${result.count} 個`;
  if (result.type === "create_task") return `${label}：${result.count} 件`;
  if (result.type === "generation") return `${label}：${result.generationIds.length} 個候選待裁決`;
  if (result.type === "create_project") return `${label}：${result.title}`;
  return label;
}

/**
 * 結果卡的下一步。
 *
 * 只有「看結果」這種唯讀導航才准出現在這裡——生成候選一律導到既有的
 * Candidate/Compare/Adopt 介面，由使用者自己 Adopt。手機不得代 Adopt（計畫 §18）。
 */
function resultPrimaryAction(
  verified: readonly AssistantActionResult[],
  projectId: string | undefined,
): PhoneAssistantAction | undefined {
  const generation = verified.find((r) => r.type === "generation");
  if (generation && generation.type === "generation") {
    return { id: "phone.result.review", label: "去裁決候選", kind: "navigate", href: `/p/${generation.projectId}#stage-create` };
  }
  const project = verified.find((r) => r.type === "create_project");
  if (project && project.type === "create_project") {
    return { id: "phone.result.project", label: "打開專案", kind: "navigate", href: `/p/${project.projectId}` };
  }
  const imported = verified.find((r) => r.type === "import");
  if (imported && imported.type === "import" && imported.projectId) {
    return { id: "phone.result.assets", label: "看加入的素材", kind: "navigate", href: `/p/${imported.projectId}` };
  }
  if (projectId) {
    return { id: "phone.result.open", label: "回專案", kind: "navigate", href: `/p/${projectId}` };
  }
  return undefined;
}

/* ── 上下文解析（讓「這幕／這一鏡」在手機上有所指）─────────────────── */

/**
 * 需要專案身分才成立的說法。兩類：
 * - 代名詞（這／那／它／剛剛）：完全沒有主詞；
 * - 專案內的東西（第二幕／分鏡／腳本／進度／角色／素材）：講得出名字，
 *   但那個名字在「哪一個專案」之外不成立。
 */
const PHONE_REFERENTIAL_RE = /(?:這|那|它|他們|剛剛|剛才|目前|現在|繼續|接下來|本案|第\s*[一二三四五六七八九十百\d]+\s*[幕鏡場]|分鏡|腳本|進度|角色|素材)/u;
/** 純代名詞：只有這種說法才需要把「正在看哪一個」也補進去 */
const PHONE_PRONOUN_FOCUS_RE = /(?:這|那|它)/u;
/** 明確要離開目前專案的說法——補上專案名反而會把意思改掉 */
const PHONE_NEW_SCOPE_RE = /(?:新(?:的)?專案|另(?:一)?個專案|建立.{0,6}專案|換一個專案|全部專案|所有專案)/u;

/**
 * 把一句手機說出來的話補上它依賴的上下文。
 *
 * ## 為什麼是「補在句子裡」而不是偷偷塞進提示詞
 *
 * 站內既有的 `pageContext` 線上格式**不帶 projectId**（見 assistantPageContext 檔頭：
 * 白名單只有 pageType／entity／selection）。專案身分是由路由決定、以 prop 傳給助手的——
 * 而手機首頁的路由是 `/dashboard`，沒有專案。所以在首頁說「第二幕改成晚上」時，
 * 助手真的不知道是哪個專案的第二幕。
 *
 * 解法不是新增一條隱藏通道，而是**把那句話補完整**：補上去的字會原樣出現在助手的
 * 輸入框與對話紀錄裡，使用者看得到自己送出了什麼。這與 #766 的 `lead` 提示詞
 * 是同一種做法（`我最近在做「X」…`），只是改成依實際指涉才補。
 *
 * 三條規則：
 * 1. 句子沒有指涉詞（已經指名了）→ 原樣送出，不加工。
 * 2. 專案名已經出現在句子裡 → 不重複。
 * 3. 沒有上下文可補 → 原樣送出（不得捏造一個專案）。
 */
export function composePhoneGoal(text: string, capsule: PhoneContextCapsule): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const project = capsule.projectTitle?.trim();
  if (!project) return trimmed;
  if (PHONE_NEW_SCOPE_RE.test(trimmed)) return trimmed;
  if (!PHONE_REFERENTIAL_RE.test(trimmed)) return trimmed;
  if (trimmed.includes(project)) return trimmed;
  // 焦點（正在看的那一鏡）只在使用者真的用代名詞時才補：他說「第二幕」時
  // 補上「第 3 鏡」會把他的意思改掉，那比不補更糟。
  const focus = capsule.selectionCount > 1 || !PHONE_PRONOUN_FOCUS_RE.test(trimmed)
    ? undefined
    : capsule.focusLabel?.trim();
  const where = focus && !trimmed.includes(focus) ? `「${project}」的${focus}` : `「${project}」`;
  return `在${where}：${trimmed}`;
}

/* ── 模糊刪除目標守門 ─────────────────────────────────────────────── */

/**
 * 破壞性動詞。刻意只認「刪除」家族——「改成」「換掉」會經過既有的
 * 提議／確認卡，而刪除在手機上最常以「刪掉這個」這種完全沒有主詞的形式出現。
 */
const PHONE_DESTRUCTIVE_RE = /(?:刪掉|刪除|移除|清掉|丟掉|delete|remove)/iu;
/** 明確指名了對象（有數字序數／具名實體）就不算模糊 */
const PHONE_EXPLICIT_TARGET_RE = /第\s*[一二三四五六七八九十百\d]+\s*[鏡幕場張個]|「[^」]+」|"[^"]+"/u;
/** 只有代名詞（這個／那個／它）＝沒有指名 */
const PHONE_PRONOUN_ONLY_RE = /(?:這個|這|那個|那|它|這些|那些|this|that|it)/iu;

export interface PhoneTargetCandidate {
  id: string;
  label: string;
}

export type PhoneTargetResolution =
  | { status: "not_destructive" }
  | { status: "resolved"; candidate?: PhoneTargetCandidate }
  | { status: "needs_choice"; candidates: PhoneTargetCandidate[] };

/**
 * 「刪掉這個」在有兩個以上合理對象時，**不准猜**（計畫 §16 Flow F）。
 *
 * 回傳 `needs_choice` 時呼叫端必須顯示目標選擇卡，而且**不得送出任何請求**——
 * 連唯讀的都不送，因為送出去就會進助手的對話歷史，下一輪的「就這個」會指到
 * 一個從來沒有被使用者確認過的對象。
 *
 * 只有一個候選時回 `resolved`：那不是猜，那是唯一解；助手端仍會重新解析與確認。
 */
export function resolvePhoneDestructiveTarget(
  text: string,
  candidates: readonly PhoneTargetCandidate[],
): PhoneTargetResolution {
  if (!PHONE_DESTRUCTIVE_RE.test(text)) return { status: "not_destructive" };
  if (PHONE_EXPLICIT_TARGET_RE.test(text)) return { status: "resolved" };
  if (!PHONE_PRONOUN_ONLY_RE.test(text)) return { status: "resolved" };
  const unique = dedupeCandidates(candidates);
  if (unique.length > 1) return { status: "needs_choice", candidates: unique.slice(0, 6) };
  return { status: "resolved", ...(unique[0] ? { candidate: unique[0] } : {}) };
}

function dedupeCandidates(candidates: readonly PhoneTargetCandidate[]): PhoneTargetCandidate[] {
  const byId = new Map<string, PhoneTargetCandidate>();
  for (const candidate of candidates) {
    if (candidate.id && candidate.label && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  return [...byId.values()];
}
