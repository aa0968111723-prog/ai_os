/**
 * 有效模型解析：優先 model_live_catalog（即時價／Fal 新模型），否則 shared/models 靜態表。
 * 記憶體快取由 syncLiveModelCatalog / 開機 reload 刷新。
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  getModel as getStaticModel,
  estimatePoints as estimateStaticPoints,
  type EstimateContext,
  type ModelCategory,
  type ModelEntry,
  type ModelTier,
  type OutputKind,
  type SourceKind,
  MODELS,
} from "../../shared/models";

type LiveRow = typeof schema.modelLiveCatalog.$inferSelect;

let cache = new Map<string, ModelEntry>();
let cacheLoadedAt: number | null = null;

/** 新發現模型的通用 fal 輸入（未知 schema 時的保守預設） */
function genericInput(kind: OutputKind, category: string): ModelEntry["input"] {
  return (prompt, format, sourceUrl) => {
    const aspect = format === "9:16" ? "9:16" : format === "1:1" ? "1:1" : "16:9";
    if (kind === "video") {
      const body: Record<string, unknown> = { prompt, aspect_ratio: aspect };
      if (sourceUrl) body.image_url = sourceUrl;
      return body;
    }
    if (kind === "audio") {
      return sourceUrl ? { prompt, audio_url: sourceUrl } : { prompt, text: prompt };
    }
    if (kind === "text") {
      return sourceUrl ? { prompt, image_url: sourceUrl } : { prompt };
    }
    // image
    const body: Record<string, unknown> = { prompt, aspect_ratio: aspect };
    if (sourceUrl) body.image_url = sourceUrl;
    return body;
  };
}

function liveToEntry(row: LiveRow): ModelEntry {
  // 靜態目錄有完整 input()；live 只覆寫 points/cost 等計價欄
  const staticM = getStaticModel(row.id) ?? (row.endpoint !== row.id ? getStaticModel(row.endpoint) : undefined);
  if (staticM) {
    return {
      ...staticM,
      points: row.points,
      cost: row.cost,
      verified: row.verified,
      recommended: row.recommended || staticM.recommended,
      label: row.label || staticM.label,
    };
  }
  const kind = row.kind as OutputKind;
  const category = row.category as ModelCategory;
  return {
    id: row.id,
    endpoint: row.endpoint !== row.id ? row.endpoint : undefined,
    label: row.label,
    category,
    tier: row.tier as ModelTier,
    kind,
    needs: (row.needs as SourceKind | null) ?? undefined,
    points: row.points,
    strengths: row.strengths || row.label,
    bestFor: row.bestFor || "",
    cost: row.cost,
    verified: row.verified,
    recommended: row.recommended || undefined,
    input: genericInput(kind, category),
  };
}

/** 從 DB 重載 live 快取（同步完成後呼叫） */
export async function reloadLiveModelCache(): Promise<number> {
  try {
    const rows = await db
      .select()
      .from(schema.modelLiveCatalog)
      .where(eq(schema.modelLiveCatalog.available, true));
    const next = new Map<string, ModelEntry>();
    for (const r of rows) {
      next.set(r.id, liveToEntry(r));
      if (r.endpoint && r.endpoint !== r.id) next.set(r.endpoint, liveToEntry({ ...r, id: r.endpoint }));
    }
    cache = next;
    cacheLoadedAt = Date.now();
    return next.size;
  } catch (err) {
    // 表尚未 migrate 時不炸開機
    console.warn("[modelResolve] reload 快取失敗（可能尚未 migrate）：", err instanceof Error ? err.message : err);
    return 0;
  }
}

export function liveCacheMeta(): { size: number; loadedAt: number | null } {
  return { size: cache.size, loadedAt: cacheLoadedAt };
}

/**
 * 解析模型：live 快取 → 靜態 MODELS/LEGACY。
 * 生成／估點／UI 一律走這支，才能吃到即時價與新模型。
 */
export function resolveModel(id: string): ModelEntry | undefined {
  const live = cache.get(id);
  if (live) return live;
  return getStaticModel(id);
}

/** 列出可選模型（live 優先；無快取則靜態） */
export function listResolvableModels(filter?: {
  category?: string;
  tier?: ModelTier;
  q?: string;
}): ModelEntry[] {
  const base: ModelEntry[] = cache.size > 0 ? [...new Map([...cache].map(([, v]) => [v.id, v])).values()] : [...MODELS];
  const q = (filter?.q ?? "").toLowerCase();
  return base.filter((m) => {
    if (filter?.category && m.category !== filter.category) return false;
    if (filter?.tier && m.tier !== filter.tier) return false;
    if (q && ![m.id, m.label, m.strengths, m.bestFor].some((s) => s.toLowerCase().includes(q))) return false;
    return true;
  });
}

/** 估點：與 estimatePoints 相同，但 model 可為 live 覆寫後的 points */
export function estimatePointsFor(model: ModelEntry, ctx?: EstimateContext): number {
  // TTS 動態估點仍走 shared（依 cost 字串解析每千字）；live 覆寫後若 cost 變成即時價字串可能失去 TTS 動態——
  // 對 TTS 優先用靜態 model 的 estimate 邏輯：若靜態存在且為 tts，用靜態 entry 估。
  const staticM = getStaticModel(model.id);
  if (staticM && staticM.category === "text-to-speech") {
    return estimateStaticPoints(staticM, ctx);
  }
  return estimateStaticPoints(model, ctx);
}
