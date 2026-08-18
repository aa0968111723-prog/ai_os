/**
 * Context Resolver — 所有創作 AI 共用的**單一入口**。
 *
 * 在這之前，Assistant / Storyboard / Image / Video / Audio 各自重新發明「怎麼找資料」：
 * 有的讀 knowledge、有的讀 assets、有的做 hybrid search，彼此的權限與預算規則都不一樣。
 * 這個檔案把那件事收斂成一支函式：
 *
 *   resolveContext({ auth, projectId, sceneId?, shotId?, intent, budget? })
 *
 * ★ 不重建 RAG：第四層檢索直接呼叫既有的 `retrieveIntelligenceContext()`
 *   （它自己會寫 `intelligence_retrieval_runs` / `intelligence_retrieval_sources`）。
 *   這裡沒有第二套 vector search、沒有第二套 embedding、沒有第二套 retrieval log。
 *
 * ★ 四層檢索（§22），由內而外，**不是一上來就掃整個 Library**：
 *   1. user_confirmed  ——使用者親自確認的 context binding
 *   2. scope_context   ——Project / Scene / Shot 的其餘 binding（含繼承）
 *   3. ai_suggested    ——AI 建議、尚未確認的 binding
 *   4. global_retrieval——前三層不足時，才去 Intelligence Library 檢索
 *
 * ★ ACL：所有 binding 都經過 `listVisibleContextBindings()`（先解可見清單再取交集），
 *   第四層則沿用 `hybridSearchIntelligence` 既有的「先權限、後向量」順序。
 *   看不到的資料不會出現在 resolved context、prompt、答案或 source trace 裡。
 */
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { listVisibleContextBindings, type VisibleContextBinding } from "./contextBindings";
import { retrieveIntelligenceContext } from "./intelligenceLibrary";
import { worldviewSchema } from "../../shared/worldview";
import {
  orderContextForIntent,
  primaryReferenceFor,
  resolveContextInheritance,
  type ContextIntent,
  type ContextRole,
  type ContextScopeType,
  type ResolvedContextEntry,
} from "../../shared/projectContext";

export const CONTEXT_BUDGET_DEFAULT = 12_000;
const CONTEXT_BUDGET_MAX = 40_000;

/**
 * Saved `stories.content` for resolver `contextText` (〈專案脈絡〉).
 * The assistant only eats contextText — SELECT into `story` is not enough.
 */
export function formatResolvedStoryContextBlock(content: string | null | undefined): string | null {
  const text = content?.trim() ?? "";
  if (!text) return null;
  return `【你的故事】\n${text}`;
}

/** Studio / storyboard pageContext: entityType=shot → resolver shot scope. */
export function shotIdFromPageContext(
  pageContext?: { entityType?: string; entityId?: string } | null,
): string | undefined {
  if (pageContext?.entityType === "shot" && pageContext.entityId) return pageContext.entityId;
  return undefined;
}

export interface ResolveContextInput {
  auth: AuthState;
  projectId: string;
  sceneId?: string | null;
  shotId?: string | null;
  intent: ContextIntent;
  /** 額外的檢索查詢（例如使用者這一輪問的話）；沒有就用 scene / shot 的文字 */
  query?: string | null;
  budgetChars?: number;
  /**
   * 只用這幾筆 binding。**限制不是排序**：沒選的即使預算還有剩也不進，
   * 而且會關掉第四層全域檢索——使用者說「只用這幾份」，偷偷 fallback 等於用了他沒選的資料。
   */
  onlyBindingIds?: readonly string[];
  /** 預設 true；`onlyBindingIds` 有值時強制 false */
  allowGlobalRetrieval?: boolean;
  /** 是否納入尚未確認的 AI 建議（第三層）。預設 true，但一律標記 AI_SUGGESTED。 */
  includeSuggested?: boolean;
}

export interface ContextSourceRef {
  layer: "user_confirmed" | "scope_context" | "ai_suggested" | "global_retrieval";
  role: ContextRole | null;
  scopeType: ContextScopeType | null;
  priority: string | null;
  source: string;
  resourceKind: string;
  resourceId: string;
  intelligenceId: string | null;
  title: string;
  score: number | null;
}

