/**
 * 專案「卡住了」——deterministic 找出最重要的 3～5 個 blockers。
 *
 * 每個 blocker 回答三件事：
 *   1. 發生什麼（what）
 *   2. 影響哪裡（impact）
 *   3. 怎麼解決（fix）
 *
 * 與 nextSteps 的差異：
 *   - nextSteps = 建議下一步（行動導向）
 *   - blockers  = 卡住原因（診斷導向）
 * 兩者可共用狀態來源，但文案結構不同。
 *
 * AI Assistant 用 formatProjectBlockersAnswer 回答「這個專案現在卡在哪？」
 * ——同一份純函式真相，不另建掃描器。
 */

export type BlockerSeverity = "critical" | "high" | "medium";

export type BlockerKind =
  | "provider_unavailable"
  | "missing_api"
  | "generation_failed"
  | "awaiting_review"
  | "needs_changes"
  | "missing_characters"
  | "missing_scenes"
  | "shot_missing_asset"
  | "stale_upstream";

export type ProjectBlocker = {
  id: string;
  kind: BlockerKind;
  severity: BlockerSeverity;
  /** 發生什麼 */
  what: string;
  /** 影響哪裡 */
  impact: string;
  /** 怎麼解決（一句話） */
  fix: string;
  /** 主按鈕 */
  actionLabel: string;
  /** DOM 錨點（不含 #） */
  anchor: string;
  entityId?: string;
  priority: number;
};

export type BlockerShotInput = {
  id: string;
  title: string;
  orderIndex: number;
  assetId?: string | null;
  assetKind?: string | null;
  pendingGenStatus?: string | null;
  reviewStatus?: string | null;
  /** 上游角色/場景/造型變更後畫面過時 */
  stale?: boolean;
};

export type BlockerGenerationInput = {
  id: string;
  status: string;
  sceneId?: string | null;
  title?: string | null;
  errorMessage?: string | null;
};

export type DeriveProjectBlockersInput = {
  hasStory: boolean;
  characterCount: number;
  /** 敘事人物數；>0 且 characterCount=0 → 缺角色 */
  peopleCount?: number;
  scenePresetCount: number;
  /** 故事場次數；>0 且 scenePresetCount=0 → 缺場景 */
  storySceneCount?: number;
  shots: BlockerShotInput[];
  generations?: BlockerGenerationInput[];
  /** 生成 provider 是否可用（fal 等） */
  providerAvailable?: boolean | null;
  /** 是否已設定必要 API 金鑰 */
  apiConfigured?: boolean | null;
  archived?: boolean;
};

const MAX_BLOCKERS = 5;

function shotLabel(s: { title: string; orderIndex: number }): string {
  const t = (s.title || "").trim();
  return t || `鏡頭 ${s.orderIndex + 1}`;
}

/**
 * 推導專案 blockers，依嚴重度與優先序取前 5 個。
 */
