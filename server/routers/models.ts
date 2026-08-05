import { z } from "zod";
import { router, authedProcedure, adminProcedure } from "../trpc";
import { CATEGORIES, WORKFLOW_PRESETS, tierLabel, type ModelEntry, type ModelTier } from "../../shared/models";
import { estimatePointsFor, listResolvableModels, liveCacheMeta, resolveModel } from "../services/modelResolve";
import { liveCatalogStatus, syncLiveModelCatalog } from "../services/modelLiveSync";
import { pointsToTwd, POINTS_TO_TWD } from "../../shared/money";
import { getUsdToTwd } from "../services/fxRate";
import { getModelContract, loadModelContractSnapshot } from "../services/modelContractStore";
import { getModelThumbnailUrl } from "../services/modelThumbnailStore";

const publicEntry = (m: ModelEntry, usdToTwdRate: number) => {
  const points = estimatePointsFor(m, { usdToTwdRate });
  const contract = getModelContract(m.id);
  return {
  id: m.id,
  label: m.label,
  category: m.category,
  tier: m.tier,
  tierLabel: tierLabel(m.tier),
  kind: m.kind,
  needs: m.needs ?? null,
  sourceHint: m.sourceHint ?? null,
  secondaryNeeds: m.secondaryNeeds ?? null,
  secondarySourceHint: m.secondarySourceHint ?? null,
  points,
  /** 帳面新台幣（1 點 ≈ NT$1） */
  estTwd: pointsToTwd(points),
  /** 帳面美元（對照 Fal） */
  estUsd: Math.round((points / usdToTwdRate) * 10000) / 10000,
  usdToTwdRate,
  strengths: m.strengths,
  bestFor: m.bestFor,
  cost: m.cost,
  verified: m.verified,
  recommended: m.recommended ?? false,
  /** 契約健康（docs/model-audit/contracts；無檔時 null） */
  health: contract?.health ?? null,
  healthNote: contract?.healthNote ?? null,
  textEncoderLabel: contract?.capabilities.textEncoderLabel ?? null,
  textEncoderLimit: contract?.capabilities.textEncoderLimit ?? null,
  supportsNegativePrompt: contract?.capabilities.supportsNegativePrompt ?? null,
  supportsSeed: contract?.capabilities.supportsSeed ?? null,
  tokenMeasurable: contract?.capabilities.tokenMeasurable ?? null,
  /** Fal 官方模型縮圖（https）；無則 null，前端用類別占位 */
  thumbnailUrl: getModelThumbnailUrl(m.id),
  };
};