export interface ResolvedProjectContext {
  project: { id: string; title: string; groupId: string; format: string | null };
  story: { content: string; truncated: boolean } | null;
  script: { sceneTitle: string | null; shotTitle: string | null; text: string } | null;
  characters: Array<{ id: string; name: string; appearance: string; referenceAssetId: string | null }>;
  people: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; palette: string; lighting: string | null; referenceAssetId: string | null }>;
  visualReferences: ContextReference[];
  audioReferences: ContextReference[];
  styleReferences: ContextReference[];
  characterReferences: ContextReference[];
  locationReferences: ContextReference[];
  documents: ContextReference[];
  relatedAssets: ContextReference[];
  /** 世界觀禁忌等硬規則——生成端必須遵守，不是參考 */
  rules: string[];
  continuity: { previousShot: ShotBrief | null; nextShot: ShotBrief | null };
  /** 送進 prompt 的文字（已套預算） */
  contextText: string;
  sources: ContextSourceRef[];
  retrievalTrace: {
    layers: Record<string, number>;
    retrievalRunId: string | null;
    retrievalDebug: Record<string, unknown>;
    budgetChars: number;
    includedChars: number;
    globalRetrievalSkippedReason: string | null;
  };
  /** 預算不足而截斷——誠實回報，不 silent truncate */
  truncated: boolean;
}

export interface ContextReference {
  bindingId: string | null;
  title: string;
  role: ContextRole;
  priority: string;
  source: string;
  scopeType: ContextScopeType | null;
  resourceKind: string;
  resourceId: string;
  intelligenceId: string | null;
  summary: string | null;
  confirmed: boolean;
}

interface ShotBrief {
  id: string;
  title: string;
  orderIndex: number;
  prompt: string | null;
  action: string | null;
}

function toReference(entry: ResolvedContextEntry<VisibleContextBinding>): ContextReference {
  return {
    bindingId: entry.binding.id,
    title: entry.binding.resource.title,
    role: entry.binding.role,
    priority: entry.binding.priority,
    source: entry.effectiveSource,
    scopeType: entry.fromScope,
    resourceKind: entry.binding.resourceKind,
    resourceId: entry.binding.resourceId,
    intelligenceId: entry.binding.intelligenceId,
    summary: entry.binding.resource.intelligence?.summary ?? null,
    confirmed: entry.binding.confirmedByUser,
  };
}

/**
 * 解析一個專案（可再指定場景／分鏡）的完整創作脈絡。
 *
 * 這支**不呼叫任何模型**。它只負責「把該給 AI 的東西找齊、排好、算好預算、留下軌跡」。
 */
