/**
 * 專案「下一步」——純 deterministic 規則推導，最多 3 項。
 *
 * 使用者不應自己判斷下一步。依據優先序：
 *   1. 失敗任務（立刻處理）
 *   2. 待審核／需修改
 *   3. 依階段的未完成內容（故事 → 分鏡 → 參考圖 → 生成 → 審核）
 *
 * LLM 可在外層補充理由文案，但「要做哪幾件事」必須由本模組決定，
 * 避免每次打開專案推薦清單漂來漂去。
 *
 * 不建新資料模型；輸入欄位對齊 scenes.listByProject、characters、
 * scenePresets、generations 既有回傳。
 */

export type NextStepKind =
  | "write_story"
  | "storyboard"
  | "scene_ref"
  | "character_ref"
  | "generate_shot"
  | "generate_video"
  | "review"
  | "fix_changes"
  | "retry_failed"
  | "deliver";

export type ProjectNextStep = {
  /** 穩定 key（同實體不重複） */
  id: string;
  kind: NextStepKind;
  /** 一句話：使用者看得到要做什麼 */
  label: string;
  /** 主要按鈕文字 */
  actionLabel: string;
  /** DOM 錨點（不含 #） */
  anchor: string;
  /** 可選：關聯實體 id（鏡／場景／角色） */
  entityId?: string;
  /** 優先權：數字越小越優先（內部排序用） */
  priority: number;
};

export type NextStepShotInput = {
  id: string;
  title: string;
  orderIndex: number;
  assetId?: string | null;
  assetKind?: string | null;
  pendingGenStatus?: string | null;
  reviewStatus?: string | null;
  prompt?: string | null;
  action?: string | null;
};

export type NextStepScenePresetInput = {
  id: string;
  name: string;
  referenceUrl?: string | null;
  referenceAssetId?: string | null;
};

export type NextStepCharacterInput = {
  id: string;
  name: string;
  referenceUrl?: string | null;
  referenceAssetId?: string | null;
};

export type NextStepGenerationInput = {
  id: string;
  status: string;
  /** 關聯鏡 id（若有） */
  sceneId?: string | null;
  title?: string | null;
};

export type DeriveProjectNextStepsInput = {
  hasStory: boolean;
  shots: NextStepShotInput[];
  scenePresets?: NextStepScenePresetInput[];
  characters?: NextStepCharacterInput[];
  generations?: NextStepGenerationInput[];
  /** 已封存則只給交付相關 */
  archived?: boolean;
};

const MAX_STEPS = 3;

function shotLabel(s: NextStepShotInput): string {
  const t = (s.title || "").trim();
  return t || `鏡頭 ${s.orderIndex + 1}`;
}

function isRunning(status: string | null | undefined): boolean {
  return status === "queued" || status === "running";
}

/**
 * 推導最多 3 個下一步。排序固定，同一實體不重複出現。
 */
