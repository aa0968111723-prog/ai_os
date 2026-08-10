/**
 * 有效模型解析：優先 model_live_catalog（即時價／Fal 新模型），否則 shared/models 靜態表。
 * 記憶體快取由 syncLiveModelCatalog / 開機 reload 刷新。
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  getModel as getStaticModel,
  estimatePoints as estimateStaticPoints,
  nearestFormat,
  realPricePoints,
  type EstimateContext,
  type ModelCategory,
  type ModelEntry,
  type ModelTier,
  type OutputKind,
  type SourceKind,
  MODELS,
} from "../../shared/models";
import { unitPlausibleForKind, usdUnitToPoints } from "../../shared/money";

type LiveRow = typeof schema.modelLiveCatalog.$inferSelect;

let cache = new Map<string, ModelEntry>();
let cacheLoadedAt: number | null = null;

/** 新發現模型的通用 fal 輸入（未知 schema 時的保守預設） */
function genericInput(kind: OutputKind, category: string): ModelEntry["input"] {
  return (prompt, format, sourceUrl) => {
    // 未知 schema 的新模型只敢送最普遍支援的三種比例，其餘就近取一（避免 21:9 之類被 API 退件）
    const aspect = nearestFormat(format, ["16:9", "9:16", "1:1"]);
    if (kind === "video") {
      const body: Record<string, unknown> = { prompt, aspect_ratio: aspect };
      if (sourceUrl) body[category === "video-to-video" ? "video_url" : "image_url"] = sourceUrl;
      return body;
    }
    if (kind === "audio") {
      return sourceUrl ? { prompt, audio_url: sourceUrl } : { prompt, text: prompt };
    }
    if (kind === "text") {
      if (!sourceUrl) return { prompt };
      if (category === "speech-to-text") return { prompt, audio_url: sourceUrl };
      if (category === "training") return { prompt, images_data_url: sourceUrl };
      return { prompt, image_url: sourceUrl };
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
    // live 計價單位與靜態種類不相容（Fal 佔位值／誤配）→ 保留靜態官方實價，不覆寫
    //（row.costUsd/row.costUnit 的 null check 直接寫在 ternary 條件裡讓 TS 收窄——不能先抽成 boolean，TS 不傳播）
    // 守門二：live 點數與官方實價（機械解析 cost 字串）偏差 ≥40% → 佔位／誤配價
    //（如 flux-3 draft 官方 $0.06/秒=9 點、live 卻 $0.2/秒→31 點），保留靜態官方實價。
    const official = realPricePoints(staticM);
    const driftBlocked = official != null && official > 0 && staticM.points > 0
      && Math.abs(row.points - staticM.points) >= 1
      && (row.points >= staticM.points * 1.4 || row.points <= staticM.points / 1.4);
    const livePrice =
      row.costUsd != null && row.costUnit != null && unitPlausibleForKind(row.costUnit, staticM.kind) && !driftBlocked
        ? { points: row.points, cost: row.cost, priceUsd: row.costUsd, priceUnit: row.costUnit }
        : null;
    return {
      ...staticM,
      points: livePrice ? livePrice.points : staticM.points,
      cost: livePrice ? livePrice.cost : staticM.cost,
      verified: row.verified,
      recommended: row.recommended || staticM.recommended,
      label: row.label || staticM.label,
      priceUsd: livePrice?.priceUsd,
      priceUnit: livePrice?.priceUnit,
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
    priceUsd: row.costUsd ?? undefined,
    priceUnit: row.costUnit ?? undefined,
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
  // 即時單價優先；character 單位會依本次朗讀字數換算，避免 TTS 又退回可能已過期的靜態價。
  // 單位與輸出種類語意不相容（Fal 佔位值，如影片被標 token/image）→ 退回靜態官方實價。
  if (model.priceUsd != null && model.priceUnit && unitPlausibleForKind(model.priceUnit, model.kind)) {
    const livePoints = usdUnitToPoints(model.priceUsd, model.priceUnit, {
      kindHint: model.kind,
      promptChars: ctx?.promptChars,
      usdToTwdRate: ctx?.usdToTwdRate,
    });
    // 守門二（縱深）：live 換算點數與官方實價（機械解析 cost）偏差 ≥40% → 佔位／誤配價，退回靜態。
    // 正常路徑由 liveToEntry 在解析時就先擋掉（priceUsd 留空）；此處是兜底，避免任何直接帶
    // priceUsd/priceUnit 的入口把官方實價估歪。
    const staticM = getStaticModel(model.id);
    if (staticM) {
      const official = realPricePoints(staticM);
      if (official != null && official > 0 && staticM.points > 0
          && Math.abs(livePoints - staticM.points) >= 1
          && (livePoints >= staticM.points * 1.4 || livePoints <= staticM.points / 1.4)) {
        return estimateStaticPoints(staticM, ctx);
      }
    }
    return livePoints;
  }
  return estimateStaticPoints(model, ctx);
}