export async function resolveContext(input: ResolveContextInput): Promise<ResolvedProjectContext> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(input.auth, project.groupId);

  const budgetChars = Math.min(CONTEXT_BUDGET_MAX, Math.max(1_000, input.budgetChars ?? CONTEXT_BUDGET_DEFAULT));
  const onlyIds = input.onlyBindingIds?.length ? new Set(input.onlyBindingIds) : null;
  const allowGlobal = onlyIds ? false : input.allowGlobalRetrieval !== false;
  const includeSuggested = input.includeSuggested !== false;

  // ── Shot / Scene 解析（shot 決定 scene；使用者只給 shotId 時不必再自己查） ──
  let shot: typeof schema.scenes.$inferSelect | null = null;
  if (input.shotId) {
    const [row] = await db.select().from(schema.scenes).where(and(
      eq(schema.scenes.id, input.shotId),
      eq(schema.scenes.projectId, project.id),
      isNull(schema.scenes.deletedAt),
    ));
    shot = row ?? null;
  }
  const sceneId = input.sceneId ?? shot?.storySceneId ?? null;
  const [scene] = sceneId
    ? await db.select().from(schema.storyScenes).where(and(
      eq(schema.storyScenes.id, sceneId),
      eq(schema.storyScenes.projectId, project.id),
    ))
    : [];

  const [bindings, story, characters, locations, people, siblings] = await Promise.all([
    listVisibleContextBindings({
      auth: input.auth,
      projectId: project.id,
      sceneId: scene?.id ?? null,
      shotId: shot?.id ?? null,
    }),
    db.select({ content: schema.stories.content }).from(schema.stories)
      .where(eq(schema.stories.projectId, project.id)).limit(1),
    db.select({
      id: schema.characters.id,
      name: schema.characters.name,
      appearance: schema.characters.appearance,
      referenceAssetId: schema.characters.referenceAssetId,
    }).from(schema.characters).where(eq(schema.characters.projectId, project.id)).limit(60),
    db.select({
      id: schema.scenePresets.id,
      name: schema.scenePresets.name,
      palette: schema.scenePresets.palette,
      lighting: schema.scenePresets.lighting,
      referenceAssetId: schema.scenePresets.referenceAssetId,
    }).from(schema.scenePresets).where(eq(schema.scenePresets.projectId, project.id)).limit(60),
    db.select({ id: schema.people.id, name: schema.people.name }).from(schema.people).where(and(
      eq(schema.people.groupId, project.groupId),
      ne(schema.people.status, "merged"),
    )).limit(60),
    shot ? db.select({
      id: schema.scenes.id,
      title: schema.scenes.title,
      orderIndex: schema.scenes.orderIndex,
      prompt: schema.scenes.prompt,
      action: schema.scenes.action,
    }).from(schema.scenes).where(and(
      eq(schema.scenes.projectId, project.id),
      isNull(schema.scenes.deletedAt),
    )).orderBy(asc(schema.scenes.orderIndex)) : Promise.resolve([]),
  ]);

  const scopedBindings = bindings.filter((binding) => {
    if (onlyIds) return onlyIds.has(binding.id);
    if (!includeSuggested && !binding.confirmedByUser) return false;
    return true;
  });
  const resolved = orderContextForIntent(resolveContextInheritance(scopedBindings), input.intent);

  const byRole = (role: ContextRole) => resolved.filter((entry) => entry.binding.role === role).map(toReference);

  // ── 連戲：前後鏡（Storyboard 要「上一鏡／下一鏡」才畫得出連續動作） ──
  const shotIndex = shot ? siblings.findIndex((candidate) => candidate.id === shot!.id) : -1;
  const continuity = {
    previousShot: shotIndex > 0 ? siblings[shotIndex - 1]! : null,
    nextShot: shotIndex >= 0 && shotIndex < siblings.length - 1 ? siblings[shotIndex + 1]! : null,
  };

  const worldview = worldviewSchema.parse(project.worldview ?? {});
  const scriptText = [
    scene?.title ? `【場景】${scene.title}` : "",
    scene?.summary ?? "",
    shot?.title ? `【分鏡】${shot.title}` : "",
    shot?.action ? `動作：${shot.action}` : "",
    shot?.dialogue ? `對白：\n${shot.dialogue}` : "",
    shot?.voiceover ? `旁白：${shot.voiceover}` : "",
  ].filter(Boolean).join("\n");

  /* ── 預算分配：先確認的、再脈絡的、最後才是全域檢索 ── */
  const sources: ContextSourceRef[] = [];
  const layers: Record<string, number> = {
    user_confirmed: 0, scope_context: 0, ai_suggested: 0, global_retrieval: 0,
  };
  const blocks: string[] = [];
  let used = 0;
  let truncated = false;

  const push = (text: string): boolean => {
    if (!text.trim()) return true;
    const remaining = budgetChars - used;
    if (remaining <= 0) { truncated = true; return false; }
    const slice = text.slice(0, remaining);
    if (slice.length < text.length) truncated = true;
    blocks.push(slice);
    used += slice.length;
    return slice.length === text.length;
  };

  push([
    `【專案】${project.title}`,
    worldview.logline ? `一句話故事：${worldview.logline}` : "",
    worldview.message ? `關鍵訊息：${worldview.message}` : "",
    worldview.tones.length ? `調性：${worldview.tones.join("、")}` : "",
    worldview.styles.length ? `風格：${worldview.styles.join("、")}` : "",
    worldview.taboos.length ? `禁忌：${worldview.taboos.join("、")}` : "",
  ].filter(Boolean).join("\n"));
  const storyBlock = formatResolvedStoryContextBlock(story[0]?.content);
  if (storyBlock) push(storyBlock);
  if (scriptText) push(`【腳本】\n${scriptText}`);

  for (const entry of resolved) {
    const layer = entry.binding.confirmedByUser
      ? "user_confirmed"
      : entry.effectiveSource === "AI_SUGGESTED" ? "ai_suggested" : "scope_context";
    layers[layer] = (layers[layer] ?? 0) + 1;
    sources.push({
      layer: layer as ContextSourceRef["layer"],
      role: entry.binding.role,
      scopeType: entry.fromScope,
      priority: entry.binding.priority,
      source: entry.effectiveSource,
      resourceKind: entry.binding.resourceKind,
      resourceId: entry.binding.resourceId,
      intelligenceId: entry.binding.intelligenceId,
      title: entry.binding.resource.title,
      score: entry.binding.confidence,
    });
    const summary = entry.binding.resource.intelligence?.summary
      ?? entry.binding.resource.intelligence?.category
      ?? entry.binding.resource.statusLabel;
    push(`[${entry.binding.role}｜${entry.binding.priority}｜${entry.fromScope}] ${entry.binding.resource.title}\n${summary}`);
  }

  /* ── 第四層：前三層還不夠時才去 Library 檢索（沿用既有 retrieval） ── */
  let retrievalRunId: string | null = null;
  let retrievalDebug: Record<string, unknown> = {};
  let globalRetrievalSkippedReason: string | null = null;
  const query = (input.query ?? scriptText ?? project.title).trim();
  if (!allowGlobal) {
    globalRetrievalSkippedReason = onlyIds
      ? "使用者限定了要用的資料，不做全域檢索"
      : "呼叫端關閉了全域檢索";
  } else if (used >= budgetChars) {
    globalRetrievalSkippedReason = "前三層已用完預算";
    truncated = true;
  } else if (!query) {
    globalRetrievalSkippedReason = "沒有可用的檢索查詢";
  } else {
    const retrieval = await retrieveIntelligenceContext(input.auth, {
      q: query.slice(0, 1_000),
      projectId: project.id,
      limit: 8,
      budgetChars: Math.max(1_000, Math.min(budgetChars - used, 8_000)),
    }).catch(() => null);
    if (!retrieval) {
      globalRetrievalSkippedReason = "檢索暫時不可用";
    } else {
      retrievalRunId = retrieval.retrievalRunId;
      retrievalDebug = retrieval.retrievalDebug;
      const alreadyBound = new Set(resolved.map((entry) => `${entry.binding.resourceKind}:${entry.binding.resourceId}`));
      for (const source of retrieval.sources) {
        if (alreadyBound.has(`${source.resourceKind}:${source.resourceId}`)) continue;
        layers.global_retrieval = (layers.global_retrieval ?? 0) + 1;
        sources.push({
          layer: "global_retrieval",
          role: null,
          scopeType: null,
          priority: null,
          source: "GLOBAL_RETRIEVAL",
          resourceKind: source.resourceKind,
          resourceId: source.resourceId,
          intelligenceId: source.intelligenceId,
          title: source.title,
          score: source.score,
        });
        if (!push(`[資料中心檢索｜${source.title}]\n${source.text}`)) break;
      }
    }
  }

  return {
    project: { id: project.id, title: project.title, groupId: project.groupId, format: project.format ?? null },
    story: story[0]?.content
      ? { content: story[0].content.slice(0, 4_000), truncated: story[0].content.length > 4_000 }
      : null,
    script: scene || shot ? { sceneTitle: scene?.title ?? null, shotTitle: shot?.title ?? null, text: scriptText } : null,
    characters,
    people,
    locations,
    characterReferences: byRole("CHARACTER_REFERENCE"),
    locationReferences: byRole("LOCATION_REFERENCE"),
    visualReferences: byRole("VISUAL_REFERENCE"),
    audioReferences: byRole("AUDIO_REFERENCE"),
    styleReferences: byRole("STYLE_REFERENCE"),
    documents: [...byRole("RESEARCH"), ...byRole("SCRIPT_SOURCE"), ...byRole("STORY_SOURCE"), ...byRole("WORLD_BUILDING")],
    relatedAssets: [...byRole("PRODUCTION_ASSET"), ...byRole("DELIVERY_ASSET")],
    rules: worldview.taboos,
    continuity,
    contextText: blocks.join("\n\n"),
    sources,
    retrievalTrace: {
      layers,
      retrievalRunId,
      retrievalDebug,
      budgetChars,
      includedChars: used,
      globalRetrievalSkippedReason,
    },
    truncated,
  };
}

