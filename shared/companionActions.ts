/**
 * Companion Action Registry — 手機語音／對話下指令時的「要不要先問一聲」政策。
 *
 * ## 為什麼不是新的能力表
 *
 * 站內已經有 `shared/assistantExecution.ts` 的 `ASSISTANT_CAPABILITIES`：每一項
 * 都對得上一個真的 handler、一個 risk、一個 verificationStrategy。再寫一份
 * 「手機版能力表」等於保證兩份會漂移，而漂移的那一天使用者會在手機上按到一個
 * 桌面已經下架的動作。
 *
 * 這裡做的是**投影**：把既有 risk（READ/SAFE_WRITE/COSTFUL/EXTERNAL/DESTRUCTIVE）
 * 折成手機情境要的三檔確認政策，並把「可不可以撤銷」講清楚。
 *
 * ## 三檔政策（任務書 §11）
 *
 * - `low`    → 直接做，不打斷。查進度、看任務、看素材、查專案。
 * - `medium` → 直接做，但要留一條 Undo／Cancel。重新生成、建立任務、改非核心 metadata。
 * - `high`   → 一定要確認卡。刪除、覆蓋、改角色 Reference、改專案核心設定、
 *              大批次花費、發布／分享。
 *
 * 紅線：**不要每個小操作都問「確定嗎？」**。那會讓語音變成比手動還慢的介面。
 * 所以 low 一律不問，medium 只在事後給退路，只有 high 才擋在前面。
 *
 * ## 這裡不做授權
 *
 * 政策只決定「UI 要不要先問」。真正能不能做，仍由伺服器端既有的
 * requireGroup／assertProjectAllows／assertPolicy 決定。把這份表改壞
 * 不會多出任何權限，只會多問或少問一次。
 */
import {
  ASSISTANT_CAPABILITIES,
  type AssistantActionRisk,
  type AssistantCapability,
} from "./assistantExecution";

export const COMPANION_RISK_TIERS = ["low", "medium", "high"] as const;
export type CompanionRiskTier = typeof COMPANION_RISK_TIERS[number];

export type CompanionConfirmMode =
  /** 直接執行，不打斷 */
  | "auto"
  /** 直接執行，畫面上留一顆「取消／復原」 */
  | "auto_with_undo"
  /** 執行前必須出確認卡 */
  | "confirm_card";

export interface CompanionActionPolicy {
  capabilityId: string;
  label: string;
  tier: CompanionRiskTier;
  confirm: CompanionConfirmMode;
  /** 執行後有沒有真的可以撤銷的路徑（globalAssistant.undoSiteAction 之類） */
  undoable: boolean;
  /** 會不會花點數／算力——手機上要在確認卡講出來 */
  costful: boolean;
  /** 會不會影響到系統外的人（私訊、發布、外部行事曆） */
  external: boolean;
  /** 語音模式要不要唸出確認句 */
  speakConfirmation: boolean;
}

/**
 * 明確覆寫。
 *
 * 兩種情況需要覆寫既有 risk：
 *
 * 1. **既有 risk 對桌面剛好，對手機太鬆**：`animation_adopt_candidate` 在桌面是
 *    SAFE_WRITE（旁邊就是 A/B 對照圖，看著按的），但在手機語音情境下它是
 *    「把現用畫面換掉」——沒看到圖就換掉要留退路，故升成 medium。
 * 2. **既有 risk 對手機太緊**：唯讀的動畫檢查在桌面標 READ，這裡照樣 low，
 *    不需要覆寫；列在這裡只是為了讓「為什麼沒覆寫」有跡可循。
 */
const TIER_OVERRIDES: Record<string, CompanionRiskTier> = {
  // 永久改角色 Reference＝之後每一張圖都跟著變，任務書明列 High Risk。
  add_character: "high",
  // 發私訊給別人、對外行事曆——不可撤回的對外影響。
  send_dm: "high",
  add_schedule_item: "high",
  // 大型批次花費：跨專案活動會同時開很多 run。
  orchestrate_group_campaign: "high",
  // 換掉現用畫面：可復原，但要看得到 Undo。
  animation_adopt_candidate: "medium",
};

/** risk → 預設 tier。DESTRUCTIVE/EXTERNAL 一律 high，COSTFUL 是 medium（花錢但可停）。 */
function tierForRisk(risk: AssistantActionRisk): CompanionRiskTier {
  switch (risk) {
    case "READ":
      return "low";
    case "SAFE_WRITE":
      return "medium";
    case "COSTFUL":
      return "medium";
    case "EXTERNAL":
    case "DESTRUCTIVE":
      return "high";
  }
}

