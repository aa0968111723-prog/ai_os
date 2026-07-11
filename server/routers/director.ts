import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { worldviewSchema, type Worldview } from "../../shared/worldview";
import { isMockMode } from "../services/fal";
import { proxyFetch } from "../services/http";

export interface DirectorSuggestion {
  title: string;
  prompt: string;
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
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    const wv = worldviewSchema.parse(project.worldview ?? {});

    if (isMockMode()) return { suggestions: mockSuggestions(wv, project.kind), mock: true };

    const sys = `你是佛教基金會的影片導演助理。依專案背景給 3 個分鏡提示詞建議（繁體中文）。
專案：${project.title}（${project.kind}，${project.format}）
一句話故事：${wv.logline}｜關鍵訊息：${wv.message}｜調性：${wv.tones.join("、")}
禁忌：${wv.taboos.join("；")}
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
      const suggestions = match ? (JSON.parse(match[0]) as DirectorSuggestion[]) : mockSuggestions(wv, project.kind);
      return { suggestions: suggestions.slice(0, 3), mock: false };
    } catch {
      // LLM 失敗不擋創作：退回本地建議
      return { suggestions: mockSuggestions(wv, project.kind), mock: true };
    }
  }),
});
