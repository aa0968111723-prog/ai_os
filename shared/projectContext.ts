/**
 * Project / Scene / Shot Context — 共用契約（DB contract，不是 UI 文案）。
 *
 * 站內已經有 Project、Scene（story_scenes）、Shot（scenes）、Character、Knowledge、Asset、
 * Intelligence 與 Entity Graph，缺的是把它們串起來的**單一 Context 語彙**：
 * 一份資料在某個範圍裡「扮演什麼角色」「有多重要」「這件事是誰說的」。
 *
 * 所以這裡定義的是：
 *   scopeType × role × priority × source
 * 四個列舉，前後端與 DB 共用同一組 key。UI 文案另外映射（`*_LABEL`），
 * **不可**把中文字串寫進資料庫。
 *
 * ★ 不變量：`AI_SUGGESTED` 永遠不會自己變成 `USER_CONFIRMED`（§23 / §36）。
 *   升級只能由使用者的明確動作觸發，`isConfirmedContextSource()` 是唯一判準。
 */

/* ────────────────────────── 範圍 ────────────────────────── */

/** project → scene（story_scenes）→ shot（scenes）。越接近 shot 優先度越高。 */
export const CONTEXT_SCOPE_TYPES = ["project", "scene", "shot"] as const;
export type ContextScopeType = (typeof CONTEXT_SCOPE_TYPES)[number];

export const CONTEXT_SCOPE_LABEL: Record<ContextScopeType, string> = {
  project: "專案",
  scene: "場景",
  shot: "分鏡",
};

/** 解析順序（大＝優先）：Shot > Scene > Project。 */
export function contextScopeRank(scope: ContextScopeType): number {
  return scope === "shot" ? 3 : scope === "scene" ? 2 : 1;
}

/* ────────────────────────── 角色 ────────────────────────── */

export const CONTEXT_ROLES = [
  "WORLD_BUILDING",
  "STORY_SOURCE",
  "SCRIPT_SOURCE",
  "CHARACTER_REFERENCE",
  "LOCATION_REFERENCE",
  "VISUAL_REFERENCE",
  "STYLE_REFERENCE",
  "AUDIO_REFERENCE",
  "RESEARCH",
  "PRODUCTION_ASSET",
  "DELIVERY_ASSET",
] as const;
export type ContextRole = (typeof CONTEXT_ROLES)[number];

export const CONTEXT_ROLE_LABEL: Record<ContextRole, string> = {
  WORLD_BUILDING: "世界觀",
  STORY_SOURCE: "故事來源",
  SCRIPT_SOURCE: "腳本來源",
  CHARACTER_REFERENCE: "人物參考",
  LOCATION_REFERENCE: "場景參考",
  VISUAL_REFERENCE: "視覺參考",
  STYLE_REFERENCE: "風格參考",
  AUDIO_REFERENCE: "聲音參考",
  RESEARCH: "研究資料",
  PRODUCTION_ASSET: "製作素材",
  DELIVERY_ASSET: "交付成品",
};

/**
 * 「單值」角色：越靠近 Shot 的設定會**整組取代**外層，而不是疊加。
 * 風格與腳本這種東西同時套兩份只會互相打架——所以 Shot 一旦指定 Style，
 * Scene／Project 的 Style 就不進 context（§19 的繼承語意）。
 */
const SINGLE_VALUED_ROLES = new Set<ContextRole>(["STYLE_REFERENCE", "SCRIPT_SOURCE", "WORLD_BUILDING"]);

export function isSingleValuedRole(role: ContextRole): boolean {
  return SINGLE_VALUED_ROLES.has(role);
}

export function isContextRole(value: string): value is ContextRole {
  return (CONTEXT_ROLES as readonly string[]).includes(value);
}

/* ────────────────────────── 優先度 ────────────────────────── */

/** 同一個人物可能有 300 張照片——AI 不能全部同權（§18）。 */
export const CONTEXT_PRIORITIES = ["PRIMARY", "SECONDARY", "SUPPORTING"] as const;
export type ContextPriority = (typeof CONTEXT_PRIORITIES)[number];

export const CONTEXT_PRIORITY_LABEL: Record<ContextPriority, string> = {
  PRIMARY: "主要參考",
  SECONDARY: "次要參考",
  SUPPORTING: "輔助",
};

export function contextPriorityRank(priority: ContextPriority): number {
  return priority === "PRIMARY" ? 3 : priority === "SECONDARY" ? 2 : 1;
}

