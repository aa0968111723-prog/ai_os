import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { worldviewSchema, type Worldview } from "../../shared/worldview";
import { isMockMode } from "../services/fal";
import { proxyFetch } from "../services/http";
import { reserveQuota, refund } from "../services/points";
import { buildKnowledgeContext } from "./knowledge";

export interface DirectorSuggestion {
  title: string;
  prompt: string;
}

/** LLM 回傳的執行期驗證：JSON.parse 成功但形狀不對（title 是物件、缺欄位）一樣會弄崩前端，必須 safeParse */
const suggestionSchema = z
  .array(z.object({ title: z.string().min(1).max(100), prompt: z.string().min(1).max(2000) }))
  .min(1);

/** 真模式每次建議固定入帳 1 點：付費 LLM 呼叫不能是不入帳、不受總預算守門的免費後門 */
const DIRECTOR_COST_POINTS = 1;

// 記憶體節流：每使用者每分鐘最多 6 次——擋連點/腳本狂刷付費 LLM。
// 單容器部署，程序內 Map 即足夠；重啟歸零無妨（額度守門仍由 reserveQuota 兜底）。
const SUGGEST_LIMIT_PER_MINUTE = 6;
const SUGGEST_WINDOW_MS = 60_000;
const suggestHits = new Map<string, number[]>();
function overSuggestLimit(userId: string): boolean {
  const now = Date.now();
  const hits = (suggestHits.get(userId) ?? []).filter((t) => now - t < SUGGEST_WINDOW_MS);
  const over = hits.length >= SUGGEST_LIMIT_PER_MINUTE;
  if (!over) hits.push(now); // 被擋的請求不計入窗口，一分鐘後自然解封
  suggestHits.set(userId, hits);
  return over;
}

/** 假模式：依世界觀組出三個確定性建議（不花錢可測） */
function mockSuggestions(wv: Worldview, kind: string): DirectorSuggestion[] {
  const tone = wv.tones[0] ?? "莊嚴";
  const theme = wv.themes[0] ?? "禪修日常";
  const base = wv.logline || "本專案主題";
  return [
    { title: "開場・氛圍鏡", prompt: `${base}的開場：清晨禪堂空景，${tone}氛圍，柔和晨光斜射，留白構圖` },
    { title: "主軸・轉化鏡", prompt: `呼應「${theme}」：主角靜坐側影，光由暗轉亮，象徵內心轉化，${tone}調性` },
    { title: "收尾・訊息鏡", prompt: `收尾畫面：${wv.message || "把心交給佛"}——蓮花與柔光意象，字卡預留空間` },
  ];
}

/**
 * AI 導演建議（定案：引用/建議僅供參考，成品須組長審核）。
 * 假模式回確定性建議；真模式走 fal any-llm（同一把 FAL 金鑰，不接其他供應商）。
 */
export const directorRouter = router({
  suggest: authedProcedure.input(z.object({ projectId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    // 節流放最前面：超限直接回友善訊息，連 DB 都不打，狂刷時零成本
    if (overSuggestLimit(ctx.auth.user.id)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "建議請求太頻繁（每分鐘最多 6 次），休息一下再試" });
    }
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    const wv = worldviewSchema.parse(project.worldview ?? {});

    // 知識庫：把開示稿/見證稿/腳本全文注入——這就是「真的懂我們素材」，夥伴不必重講背景
    const knowledge = await buildKnowledgeContext(project.id);

    if (isMockMode()) return { suggestions: mockSuggestions(wv, project.kind), mock: true, usedKnowledge: !!knowledge };

    // 真模式先原子入帳（重用 reserveQuota：同時受週額度與總預算守門），失敗路徑再退
    const quotaError = await reserveQuota(ctx.auth.user.id, project.groupId, DIRECTOR_COST_POINTS, "AI 導演建議");
    if (quotaError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: quotaError });

    const sys = `你是佛教基金會的影片導演助理。依專案背景與素材給 3 個分鏡提示詞建議（繁體中文）。
專案：${project.title}（${project.kind}，${project.format}）
一句話故事：${wv.logline}｜關鍵訊息：${wv.message}｜調性：${wv.tones.join("、")}
禁忌：${wv.taboos.join("；")}
${knowledge ? `\n【專案素材（開示／見證／腳本，請據此發想，忠於原意）】\n${knowledge}\n` : ""}
只回 JSON 陣列：[{"title":"...","prompt":"..."}] 共 3 筆，prompt 為可直接用於圖像/影片生成的場景描述。`;
    try {
      const res = await proxyFetch("https://fal.run/fal-ai/any-llm", {
        method: "POST",
        headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-flash-1.5", prompt: sys }),
      });
      if (!res.ok) throw new Error(`any-llm ${res.status}`);
      const data = (await res.json()) as { output?: string };
      const match = data.output?.match(/\[[\s\S]*\]/);
      const parsed = match ? suggestionSchema.safeParse(JSON.parse(match[0])) : null;
      // 形狀不符：LLM 已實際計費故不退點，但回固定格式的本地建議並標記 mock，前端不會拿到壞資料
      if (!parsed?.success) return { suggestions: mockSuggestions(wv, project.kind), mock: true, usedKnowledge: !!knowledge };
      return { suggestions: parsed.data.slice(0, 3), mock: false, usedKnowledge: !!knowledge };
    } catch {
      // LLM 呼叫失敗（HTTP 錯誤/逾時/回傳非 JSON）：退點且不擋創作，退回本地建議
      await refund(ctx.auth.user.id, project.groupId, DIRECTOR_COST_POINTS, "AI 導演建議失敗退回");
      return { suggestions: mockSuggestions(wv, project.kind), mock: true, usedKnowledge: !!knowledge };
    }
  }),
});