/** 某個角色目前的主要參考——生圖／生影片要優先送進 prompt 的那一份。 */
export function primaryContextReference(
  context: ResolvedProjectContext,
  role: ContextRole,
): ContextReference | null {
  const pool = role === "CHARACTER_REFERENCE" ? context.characterReferences
    : role === "LOCATION_REFERENCE" ? context.locationReferences
      : role === "STYLE_REFERENCE" ? context.styleReferences
        : role === "AUDIO_REFERENCE" ? context.audioReferences
          : role === "VISUAL_REFERENCE" ? context.visualReferences
            : [];
  return pool.find((reference) => reference.priority === "PRIMARY") ?? pool[0] ?? null;
}

/**
 * 把一次 resolve 的結果落庫成可追溯的紀錄（§30）。
 * 「這張圖為什麼長這樣？」的答案就是這一列 + 它的 sources。
 */
export async function recordContextResolution(input: {
  context: ResolvedProjectContext;
  auth: AuthState;
  intent: ContextIntent;
  sceneId?: string | null;
  shotId?: string | null;
  /** 呼叫端補充的關聯（例如 generationId）——讓「這張圖為什麼長這樣」問得回來 */
  extraTrace?: Record<string, unknown>;
}): Promise<string | null> {
  const [row] = await db.insert(schema.contextResolutionRuns).values({
    groupId: input.context.project.groupId,
    projectId: input.context.project.id,
    sceneId: input.sceneId ?? null,
    shotId: input.shotId ?? null,
    userId: input.auth.user.id,
    intent: input.intent,
    retrievalRunId: input.context.retrievalTrace.retrievalRunId,
    bindingCount: input.context.sources.filter((source) => source.layer !== "global_retrieval").length,
    retrievedCount: input.context.sources.filter((source) => source.layer === "global_retrieval").length,
    truncated: input.context.truncated,
    budgetChars: input.context.retrievalTrace.budgetChars,
    includedChars: input.context.retrievalTrace.includedChars,
    trace: {
      ...(input.extraTrace ?? {}),
      layers: input.context.retrievalTrace.layers,
      sources: input.context.sources.slice(0, 60),
      globalRetrievalSkippedReason: input.context.retrievalTrace.globalRetrievalSkippedReason,
    },
  }).returning({ id: schema.contextResolutionRuns.id });
  return row?.id ?? null;
}