/* ────────────────────────── 來源可信度 ────────────────────────── */

export const CONTEXT_SOURCES = [
  "USER_CONFIRMED",
  "PROJECT_CONFIRMED",
  "AI_SUGGESTED",
  "INHERITED",
  "GLOBAL_RETRIEVAL",
] as const;
export type ContextSource = (typeof CONTEXT_SOURCES)[number];

export const CONTEXT_SOURCE_LABEL: Record<ContextSource, string> = {
  USER_CONFIRMED: "使用者確認",
  PROJECT_CONFIRMED: "專案已確認",
  AI_SUGGESTED: "AI 建議",
  INHERITED: "繼承自上層",
  GLOBAL_RETRIEVAL: "資料中心搜尋",
};

export function contextSourceRank(source: ContextSource): number {
  switch (source) {
    case "USER_CONFIRMED": return 5;
    case "PROJECT_CONFIRMED": return 4;
    case "INHERITED": return 3;
    case "AI_SUGGESTED": return 2;
    case "GLOBAL_RETRIEVAL": default: return 1;
  }
}

/**
 * 這筆 context 算不算「人已經確認過」？
 * ★ 只有這兩個值算數。AI_SUGGESTED 永遠不會因為被用過就自動升級（§36）。
 */
export function isConfirmedContextSource(source: ContextSource): boolean {
  return source === "USER_CONFIRMED" || source === "PROJECT_CONFIRMED";
}

/* ────────────────────────── Binding 與繼承 ────────────────────────── */

export interface ContextBindingLike {
  id: string;
  scopeType: ContextScopeType;
  scopeId: string;
  role: ContextRole;
  priority: ContextPriority;
  source: ContextSource;
  confidence: number | null;
  confirmedByUser: boolean;
  /** Intelligence sidecar id（有分析過才有）；沒有時仍可用 resourceKind + resourceId 定位 */
  intelligenceId: string | null;
  resourceKind: string;
  resourceId: string;
}

export interface ResolvedContextEntry<T extends ContextBindingLike = ContextBindingLike> {
  binding: T;
  /** 實際生效的來源：從外層繼承下來的會被標成 INHERITED，原始值保留在 binding.source */
  effectiveSource: ContextSource;
  /** 這筆是從哪個範圍來的 */
  fromScope: ContextScopeType;
}

/**
 * Shot → Scene → Project 的繼承解析。
 *
 * 規則（§19）：
 *  - 單值角色（Style / Script / World building）：**最靠近 Shot 的那一層整組取代外層**。
 *    Shot 沒指定就繼承 Scene，Scene 沒指定才用 Project。
 *  - 多值角色（人物／場景／視覺／聲音參考…）：各層聯集，但同一份資源只留最靠近 Shot 的那筆
 *    （Shot 可以把 Project 標成 SECONDARY 的照片提成 PRIMARY，這就是「本鏡 override」）。
 *  - 外層帶進來的一律標 `INHERITED`，UI 才能顯示「移除本鏡 override」。
 */
export function resolveContextInheritance<T extends ContextBindingLike>(
  bindings: readonly T[],
): ResolvedContextEntry<T>[] {
  const byRole = new Map<ContextRole, T[]>();
  for (const binding of bindings) {
    byRole.set(binding.role, [...(byRole.get(binding.role) ?? []), binding]);
  }
  const out: ResolvedContextEntry<T>[] = [];
  for (const [role, items] of byRole) {
    const nearestRank = Math.max(...items.map((item) => contextScopeRank(item.scopeType)));
    if (isSingleValuedRole(role)) {
      for (const item of items.filter((candidate) => contextScopeRank(candidate.scopeType) === nearestRank)) {
        out.push({
          binding: item,
          effectiveSource: item.source,
          fromScope: item.scopeType,
        });
      }
      continue;
    }
    // 多值：同一份資源保留最靠近 Shot 的那筆
    const perResource = new Map<string, T>();
    for (const item of items) {
      const key = `${item.resourceKind}:${item.resourceId}`;
      const existing = perResource.get(key);
      if (!existing || contextScopeRank(item.scopeType) > contextScopeRank(existing.scopeType)) {
        perResource.set(key, item);
      }
    }
    for (const item of perResource.values()) {
      out.push({
        binding: item,
        effectiveSource: contextScopeRank(item.scopeType) < nearestRank ? "INHERITED" : item.source,
        fromScope: item.scopeType,
      });
    }
  }
  return rankResolvedContext(out);
}