/** 模型目錄查詢:給前端挑選器、模型指南頁與代理使用（含即時價／新發現） */
export const modelsRouter = router({
  categories: authedProcedure.query(() => CATEGORIES),

  /** 匯率與估價說明（挑選器／指南頁顯示新台幣用） */
  moneyMeta: authedProcedure.query(async () => {
    const fx = await getUsdToTwd();
    return {
      usdToTwd: fx.rate,
      pointToTwd: POINTS_TO_TWD,
      fxSource: fx.source,
      fetchedAt: fx.fetchedAt,
      fxNote: `1 點＝NT$${POINTS_TO_TWD}；US$1＝NT$${fx.rate}（${fx.source === "live" ? "即時匯率" : "後備匯率"}）`,
      live: liveCacheMeta(),
    };
  }),

  /** 依類別列出：已驗證／推薦優先，再依旗艦→經濟→最低；資料源＝live 快取∪靜態 */
  byCategory: authedProcedure
    .input(z.object({ category: z.string() }))
    .query(async ({ input }) => {
      const fx = await getUsdToTwd();
      const order: ModelTier[] = ["flagship", "economy", "budget"];
      return listResolvableModels({ category: input.category })
        .map((m) => publicEntry(m, fx.rate))
        .sort((a, b) => {
          const ha = a.health === "live_ok" ? 1 : a.health === "openapi_404" ? -1 : 0;
          const hb = b.health === "live_ok" ? 1 : b.health === "openapi_404" ? -1 : 0;
          if (ha !== hb) return hb - ha;
          if (a.verified !== b.verified) return a.verified ? -1 : 1;
          if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
          const tierDiff = order.indexOf(a.tier) - order.indexOf(b.tier);
          if (tierDiff !== 0) return tierDiff;
          if (a.points !== b.points) return a.points - b.points;
          return a.id.localeCompare(b.id);
        });
    }),

  /** 關鍵字/條件搜尋(代理建構時快速找模型) */
  search: authedProcedure
    .input(z.object({
      q: z.string().optional(),
      category: z.string().optional(),
      tier: z.enum(["flagship", "economy", "budget"]).optional(),
      /** 契約健康篩選（live_ok / needs_source / openapi_404…） */
      health: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const fx = await getUsdToTwd();
      return listResolvableModels({
        q: input.q,
        category: input.category,
        tier: input.tier,
      })
        .map((m) => publicEntry(m, fx.rate))
        .filter((m) => !input.health || m.health === input.health)
        .sort((a, b) => {
          // 實測成功優先，再 verified／推薦／點數
          const ha = a.health === "live_ok" ? 1 : a.health === "openapi_404" ? -1 : 0;
          const hb = b.health === "live_ok" ? 1 : b.health === "openapi_404" ? -1 : 0;
          if (ha !== hb) return hb - ha;
          if (a.verified !== b.verified) return a.verified ? -1 : 1;
          if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
          if (a.points !== b.points) return a.points - b.points;
          return a.id.localeCompare(b.id);
        });
    }),

  /** 單筆（含 live 點數） */
  get: authedProcedure
    .input(z.object({ id: z.string().min(1).max(300) }))
    .query(async ({ input }) => {
      const fx = await getUsdToTwd();
      const m = resolveModel(input.id);
      return m ? publicEntry(m, fx.rate) : null;
    }),

  /**
   * 契約健康總覽（模型指南頂欄）：counts + 每 id 的精簡 health。
   * 無 contracts/current.json 時回 null（指南降級、不阻斷）。
   */
  contractSummary: authedProcedure.query(() => {
    const snap = loadModelContractSnapshot();
    if (!snap) return null;
    const byId: Record<string, {
      health: string;
      healthNote: string;
      textEncoderLabel: string;
      textEncoderLimit: number | null;
      supportsNegativePrompt: boolean;
      supportsSeed: boolean;
      thumbnailUrl: string | null;
    }> = {};
    for (const m of snap.models) {
      byId[m.id] = {
        health: m.health,
        healthNote: m.healthNote,
        textEncoderLabel: m.capabilities.textEncoderLabel,
        textEncoderLimit: m.capabilities.textEncoderLimit,
        supportsNegativePrompt: m.capabilities.supportsNegativePrompt,
        supportsSeed: m.capabilities.supportsSeed,
        thumbnailUrl: getModelThumbnailUrl(m.id),
      };
    }
    return {
      generatedAt: snap.generatedAt,
      modelCount: snap.modelCount,
      counts: snap.counts,
      softStopNote: snap.softStopNote,
      byId,
    };
  }),

  workflows: authedProcedure.query(() =>
    WORKFLOW_PRESETS.map((w) => ({
      id: w.id,
      label: w.label,
      tier: w.tier,
      tierLabel: tierLabel(w.tier),
      points: w.points,
      estTwd: pointsToTwd(w.points),
      strengths: w.strengths,
      bestFor: w.bestFor,
      steps: w.steps.map((s) => ({
        modelId: s.modelId,
        note: s.note,
        promptTemplate: s.promptTemplate,
        usePrevAsSource: s.usePrevAsSource ?? false,
      })),
    })),
  ),

  /** 即時目錄狀態（開發者／團隊管理） */
  liveStatus: adminProcedure.query(async () => liveCatalogStatus()),

  /**
   * 一鍵同步：Fal 即時價格 + 新模型自動上架。
   * 需 FAL_KEY；可能需 30–90 秒（多頁 discover）。
   */
  syncLive: adminProcedure
    .input(z.object({ discoverPages: z.number().int().min(0).max(10).optional() }).optional())
    .mutation(async ({ input }) => syncLiveModelCatalog({ discoverPages: input?.discoverPages })),
});