/* ────────────────────────── AI 自動推薦專案資料（§23） ────────────────────────── */

export interface ContextSuggestion {
  resourceKind: string;
  resourceId: string;
  intelligenceId: string | null;
  title: string;
  role: ContextRole;
  score: number;
  reason: string;
  category: string | null;
}

const ROLE_BY_CANONICAL_TYPE: Record<string, ContextRole> = {
  IMAGE: "VISUAL_REFERENCE",
  VIDEO: "VISUAL_REFERENCE",
  AUDIO: "AUDIO_REFERENCE",
  DOCUMENT: "RESEARCH",
  TEXT: "RESEARCH",
  PRESENTATION: "RESEARCH",
  WEB: "RESEARCH",
};

/**
 * 用專案既有的故事／腳本／角色／場景，去 Library 找可能相關的資料。
 *
 * ★ 完全建立在既有能力上：hybrid search（含 entity 與 relationship 分數）＋ entity graph。
 *   沒有第二套推薦引擎。
 * ★ 結果一律是 **AI 建議**，不會自動變成使用者確認的 context（§23 / §36）。
 */
export async function suggestProjectContext(input: {
  auth: AuthState;
  projectId: string;
  limit?: number;
}): Promise<{ suggestions: ContextSuggestion[]; queries: string[] }> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(input.auth, project.groupId);

  const [story, characters, locations, shots, bound] = await Promise.all([
    db.select({ content: schema.stories.content }).from(schema.stories)
      .where(eq(schema.stories.projectId, project.id)).limit(1),
    db.select({ name: schema.characters.name }).from(schema.characters)
      .where(eq(schema.characters.projectId, project.id)).limit(30),
    db.select({ name: schema.scenePresets.name }).from(schema.scenePresets)
      .where(eq(schema.scenePresets.projectId, project.id)).limit(30),
    db.select({ title: schema.scenes.title, action: schema.scenes.action })
      .from(schema.scenes).where(and(
        eq(schema.scenes.projectId, project.id),
        isNull(schema.scenes.deletedAt),
      )).orderBy(asc(schema.scenes.orderIndex)).limit(40),
    db.select({
      resourceKind: schema.contextBindings.resourceKind,
      resourceId: schema.contextBindings.resourceId,
    }).from(schema.contextBindings).where(eq(schema.contextBindings.projectId, project.id)),
  ]);

  const worldview = worldviewSchema.parse(project.worldview ?? {});
  const queries = [...new Set([
    project.title,
    worldview.logline,
    ...characters.map((character) => character.name),
    ...locations.map((location) => location.name),
    ...shots.slice(0, 8).map((shot) => [shot.title, shot.action].filter(Boolean).join(" ")),
    (story[0]?.content ?? "").slice(0, 200),
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value && value.length >= 2)))]
    .slice(0, 10);

  const alreadyBound = new Set(bound.map((binding) => `${binding.resourceKind}:${binding.resourceId}`));
  const best = new Map<string, ContextSuggestion>();
  const { hybridSearchIntelligence } = await import("./intelligenceLibrary");
  for (const query of queries) {
    const search = await hybridSearchIntelligence(input.auth, { q: query, limit: 20 }).catch(() => null);
    if (!search) continue;
    for (const result of search.results) {
      const key = `${result.resource.kind}:${result.resource.rawId}`;
      if (alreadyBound.has(key)) continue;
      // 已經屬於本專案的素材不算「建議加入」——它本來就在
      if (result.resource.projectId === project.id) continue;
      const canonicalType = result.intelligence?.canonicalType ?? "OTHER";
      const suggestion: ContextSuggestion = {
        resourceKind: result.resource.kind,
        resourceId: result.resource.rawId,
        intelligenceId: result.intelligence?.id ?? null,
        title: result.resource.title,
        role: ROLE_BY_CANONICAL_TYPE[canonicalType] ?? "RESEARCH",
        score: result.score,
        reason: `與「${query}」相關`,
        category: result.intelligence?.category ?? null,
      };
      const existing = best.get(key);
      if (!existing || existing.score < suggestion.score) best.set(key, suggestion);
    }
  }

  // 人物有名字對得上時，角色改標成人物參考——這是 entity graph 已經知道的事
  const characterNames = new Set(characters.map((character) => character.name));
  const locationNames = new Set(locations.map((location) => location.name));
  for (const suggestion of best.values()) {
    if (suggestion.role !== "VISUAL_REFERENCE") continue;
    const matchedCharacter = [...characterNames].some((name) => name.length >= 2 && suggestion.title.includes(name));
    const matchedLocation = [...locationNames].some((name) => name.length >= 2 && suggestion.title.includes(name));
    if (matchedCharacter) suggestion.role = "CHARACTER_REFERENCE";
    else if (matchedLocation) suggestion.role = "LOCATION_REFERENCE";
  }

  return {
    suggestions: [...best.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(100, Math.max(1, input.limit ?? 40))),
    queries,
  };
}