function confirmForTier(tier: CompanionRiskTier, undoable: boolean): CompanionConfirmMode {
  if (tier === "high") return "confirm_card";
  if (tier === "low") return "auto";
  return undoable ? "auto_with_undo" : "confirm_card";
}

/**
 * 有沒有真的撤銷路徑。
 *
 * 「可撤銷」在這裡是**技術事實**，不是願望：只有 read_back 驗證過、且對應的
 * core 有 remove／revoke／cancel 的能力才算。job_registered（已經送進生成佇列）
 * 不算——那筆算力已經花出去了，取消只是不再等它。
 *
 * 這個判斷保守：算不出來就當作不可撤銷，於是 medium 會被推上確認卡。
 * 寧可多問一次，也不要承諾一個做不到的 Undo。
 */
const UNDOABLE_CAPABILITIES = new Set([
  "create_project",
  "create_task",
  "add_note",
  "save_decision",
  "create_watch",
  "add_schedule_item",
  "add_database_row",
  "animation_adopt_candidate",
  "animation_keep_current",
]);

export function companionActionPolicy(capability: AssistantCapability): CompanionActionPolicy {
  const tier = TIER_OVERRIDES[capability.id] ?? tierForRisk(capability.risk);
  const undoable = UNDOABLE_CAPABILITIES.has(capability.id);
  return {
    capabilityId: capability.id,
    label: capability.label,
    tier,
    confirm: confirmForTier(tier, undoable),
    undoable,
    costful: capability.risk === "COSTFUL",
    external: capability.risk === "EXTERNAL" || capability.id === "send_dm",
    // 語音模式只在真的要擋人時開口；low 說話只會變成噪音。
    speakConfirmation: tier === "high",
  };
}

/** 全表（穩定順序＝既有能力表的順序，方便 diff）。 */
export const COMPANION_ACTION_POLICIES: readonly CompanionActionPolicy[] =
  ASSISTANT_CAPABILITIES.map(companionActionPolicy);

const BY_ID = new Map(COMPANION_ACTION_POLICIES.map((policy) => [policy.capabilityId, policy]));

/**
 * 查一項能力的政策。
 *
 * 查不到時回 high／confirm_card——**未知的東西一律先問**。這是唯一安全的預設值：
 * 新增能力的人忘了想手機情境時，最壞的後果是多一張確認卡，而不是靜默執行一個
 * 沒有人審過的寫入。
 */
export function companionPolicyFor(capabilityId: string | undefined | null): CompanionActionPolicy {
  const found = capabilityId ? BY_ID.get(capabilityId) : undefined;
  if (found) return found;
  return {
    capabilityId: capabilityId ?? "unknown",
    label: "未登錄的操作",
    tier: "high",
    confirm: "confirm_card",
    undoable: false,
    costful: false,
    external: false,
    speakConfirmation: true,
  };
}

/** 這項能力可不可以在沒有使用者再次點擊的情況下直接跑。 */
export function companionCanAutoRun(capabilityId: string | undefined | null): boolean {
  return companionPolicyFor(capabilityId).confirm !== "confirm_card";
}

/**
 * Companion Native Action Registry（任務書 §B7）。
 *
 * ## 這張表是什麼、不是什麼
 *
 * 是：Companion 介面上每一個「確定性動作」（按鈕、語音直達）的**型錄**——
 * 每一項都指向一個既有端點或既有助手能力，帶風險層級與確認政策。
 * UI 與測試都讀這張表，所以「手機上按得到但沒人審過風險」的動作不可能存在。
 *
 * 不是：第二套 Agent。`assistant` 路徑把話交給既有助手（意圖判定／能力路由／
 * 確認卡全部沿用）；`trpc:` 路徑呼叫既有 procedure；`deeplink:` 走
 * companionDeepLink 開 Web。這裡沒有任何新的執行機。
 */
export type CompanionNativeActionKind = "read" | "safe_write" | "navigation";

export interface CompanionNativeAction {
  id: string;
  label: string;
  kind: CompanionNativeActionKind;
  tier: CompanionRiskTier;
  confirm: CompanionConfirmMode;
  /**
   * 執行途徑：
   * - `trpc:<router.procedure>`：直接呼叫既有端點（確定性）
   * - `assistant`：交給既有助手——意圖判定與確認流程原樣沿用
   * - `deeplink:<target>`：companionDeepLink 開 Web
   */
  route: string;
}