export function deriveProjectBlockers(
  input: DeriveProjectBlockersInput,
): ProjectBlocker[] {
  if (input.archived) return [];

  const items: ProjectBlocker[] = [];
  const seen = new Set<string>();
  const push = (b: ProjectBlocker) => {
    if (seen.has(b.id)) return;
    seen.add(b.id);
    items.push(b);
  };

  const shots = [...(input.shots ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);
  const gens = input.generations ?? [];

  // ── Critical：基礎設施 ──────────────────────────────────
  if (input.providerAvailable === false) {
    push({
      id: "provider-unavailable",
      kind: "provider_unavailable",
      severity: "critical",
      what: "生成服務目前無法使用",
      impact: "所有畫面／影片生成都會失敗",
      fix: "稍後再試，或到整合設定檢查服務狀態",
      actionLabel: "看設定",
      anchor: "sec-settings",
      priority: 1,
    });
  }

  if (input.apiConfigured === false) {
    push({
      id: "missing-api",
      kind: "missing_api",
      severity: "critical",
      what: "尚未設定生成用的 API 金鑰",
      impact: "無法呼叫外部生成模型",
      fix: "到個人或團隊設定補上 API 金鑰",
      actionLabel: "去設定",
      anchor: "sec-settings",
      priority: 2,
    });
  }

  // ── High：失敗 / 審核阻塞 ───────────────────────────────
  for (const g of gens) {
    if (g.status !== "failed") continue;
    const related = g.sceneId ? shots.find((s) => s.id === g.sceneId) : null;
    const name = related ? shotLabel(related) : (g.title || "生成").trim();
    const detail = (g.errorMessage || "").trim();
    push({
      id: `gen-fail-${g.id}`,
      kind: "generation_failed",
      severity: "high",
      what: `生成失敗：${name}${detail ? `（${detail.slice(0, 40)}）` : ""}`,
      impact: related ? `${name} 沒有可用的成品` : "這次生成沒有產出可用結果",
      fix: "檢查提示詞與參考圖後重試",
      actionLabel: "去重試",
      anchor: "stage-create",
      entityId: g.sceneId ?? g.id,
      priority: 10,
    });
  }

  for (const s of shots) {
    if (s.pendingGenStatus === "failed") {
      push({
        id: `shot-fail-${s.id}`,
        kind: "generation_failed",
        severity: "high",
        what: `生成失敗：${shotLabel(s)}`,
        impact: `${shotLabel(s)} 目前沒有可用畫面`,
        fix: "到製作區重新生成這一鏡",
        actionLabel: "去重試",
        anchor: "stage-create",
        entityId: s.id,
        priority: 11,
      });
    }
  }

  for (const s of shots) {
    if (s.reviewStatus === "changes") {
      push({
        id: `changes-${s.id}`,
        kind: "needs_changes",
        severity: "high",
        what: `審核要求修改：${shotLabel(s)}`,
        impact: "這一鏡不能進成片，必須先改",
        fix: "依審核意見修改後再送審",
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
        id: `await-${s.id}`,
        kind: "awaiting_review",
        severity: "high",
        what: `等待審核：${shotLabel(s)}`,
        impact: "成品卡在審核，後續流程無法推進",
        fix: "到製作區裁決通過或要求修改",
        actionLabel: "去審核",
        anchor: "stage-create",
        entityId: s.id,
        priority: 21,
      });
    }
  }

  // ── Medium：缺內容 / 缺素材 / 過時 ────────────────────────
  const needChars =
    input.characterCount === 0 &&
    (input.hasStory || (input.peopleCount ?? 0) > 0 || shots.length > 0);
  if (needChars) {
    const expected = input.peopleCount && input.peopleCount > 0 ? input.peopleCount : null;
    push({
      id: "missing-characters",
      kind: "missing_characters",
      severity: "medium",
      what: expected ? `還缺角色定裝（敘事有 ${expected} 人，定裝 0）` : "還沒有角色定裝",
      impact: "生成時人物外觀容易不一致",
      fix: "建立角色卡並補上參考圖",
      actionLabel: "去角色",
      anchor: "sec-characters",
      priority: 30,
    });
  }

  const needScenes =
    input.scenePresetCount === 0 &&
    (input.hasStory || (input.storySceneCount ?? 0) > 0 || shots.length > 0);
  if (needScenes) {
    const expected = input.storySceneCount && input.storySceneCount > 0 ? input.storySceneCount : null;
    push({
      id: "missing-scenes",
      kind: "missing_scenes",
      severity: "medium",
      what: expected ? `還缺場景設定（故事有 ${expected} 場，定裝 0）` : "還沒有場景設定",
      impact: "同場景跨鏡的光影與空間容易漂",
      fix: "建立場景卡並補上參考圖",
      actionLabel: "去場景",
      anchor: "sec-scenes",
      priority: 31,
    });
  }

  const missingAssetShots = shots.filter(
    (s) =>
      !s.assetId &&
      s.pendingGenStatus !== "running" &&
      s.pendingGenStatus !== "queued" &&
      s.pendingGenStatus !== "failed" &&
      s.pendingGenStatus !== "awaiting_approval",
  );
  if (missingAssetShots.length > 0) {
    const first = missingAssetShots[0];
    const extra = missingAssetShots.length - 1;
    push({
      id: "shots-missing-asset",
      kind: "shot_missing_asset",
      severity: "medium",
      what:
        extra > 0
          ? `${missingAssetShots.length} 鏡缺少畫面素材（例如 ${shotLabel(first)}）`
          : `${shotLabel(first)} 缺少畫面素材`,
      impact: "沒有畫面就無法進入影片與交付",
      fix: "到分鏡或製作區為缺件鏡頭生成畫面",
      actionLabel: "去生成",
      anchor: "stage-create",
      entityId: first.id,
      priority: 40,
    });
  }

  const staleShots = shots.filter((s) => s.stale && s.assetId);
  if (staleShots.length > 0) {
    const first = staleShots[0];
    const extra = staleShots.length - 1;
    push({
      id: "stale-upstream",
      kind: "stale_upstream",
      severity: "medium",
      what:
        extra > 0
          ? `${staleShots.length} 鏡的上游設定已變更（例如 ${shotLabel(first)}）`
          : `${shotLabel(first)} 的上游設定已變更`,
      impact: "現有畫面可能與最新角色／場景／造型不一致",
      fix: "確認後規劃修復，產生新候選（不會直接覆寫）",
      actionLabel: "去確認",
      anchor: "stage-create",
      entityId: first.id,
      priority: 45,
    });
  }

  return items
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .slice(0, MAX_BLOCKERS);
}

/**
 * AI Assistant 回答「這個專案現在卡在哪？」的 deterministic 文案。
 * 無 blockers 時回傳明確的「沒有明顯卡住」。
 */
export function formatProjectBlockersAnswer(blockers: ProjectBlocker[]): string {
  if (!blockers.length) {
    return "目前沒有明顯卡住的地方——可以依「下一步」繼續推進。";
  }
  const lines = blockers.map((b, i) => {
    const sev =
      b.severity === "critical" ? "嚴重" : b.severity === "high" ? "重要" : "注意";
    return `${i + 1}. 【${sev}】${b.what}\n   影響：${b.impact}\n   解決：${b.fix}`;
  });
  return `這個專案現在主要卡在這 ${blockers.length} 件事：\n\n${lines.join("\n\n")}`;
}

/** 給 prompt／context 用的精簡列（一行一 blocker） */
export function compactProjectBlockersForContext(blockers: ProjectBlocker[]): string[] {
  return blockers.map((b) => `[${b.severity}] ${b.what} → ${b.fix}`);
}