/** 這個專案目前有多少筆 AI 建議還沒被處理（專案資料頁的「AI 建議 32」）。 */
export async function countPendingContextSuggestions(projectId: string): Promise<number> {
  const rows = await db.select({ id: schema.contextBindings.id }).from(schema.contextBindings).where(and(
    eq(schema.contextBindings.projectId, projectId),
    eq(schema.contextBindings.confirmedByUser, false),
  ));
  return rows.length;
}

/** 給 Asset Inspector 用：把 binding 反查成「被哪些 scope 用到」。 */
export async function contextUsageForResources(input: {
  auth: AuthState;
  resources: readonly { kind: string; id: string }[];
}): Promise<Map<string, Array<{ projectId: string; projectTitle: string; scopeType: string; scopeId: string; role: string; priority: string }>>> {
  const groupIds = [...new Set(input.auth.groups.map((group) => group.groupId))];
  if (!groupIds.length || !input.resources.length) return new Map();
  const projects = await db.select({ id: schema.projects.id, title: schema.projects.title })
    .from(schema.projects).where(inArray(schema.projects.groupId, groupIds));
  const projectById = new Map(projects.map((project) => [project.id, project.title]));
  const rows = await db.select().from(schema.contextBindings).where(and(
    inArray(schema.contextBindings.resourceId, [...new Set(input.resources.map((resource) => resource.id))]),
    inArray(schema.contextBindings.projectId, projects.map((project) => project.id)),
  )).orderBy(desc(schema.contextBindings.updatedAt)).limit(500);
  const wanted = new Set(input.resources.map((resource) => `${resource.kind}:${resource.id}`));
  const out = new Map<string, Array<{ projectId: string; projectTitle: string; scopeType: string; scopeId: string; role: string; priority: string }>>();
  for (const row of rows) {
    const key = `${row.resourceKind}:${row.resourceId}`;
    if (!wanted.has(key)) continue;
    out.set(key, [...(out.get(key) ?? []), {
      projectId: row.projectId,
      projectTitle: projectById.get(row.projectId) ?? "",
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      role: row.role,
      priority: row.priority,
    }]);
  }
  return out;
}

export { primaryReferenceFor };
