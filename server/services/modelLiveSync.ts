/**
 * 即時模型價格同步 + 新模型自動上架。
 *
 * 流程：
 * 1. 以 shared/models MODELS 為靜態基底寫入 model_live_catalog（source=static）
 * 2. 向 Fal Platform 拉 pricing，覆寫 points／cost／estTwd（NT$）
 * 3. 分頁掃 Fal models，不在靜態目錄者 → source=fal_discovered、verified=false 自動可選
 * 4. 同步精簡列到 model_catalog 供代理 SQL 查
 *
 * 無 FAL_KEY／E2E_MOCK：只灌靜態目錄，不呼叫外網。
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import {
  MODELS,
  WORKFLOW_PRESETS,
  endpointOf,
  realPricePoints,
  type ModelCategory,
  type ModelEntry,
  type ModelTier,
  type OutputKind,
  type SourceKind,
} from "../../shared/models";
import { pointsToTwd, unitPlausibleForKind, usdUnitToPoints } from "../../shared/money";
import { fetchFalModels, fetchFalPricing, type FalPricingUnit } from "./falPlatform";

/** 影片估點秒數（與 audit-model-pricing 預設對齊） */
const VIDEO_SECONDS = Number(process.env.LIVE_PRICE_VIDEO_SECONDS ?? 5);
/** 對嘴／分級處理估 1 分鐘 */
const V2V_MINUTES = Number(process.env.LIVE_PRICE_V2V_MINUTES ?? 1);

export type LiveSyncResult = {
  staticUpserted: number;
  priced: number;
  discovered: number;
  certifiedFromHistory: number;
  unavailable: number;
  errors: string[];
  /** 靜態實價 vs Fal 即時價偏差 ≥40% 的模型（cost 字串過期鬧鐘；實扣已用即時價，不影響收費正確性） */
  driftWarnings: string[];
  fetchedAt: string;
};

function costLabel(p: FalPricingUnit): string {
  return `$${p.price}/${p.unit}（Fal 即時價；估點用量見單位）`;
}

/** 單價 USD + 單位 → 帳面點數（≥1） */
export function pricingToPoints(p: FalPricingUnit, kindHint?: OutputKind | string): number {
  return usdUnitToPoints(p.price, p.unit, {
    videoSeconds: VIDEO_SECONDS,
    v2vMinutes: V2V_MINUTES,
    kindHint: String(kindHint ?? ""),
  });
}

function mapFalCategory(raw: string | null, tags: string[], endpointId: string): {
  category: ModelCategory | "workflow";
  kind: OutputKind;
  tier: ModelTier;
  needs: SourceKind | null;
} {
  const blob = `${raw ?? ""} ${tags.join(" ")} ${endpointId}`.toLowerCase();
  let category: ModelCategory = "text-to-image";
  let kind: OutputKind = "image";
  let needs: SourceKind | null = null;
  if (/video-to-video|v2v|lipsync|upscale.*video|restyle/.test(blob)) {
    category = "video-to-video";
    kind = "video";
    needs = "video";
  } else if (/image-to-video|i2v|img2vid/.test(blob)) {
    category = "image-to-video";
    kind = "video";
    needs = "image";
  } else if (/text-to-video|t2v|video/.test(blob) && !/image/.test(blob)) {
    category = "text-to-video";
    kind = "video";
  } else if (/image-to-image|i2i|edit|inpaint|kontext/.test(blob)) {
    category = "image-to-image";
    kind = "image";
    needs = "image";
  } else if (/speech-to-text|whisper|transcri|asr/.test(blob)) {
    category = "speech-to-text";
    kind = "text";
    needs = "audio";
  } else if (/text-to-speech|tts|voice/.test(blob)) {
    category = "text-to-speech";
    kind = "audio";
  } else if (/music|sound|audio|sfx/.test(blob) && !/speech|tts|voice/.test(blob)) {
    category = "text-to-audio";
    kind = "audio";
  } else if (/llm|language|chat|any-llm/.test(blob)) {
    category = "llm";
    kind = "text";
  } else if (/vision|describe|caption/.test(blob)) {
    category = "vision";
    kind = "text";
    needs = "image";
  } else if (/train|lora|finetun/.test(blob)) {
    category = "training";
    kind = "text";
    needs = "zip";
  } else if (/text-to-image|t2i|flux|sdxl|imagen|seedream|ideogram/.test(blob)) {
    category = "text-to-image";
    kind = "image";
  }
  // 新發現預設經濟；高單價稍後由 pricing 改 tier
  return { category, kind, tier: "economy", needs };
}