export function deriveProjectNextSteps(
  input: DeriveProjectNextStepsInput,
): ProjectNextStep[] {
  const steps: ProjectNextStep[] = [];
  const seen = new Set<string>();

  const push = (step: ProjectNextStep) => {
    if (seen.has(step.id)) return;
    seen.add(step.id);
    steps.push(step);
  };

  if (input.archived) {
    push({
      id: "deliver",
      kind: "deliver",
      label: "專案已封存，可檢視交付內容",
      actionLabel: "看交付",
      anchor: "stage-deliver",
      priority: 0,
    });
    return steps;
  }

  const shots = [...(input.shots ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);
  const gens = input.generations ?? [];

  // ── 1. 失敗任務 ──────────────────────────────────────────
  for (const g of gens) {
    if (g.status !== "failed") continue;
    const related = g.sceneId ? shots.find((s) => s.id === g.sceneId) : null;
    const name = related ? shotLabel(related) : (g.title || "生成").trim();
    push({
      id: `retry-${g.id}`,
      kind: "retry_failed",
      label: `重試失敗：${name}`,
      actionLabel: "重試",
      anchor: "stage-create",
      entityId: g.sceneId ?? g.id,
      priority: 10,
    });
  }
  // 鏡上 pendingGenStatus 也可能是 failed
  for (const s of shots) {
    if (s.pendingGenStatus !== "failed") continue;
    push({
      id: `retry-shot-${s.id}`,
      kind: "retry_failed",
      label: `重試失敗：${shotLabel(s)}`,
      actionLabel: "重試",
      anchor: "stage-create",
      entityId: s.id,
      priority: 11,
    });
  }

  // ── 2. 待審核 / 需修改 ───────────────────────────────────
  for (const s of shots) {
    if (s.reviewStatus === "changes") {
      push({
        id: `fix-${s.id}`,
        kind: "fix_changes",
        label: `修改 ${shotLabel(s)}（審核要求修改）`,
        actionLabel: "去修改",
        anchor: "stage-create",
        entityId: s.id,
        priority: 20,
      });
    }
  }
  for (const s of shots) {
    if (s.pendingGenStatus === "awaiting_approval" || s.reviewStatus === "ready") {
      push({
        id: `review-${s.id}`,
        kind: "review",
        label: `審核 ${shotLabel(s)}`,
        actionLabel: "去審核",
        anchor: "stage-create",
        entityId: s.id,
        priority: 21,
      });
    }
  }

  // ── 3. 階段性未完成 ──────────────────────────────────────
  if (!input.hasStory) {
    push({
      id: "write-story",
      kind: "write_story",
      label: "還沒有故事——先把想法寫下來",
      actionLabel: "寫故事",
      anchor: "stage-story",
      priority: 30,
    });
  }

  if (input.hasStory && shots.length === 0) {
    push({
      id: "storyboard",
      kind: "storyboard",
      label: "故事有了，接下來拆成可製作的分鏡",
      actionLabel: "排分鏡",
      anchor: "stage-board",
      priority: 31,
    });
  }

  // 場景缺參考圖
  for (const sc of input.scenePresets ?? []) {
    const hasRef = Boolean(sc.referenceUrl) || Boolean(sc.referenceAssetId);
    if (hasRef) continue;
    const name = (sc.name || "場景").trim();
    push({
      id: `scene-ref-${sc.id}`,
      kind: "scene_ref",
      label: `補 ${name} 參考圖`,
      actionLabel: "補參考圖",
      anchor: "sec-scenes",
      entityId: sc.id,
      priority: 40,
    });
  }

  // 角色缺定裝參考圖
  for (const ch of input.characters ?? []) {
    const hasRef = Boolean(ch.referenceUrl) || Boolean(ch.referenceAssetId);
    if (hasRef) continue;
    const name = (ch.name || "角色").trim();
    push({
      id: `char-ref-${ch.id}`,
      kind: "character_ref",
      label: `補 ${name} 定裝參考圖`,
      actionLabel: "補參考圖",
      anchor: "sec-characters",
      entityId: ch.id,
      priority: 41,
    });
  }

  // 分鏡缺畫面 → 生成
  for (const s of shots) {
    if (s.assetId) continue;
    if (isRunning(s.pendingGenStatus)) continue;
    if (s.pendingGenStatus === "failed") continue; // 已在失敗列
    if (s.pendingGenStatus === "awaiting_approval") continue;
    push({
      id: `gen-${s.id}`,
      kind: "generate_shot",
      label: `生成 ${shotLabel(s)}`,
      actionLabel: "生成",
      anchor: "stage-create",
      entityId: s.id,
      priority: 50,
    });
  }

  // 有圖無影片
  for (const s of shots) {
    if (!s.assetId) continue;
    if (s.assetKind === "video") continue;
    if (isRunning(s.pendingGenStatus)) continue;
    push({
      id: `video-${s.id}`,
      kind: "generate_video",
      label: `生成 ${shotLabel(s)} 影片`,
      actionLabel: "生成影片",
      anchor: "stage-create",
      entityId: s.id,
      priority: 55,
    });
  }

  // 有成品但未審核
  for (const s of shots) {
    if (!s.assetId) continue;
    if (s.reviewStatus === "approved" || s.reviewStatus === "changes") continue;
    if (s.reviewStatus === "ready") continue; // 已在待審核
    if (s.pendingGenStatus === "awaiting_approval") continue;
    push({
      id: `review-pending-${s.id}`,
      kind: "review",
      label: `審核 ${shotLabel(s)}`,
      actionLabel: "去審核",
      anchor: "stage-deliver",
      entityId: s.id,
      priority: 60,
    });
  }

  // 全部就緒 → 交付
  if (
    input.hasStory &&
    shots.length > 0 &&
    shots.every((s) => s.assetId && s.reviewStatus === "approved")
  ) {
    push({
      id: "deliver-ready",
      kind: "deliver",
      label: "各鏡都通過了，可以打包交付",
      actionLabel: "去交付",
      anchor: "stage-deliver",
      priority: 70,
    });
  }

  return steps
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .slice(0, MAX_STEPS);
}

/** 取第一優先下一步的標籤（相容既有 nextLabel） */
export function primaryNextLabel(steps: ProjectNextStep[], fallback: string): string {
  return steps[0]?.label ?? fallback;
}

export function primaryNextAnchor(steps: ProjectNextStep[], fallback: string): string {
  return steps[0]?.anchor ?? fallback;
}