/** 排序：靠近 Shot > PRIMARY > 使用者確認 > 信心值。決定 prompt 裡誰排前面。 */
export function rankResolvedContext<T extends ContextBindingLike>(
  entries: readonly ResolvedContextEntry<T>[],
): ResolvedContextEntry<T>[] {
  return [...entries].sort((left, right) => (
    contextScopeRank(right.fromScope) - contextScopeRank(left.fromScope)
    || contextPriorityRank(right.binding.priority) - contextPriorityRank(left.binding.priority)
    || contextSourceRank(right.effectiveSource) - contextSourceRank(left.effectiveSource)
    || (right.binding.confidence ?? 0) - (left.binding.confidence ?? 0)
  ));
}

/** 某個角色的主要參考（生圖時要優先送進 prompt 的那一份）。 */
export function primaryReferenceFor<T extends ContextBindingLike>(
  entries: readonly ResolvedContextEntry<T>[],
  role: ContextRole,
): ResolvedContextEntry<T> | null {
  return rankResolvedContext(entries.filter((entry) => entry.binding.role === role))[0] ?? null;
}

/* ────────────────────────── 檢索層級（§22） ────────────────────────── */

/**
 * Project AI 找資料的四層。**不要每次一上來就掃整個 Library**——
 * 先用已確認的 context，不夠再往外擴。
 */
export const CONTEXT_RETRIEVAL_LAYERS = [
  "user_confirmed",
  "scope_context",
  "ai_suggested",
  "global_retrieval",
] as const;
export type ContextRetrievalLayer = (typeof CONTEXT_RETRIEVAL_LAYERS)[number];

export const CONTEXT_RETRIEVAL_LAYER_LABEL: Record<ContextRetrievalLayer, string> = {
  user_confirmed: "使用者確認的資料",
  scope_context: "專案／場景／分鏡脈絡",
  ai_suggested: "AI 建議的相關資料",
  global_retrieval: "資料中心搜尋",
};

/** Context Resolver 的意圖——決定要哪些角色、以及要不要往第四層擴。 */
export const CONTEXT_INTENTS = [
  "assistant",
  "storyboard",
  "image",
  "video",
  "audio",
  "script",
] as const;
export type ContextIntent = (typeof CONTEXT_INTENTS)[number];

/**
 * 每種意圖優先要哪些角色。列在前面的先進預算。
 * 不在清單裡的角色不是被禁止，只是排在後面（`CONTEXT_ROLES` 的順序）。
 */
export const CONTEXT_INTENT_ROLES: Record<ContextIntent, readonly ContextRole[]> = {
  assistant: ["STORY_SOURCE", "SCRIPT_SOURCE", "WORLD_BUILDING", "RESEARCH", "CHARACTER_REFERENCE", "LOCATION_REFERENCE"],
  storyboard: ["SCRIPT_SOURCE", "CHARACTER_REFERENCE", "LOCATION_REFERENCE", "STYLE_REFERENCE", "VISUAL_REFERENCE", "STORY_SOURCE"],
  image: ["CHARACTER_REFERENCE", "LOCATION_REFERENCE", "STYLE_REFERENCE", "VISUAL_REFERENCE"],
  video: ["CHARACTER_REFERENCE", "LOCATION_REFERENCE", "STYLE_REFERENCE", "VISUAL_REFERENCE", "AUDIO_REFERENCE"],
  audio: ["AUDIO_REFERENCE", "SCRIPT_SOURCE", "STYLE_REFERENCE"],
  script: ["STORY_SOURCE", "SCRIPT_SOURCE", "WORLD_BUILDING", "CHARACTER_REFERENCE", "RESEARCH"],
};

export function contextRoleOrderFor(intent: ContextIntent): ContextRole[] {
  const preferred = CONTEXT_INTENT_ROLES[intent] ?? [];
  return [...preferred, ...CONTEXT_ROLES.filter((role) => !preferred.includes(role))];
}

/** 依 intent 的角色順序重排（同角色內仍用 rankResolvedContext 的規則）。 */
export function orderContextForIntent<T extends ContextBindingLike>(
  entries: readonly ResolvedContextEntry<T>[],
  intent: ContextIntent,
): ResolvedContextEntry<T>[] {
  const order = contextRoleOrderFor(intent);
  const weight = new Map(order.map((role, index) => [role, order.length - index]));
  return [...rankResolvedContext(entries)].sort((left, right) => (
    (weight.get(right.binding.role) ?? 0) - (weight.get(left.binding.role) ?? 0)
  ));
}