function tierFromPoints(points: number): ModelTier {
  if (points >= 20) return "flagship";
  if (points >= 5) return "economy";
  return "budget";
}

type LiveRow = typeof schema.modelLiveCatalog.$inferInsert;

function staticToLive(m: ModelEntry): LiveRow {
  const points = m.points;
  return {
    id: m.id,
    endpoint: endpointOf(m),
    label: m.label,
    category: m.category,
    tier: m.tier,
    kind: m.kind,
    needs: m.needs ?? null,
    source: "static",
    points,
    pointsStatic: m.points,
    cost: m.cost,
    costUsd: null,
    costUnit: null,
    estTwd: pointsToTwd(points),
    strengths: m.strengths,
    bestFor: m.bestFor,
    verified: m.verified,
    recommended: m.recommended ?? false,
    available: true,
    rawPricing: null,
    fetchedAt: null,
    updatedAt: new Date(),
  };
}

/** 批次 upsert live 列 */
async function upsertLiveRows(rows: LiveRow[]): Promise<void> {
  if (!rows.length) return;
  // drizzle onConflictDoUpdate 逐批
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    await db
      .insert(schema.modelLiveCatalog)
      .values(batch)
      .onConflictDoUpdate({
        target: schema.modelLiveCatalog.id,
        set: {
          endpoint: sql`excluded.endpoint`,
          label: sql`excluded.label`,
          category: sql`excluded.category`,
          tier: sql`excluded.tier`,
          kind: sql`excluded.kind`,
          needs: sql`excluded.needs`,
          source: sql`excluded.source`,
          points: sql`excluded.points`,
          pointsStatic: sql`excluded.points_static`,
          cost: sql`excluded.cost`,
          costUsd: sql`excluded.cost_usd`,
          costUnit: sql`excluded.cost_unit`,
          estTwd: sql`excluded.est_twd`,
          strengths: sql`excluded.strengths`,
          bestFor: sql`excluded.best_for`,
          // A real successful Fal run is stronger evidence than a static
          // catalog flag. Never downgrade that evidence on later syncs.
          verified: sql`${schema.modelLiveCatalog.verified} or excluded.verified`,
          recommended: sql`excluded.recommended`,
          available: sql`excluded.available`,
          rawPricing: sql`excluded.raw_pricing`,
          fetchedAt: sql`excluded.fetched_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

/** 把 live 同步到代理用的 model_catalog（精簡） */
async function mirrorToModelCatalog(): Promise<void> {
  const live = await db
    .select()
    .from(schema.modelLiveCatalog)
    .where(eq(schema.modelLiveCatalog.available, true));
  const workflows = WORKFLOW_PRESETS.map((w) => ({
    id: w.id,
    endpoint: "internal/workflow",
    category: "workflow",
    tier: w.tier,
    kind: "text" as const,
    needs: null as string | null,
    points: w.points,
    strengths: w.strengths,
    bestFor: w.bestFor,
    cost: `${w.steps.length} 步合計約 ${w.points} 點`,
    verified: true,
    updatedAt: new Date(),
  }));
  const rows = [
    ...live.map((m) => ({
      id: m.id,
      endpoint: m.endpoint,
      category: m.category,
      tier: m.tier,
      kind: m.kind,
      needs: m.needs,
      points: m.points,
      strengths: m.strengths || m.label,
      bestFor: m.bestFor || (m.source === "fal_discovered" ? "Fal 新發現（未驗證）" : m.bestFor),
      cost: m.cost,
      verified: m.verified,
      updatedAt: new Date(),
    })),
    ...workflows,
  ];
  await db.delete(schema.modelCatalog);
  if (rows.length) await db.insert(schema.modelCatalog).values(rows);
}

/**
 * 完整同步：靜態灌入 → 即時價 → 發現新模型 → mirror catalog。
 * discoverPages：掃幾頁 Fal models（每頁 ~50）；0＝不發現新模型。
 */
export async function syncLiveModelCatalog(opts: { discoverPages?: number } = {}): Promise<LiveSyncResult> {
  const errors: string[] = [];
  const fetchedAt = new Date();
  const discoverPages = opts.discoverPages ?? Number(process.env.LIVE_MODEL_DISCOVER_PAGES ?? 3);

  // 1) 靜態基底
  const staticRows = MODELS.map(staticToLive);
  await upsertLiveRows(staticRows);

  let priced = 0;
  let discovered = 0;
  let unavailable = 0;

  const canCallFal = process.env.E2E_MOCK !== "1" && !!process.env.FAL_KEY;
  if (!canCallFal) {
    let certifiedFromHistory = 0;
    try {
      const { certifyModelsFromHistory } = await import("./modelCertification");
      const certification = await certifyModelsFromHistory({ reloadCache: false });
      certifiedFromHistory = certification.newlyCertified;
    } catch (err) {
      errors.push(`歷史模型認證回補失敗：${err instanceof Error ? err.message : String(err)}`);
    }
    await mirrorToModelCatalog();
    // 重新載入記憶體快取
    const { reloadLiveModelCache } = await import("./modelResolve");
    await reloadLiveModelCache();
    return {
      staticUpserted: staticRows.length,
      priced: 0,
      discovered: 0,
      certifiedFromHistory,
      unavailable: 0,
      errors: [...errors, "未設定 FAL_KEY 或 E2E_MOCK=1：僅同步靜態目錄"],
      driftWarnings: [],
      fetchedAt: fetchedAt.toISOString(),
    };
  }

  // 2) 靜態 endpoint 即時價
  const driftWarnings: string[] = [];
  try {
    const endpoints = MODELS.map((m) => endpointOf(m));
    const pricing = await fetchFalPricing(endpoints);
    const updates: LiveRow[] = [];
    for (const m of MODELS) {
      const ep = endpointOf(m);
      const p = pricing.get(ep) ?? pricing.get(m.id);
      if (!p) continue;
      // Fal 回傳單位與模型輸出種類不相容（新端點的佔位值／解析誤配）→ 保留靜態官方實價，
      // 不把 Wan 2.7 16 點、FLUX.3 draft 9 點 覆寫成 $0.03/image→1 點 或 $1/token→32180 點。
      if (!unitPlausibleForKind(p.unit, m.kind)) {
        driftWarnings.push(`${m.id}: Fal 計價單位 ${p.unit} 與 ${m.kind} 不相容（佔位值？），保留靜態官方價 ${m.points} 點`);
        continue;
      }
      const points = pricingToPoints(p, m.kind);
      // 守門二：官方實價可機械解析（realPricePoints）且 live 點數偏差 ≥40% → 疑似 fal 佔位／誤配價
      //（如 flux-3 draft 官方 $0.06/秒=9 點，fal 卻回 $0.2/秒→31 點）——保留靜態官方價、記 drift 警告，
      //  不覆寫。回歸旁證 `q=flash` 多支影片模型估 32 點＝此類系統性覆寫。
      const officialPoints = realPricePoints(m);
      if (officialPoints != null && officialPoints > 0 && m.points > 0
          && Math.abs(points - m.points) >= 1
          && (points >= m.points * 1.4 || points <= m.points / 1.4)) {
        driftWarnings.push(`${m.id}: Fal 即時 ${points} 點（$${p.price}/${p.unit}）與官方實價 ${officialPoints} 點偏差 ≥40%（佔位/誤配價？），保留靜態官方價 ${m.points} 點`);
        continue;
      }
      // 漂移鬧鐘：實扣走即時價（本 updates 覆寫），但靜態 cost 字串若已偏差 ≥40% 且 ≥1 點，
      // 代表目錄記載價過期——顯示（無 key 環境）與文件會失真，提醒回頭修 cost 字串。
      // （守門二已處理官方實價可解析者；此處涵蓋靜態無機械價的模型。）
      if (m.points > 0 && Math.abs(points - m.points) >= 1) {
        const ratio = points / m.points;
        if (ratio >= 1.4 || ratio <= 1 / 1.4) {
          driftWarnings.push(`${m.id}: 靜態 ${m.points} 點 vs 即時 ${points} 點（$${p.price}/${p.unit}）——請更新 cost 字串`);
        }
      }
      updates.push({
        ...staticToLive(m),
        points,
        cost: costLabel(p),
        costUsd: p.price,
        costUnit: p.unit,
        estTwd: pointsToTwd(points),
        tier: m.tier, // 保留人工級別
        rawPricing: p,
        fetchedAt,
        updatedAt: fetchedAt,
      });
      priced++;
    }
    await upsertLiveRows(updates);
  } catch (err) {
    errors.push(`靜態模型定價失敗：${err instanceof Error ? err.message : String(err)}`);
  }

  // 3) 發現新模型
  if (discoverPages > 0) {
    try {
      const known = new Set(MODELS.map((m) => m.id));
      for (const m of MODELS) known.add(endpointOf(m));
      let cursor: string | null = null;
      const candidates: { endpointId: string; title: string; category: string | null; description: string | null; tags: string[] }[] = [];
      for (let page = 0; page < discoverPages; page++) {
        const { models, nextCursor } = await fetchFalModels({ limit: 50, cursor });
        for (const m of models) {
          if (known.has(m.endpointId)) continue;
          known.add(m.endpointId);
          candidates.push(m);
        }
        if (!nextCursor) break;
        cursor = nextCursor;
      }

      // 拉新模型價格
      const priceMap = await fetchFalPricing(candidates.map((c) => c.endpointId));
      const discRows: LiveRow[] = [];
      for (const c of candidates) {
        const mapped = mapFalCategory(c.category, c.tags, c.endpointId);
        const p = priceMap.get(c.endpointId);
        // 守門：Fal 計價單位與輸出種類不相容（新影片/圖端點被標 token/image 等佔位價）→ 不採即時價，
        // 等同「無價」保守 2 點，避免 $1/token→32180 點 這類佔位點數寫進目錄並在 UI 顯示。
        const usableP = p != null && unitPlausibleForKind(p.unit, mapped.kind) ? p : null;
        const points = usableP ? pricingToPoints(usableP, mapped.kind) : 2; // 無價或佔位價時保守 2 點
        const tier = usableP ? tierFromPoints(points) : mapped.tier;
        discRows.push({
          id: c.endpointId,
          endpoint: c.endpointId,
          label: c.title,
          category: mapped.category,
          tier,
          kind: mapped.kind,
          needs: mapped.needs,
          source: "fal_discovered",
          points,
          pointsStatic: null,
          cost: usableP ? costLabel(usableP) : "Fal 計價單位異常（暫 2 點）",
          costUsd: usableP?.price ?? null,
          costUnit: usableP?.unit ?? null,
          estTwd: pointsToTwd(points),
          strengths: c.description?.slice(0, 240) || "Fal 平台新模型（自動上架，未人工驗證）",
          bestFor: "探索新能力；正式交付請優先用已驗證模型",
          verified: false,
          recommended: false,
          available: true,
          rawPricing: p ?? null,
          fetchedAt,
          updatedAt: fetchedAt,
          createdAt: fetchedAt,
        });
      }
      await upsertLiveRows(discRows);
      discovered = discRows.length;

      // 標記：本輪既有 discovered 但不在 candidates 且久未抓價的不自動下架（保守）
    } catch (err) {
      errors.push(`新模型發現失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let certifiedFromHistory = 0;
  try {
    const { certifyModelsFromHistory } = await import("./modelCertification");
    const certification = await certifyModelsFromHistory({ reloadCache: false });
    certifiedFromHistory = certification.newlyCertified;
  } catch (err) {
    errors.push(`歷史模型認證回補失敗：${err instanceof Error ? err.message : String(err)}`);
  }

  await mirrorToModelCatalog();
  const { reloadLiveModelCache } = await import("./modelResolve");
  await reloadLiveModelCache();

  console.log(
    `[modelLive] 同步完成：靜態 ${staticRows.length}、即時價 ${priced}、新發現 ${discovered}` +
      (errors.length ? `、警告 ${errors.length}` : "") +
      (driftWarnings.length ? `、價格漂移 ${driftWarnings.length}` : ""),
  );
  for (const w of driftWarnings) console.warn(`[modelLive] 價格漂移：${w}`);

  return {
    staticUpserted: staticRows.length,
    priced,
    discovered,
    certifiedFromHistory,
    unavailable,
    errors,
    driftWarnings,
    fetchedAt: fetchedAt.toISOString(),
  };
}

/** 讀取同步狀態摘要（管理頁） */
export async function liveCatalogStatus(): Promise<{
  total: number;
  staticCount: number;
  discoveredCount: number;
  verifiedCount: number;
  unverifiedCount: number;
  lastFetchedAt: string | null;
  sample: Array<{ id: string; label: string; points: number; estTwd: number; source: string; cost: string; verified: boolean }>;
}> {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      staticCount: sql<number>`sum(case when ${schema.modelLiveCatalog.source} = 'static' then 1 else 0 end)::int`,
      discoveredCount: sql<number>`sum(case when ${schema.modelLiveCatalog.source} = 'fal_discovered' then 1 else 0 end)::int`,
      verifiedCount: sql<number>`sum(case when ${schema.modelLiveCatalog.verified} then 1 else 0 end)::int`,
      unverifiedCount: sql<number>`sum(case when not ${schema.modelLiveCatalog.verified} then 1 else 0 end)::int`,
      lastFetchedAt: sql<string | null>`max(${schema.modelLiveCatalog.fetchedAt})::text`,
    })
    .from(schema.modelLiveCatalog)
    .where(eq(schema.modelLiveCatalog.available, true));

  const sample = await db
    .select({
      id: schema.modelLiveCatalog.id,
      label: schema.modelLiveCatalog.label,
      points: schema.modelLiveCatalog.points,
      estTwd: schema.modelLiveCatalog.estTwd,
      source: schema.modelLiveCatalog.source,
      cost: schema.modelLiveCatalog.cost,
      verified: schema.modelLiveCatalog.verified,
    })
    .from(schema.modelLiveCatalog)
    .where(and(eq(schema.modelLiveCatalog.available, true), inArray(schema.modelLiveCatalog.source, ["static", "fal_discovered"])))
    .orderBy(sql`${schema.modelLiveCatalog.fetchedAt} desc nulls last`)
    .limit(8);

  return {
    total: Number(counts?.total ?? 0),
    staticCount: Number(counts?.staticCount ?? 0),
    discoveredCount: Number(counts?.discoveredCount ?? 0),
    verifiedCount: Number(counts?.verifiedCount ?? 0),
    unverifiedCount: Number(counts?.unverifiedCount ?? 0),
    lastFetchedAt: counts?.lastFetchedAt ?? null,
    sample,
  };
}