export const COMPANION_NATIVE_ACTIONS: readonly CompanionNativeAction[] = [
  // ── Read（LOW：直接做，不打斷） ──
  { id: "get_current_project", label: "目前專案", kind: "read", tier: "low", confirm: "auto", route: "trpc:companion.context" },
  { id: "get_project_progress", label: "專案進度", kind: "read", tier: "low", confirm: "auto", route: "trpc:companion.digest" },
  { id: "get_running_tasks", label: "進行中任務", kind: "read", tier: "low", confirm: "auto", route: "trpc:companion.digest" },
  { id: "get_failed_tasks", label: "失敗任務", kind: "read", tier: "low", confirm: "auto", route: "trpc:companion.failedGenerations" },
  { id: "get_recent_generations", label: "最近生成", kind: "read", tier: "low", confirm: "auto", route: "trpc:companion.context" },
  { id: "get_pending_approvals", label: "待確認", kind: "read", tier: "low", confirm: "auto", route: "trpc:companion.digest" },
  { id: "get_current_scene", label: "目前場景", kind: "read", tier: "low", confirm: "auto", route: "trpc:companion.context" },
  { id: "get_current_shot", label: "目前鏡頭", kind: "read", tier: "low", confirm: "auto", route: "trpc:companion.context" },

  // ── Safe write（MEDIUM：可執行；花點數的批次先出確認卡） ──
  /** 重跑失敗生成：讀 companion.failedGenerations 列卡 → 確認 → 逐筆 generation.retry（既有端點，完整還原錨點） */
  { id: "retry_generation", label: "重跑失敗生成", kind: "safe_write", tier: "medium", confirm: "confirm_card", route: "trpc:generation.retry" },
  /** 以下走既有助手（能力路由／COSTFUL 提議卡原樣沿用），不是繞過 */
  { id: "continue_next_shot", label: "繼續下一鏡", kind: "safe_write", tier: "medium", confirm: "auto_with_undo", route: "assistant" },
  { id: "generate_image", label: "生成圖片", kind: "safe_write", tier: "medium", confirm: "confirm_card", route: "assistant" },
  { id: "generate_video", label: "生成影片", kind: "safe_write", tier: "medium", confirm: "confirm_card", route: "assistant" },
  { id: "run_existing_workflow", label: "執行既有工作流", kind: "safe_write", tier: "medium", confirm: "confirm_card", route: "assistant" },
  { id: "create_note", label: "建立筆記", kind: "safe_write", tier: "medium", confirm: "auto_with_undo", route: "assistant" },

  // ── Navigation（LOW：開 Web） ──
  { id: "open_project_web", label: "開啟完整專案", kind: "navigation", tier: "low", confirm: "auto", route: "deeplink:project" },
  { id: "open_storyboard_web", label: "開啟分鏡", kind: "navigation", tier: "low", confirm: "auto", route: "deeplink:storyboard" },
  { id: "open_asset_web", label: "開啟素材", kind: "navigation", tier: "low", confirm: "auto", route: "deeplink:assets" },
  { id: "open_generation_web", label: "開啟生成紀錄", kind: "navigation", tier: "low", confirm: "auto", route: "deeplink:production" },
];

/**
 * 確認卡要講什麼。
 *
 * 只講**這一次會發生什麼**與**會不會回不去**，不寫「此操作不可復原，請謹慎考慮」
 * 那種法務語氣——手機上沒有人會讀第二行。
 */
export function companionConfirmCopy(
  policy: CompanionActionPolicy,
  detail?: { count?: number; targetLabel?: string },
): { title: string; body: string; confirmLabel: string; cancelLabel: string } {
  const target = detail?.targetLabel ? `「${detail.targetLabel}」` : "";
  const count = detail?.count && detail.count > 1 ? `${detail.count} 項` : "";
  const scope = [count, target].filter(Boolean).join(" ");
  const consequences: string[] = [];
  if (policy.costful) consequences.push("會用到生成點數");
  if (policy.external) consequences.push("其他人會收到");
  if (!policy.undoable) consequences.push("送出後無法復原");
  return {
    title: `${policy.label}${scope ? `：${scope}` : ""}`,
    body: consequences.length ? consequences.join("，") + "。" : "確認後我就開始。",
    confirmLabel: "就這樣做",
    cancelLabel: "先不要",
  };
}
