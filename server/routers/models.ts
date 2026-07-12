import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import { CATEGORIES, MODELS, WORKFLOW_PRESETS, tierLabel, type ModelCategory, type ModelTier } from "../../shared/models";

const publicEntry = (m: (typeof MODELS)[number]) => ({
  id: m.id,
  label: m.label,
  category: m.category,
  tier: m.tier,
  tierLabel: tierLabel(m.tier),
  kind: m.kind,
  needs: m.needs ?? null,
  sourceHint: m.sourceHint ?? null,
  points: m.points,
  strengths: m.strengths,
  bestFor: m.bestFor,
  cost: m.cost,
  verified: m.verified,
});

/** 模型目錄查詢:給前端挑選器、模型指南頁與代理使用 */
export const modelsRouter = router({
  categories: authedProcedure.query(() => CATEGORIES),

  /** 依類別列出(旗艦→經濟→最低排序) */
  byCategory: authedProcedure
    .input(z.object({ category: z.string() }))
    .query(({ input }) => {
      const order: ModelTier[] = ["flagship", "economy", "budget"];
      return MODELS.filter((m) => m.category === (input.category as ModelCategory))
        .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))
        .map(publicEntry);
    }),

  /** 關鍵字/條件搜尋(代理建構時快速找模型) */
  search: authedProcedure
    .input(z.object({ q: z.string().optional(), category: z.string().optional(), tier: z.enum(["flagship", "economy", "budget"]).optional() }))
    .query(({ input }) => {
      const q = (input.q ?? "").toLowerCase();
      return MODELS.filter((m) => {
        if (input.category && m.category !== input.category) return false;
        if (input.tier && m.tier !== input.tier) return false;
        if (q && ![m.id, m.label, m.strengths, m.bestFor].some((s) => s.toLowerCase().includes(q))) return false;
        return true;
      }).map(publicEntry);
    }),

  workflows: authedProcedure.query(() =>
    WORKFLOW_PRESETS.map((w) => ({
      id: w.id,
      label: w.label,
      tier: w.tier,
      tierLabel: tierLabel(w.tier),
      points: w.points,
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
});
