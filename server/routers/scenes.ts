import { z } from "zod";
import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { executeGenerationCommand } from "../services/generationCommand";
import { getModel } from "../../shared/models";
import { lockSceneOrder } from "../services/locks";
import { assertProjectEditable, assertProjectNotArchived } from "../services/projectAcl";

/**
 * forEdit（需求 2.3 專案級權限）：分鏡的所有「寫入」mutation 走 forEdit=true——
 * 專案檢視者（viewer）唯讀；讀取（listByProject）不變。單一守門點，避免逐 mutation 漏掛。
 */
async function getProjectChecked(ctx: { auth: NonNullable<import("../trpc").Context["auth"]> }, projectId: string, forEdit = false) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(ctx.auth, project.groupId);
  if (forEdit) await assertProjectEditable(ctx.auth, project);
  return project;
}

/** 分鏡：簡易排序（↑↓）＋從生成成品加入（定案：不做拖曳時間軸） */
export const scenesRouter = router({
  listByProject: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await getProjectChecked(ctx, input.projectId);
    // 旁白音檔另用一次別名 join（與主畫面 assetId 的 join 分開，避免同表兩次 join 撞名）
    const narrationAssets = aliasedTable(schema.assets, "narration_assets");
    const rows = await db
      .select({
        id: schema.scenes.id,
        title: schema.scenes.title,
        orderIndex: schema.scenes.orderIndex,
        durationSec: schema.scenes.durationSec,
        status: schema.scenes.status,
        assetId: schema.scenes.assetId,
        prompt: schema.scenes.prompt,
        voiceover: schema.scenes.voiceover,
        assetUrl: schema.assets.url,
        assetKind: schema.assets.kind,
        // 逐鏡配音音檔網址（該格已生成的旁白）：前端播放用
        narrationUrl: narrationAssets.url,
        // 來源生成 id：前端「已加入分鏡」用穩定鍵比對（assetUrl 會在成品落地時被改寫，比 URL 會誤判）
        generationId: sql<string | null>`${schema.assets.meta} ->> 'generationId'`,
        // 該格是否有進行中的就地生成（草稿→出圖進度指示）。用純量子查詢而非 join，避免同格多筆
        // 進行中生成把分鏡列乘開成重複列；兩個子查詢用相同排序取同一筆，pendingGenId 與 status 一致。
        // 只看「畫面(visual)」生成——排除 narration，否則配音生成中會誤把主畫面標成生成中、鎖住重生鈕
        pendingGenStatus: sql<"queued" | "running" | null>`(
          select g.status from ${schema.generations} g
          where g.scene_id = ${schema.scenes.id} and (g.scene_role is null or g.scene_role = 'visual') and g.status in ('queued', 'running')
          order by g.created_at desc, g.id desc limit 1
        )`,
        pendingGenId: sql<string | null>`(
          select g.id from ${schema.generations} g
          where g.scene_id = ${schema.scenes.id} and (g.scene_role is null or g.scene_role = 'visual') and g.status in ('queued', 'running')
          order by g.created_at desc, g.id desc limit 1
        )`,
        // 該格是否有進行中的「配音」生成（配音生成中指示）：獨立於主畫面生成，只看 narration 角色。
        pendingVoiceStatus: sql<"queued" | "running" | null>`(
          select g.status from ${schema.generations} g
          where g.scene_id = ${schema.scenes.id} and g.scene_role = 'narration' and g.status in ('queued', 'running')
          order by g.created_at desc, g.id desc limit 1
        )`,
      })
      .from(schema.scenes)
      // JOIN 也要排除軟刪素材：deleteAsset 刻意保留 scenes.assetId（供還原），若 join 不濾 deletedAt，
      // 該格會繼續顯示已刪素材的縮圖/音檔——與交付包（exporter 已濾）不一致。還原後 join 自動重連。
      .leftJoin(schema.assets, and(eq(schema.scenes.assetId, schema.assets.id), isNull(schema.assets.deletedAt)))
      .leftJoin(narrationAssets, and(eq(schema.scenes.narrationAssetId, narrationAssets.id), isNull(narrationAssets.deletedAt)))
      // 排除已軟刪除（回收桶）的分鏡——漏掉這個過濾會讓刪掉的分鏡繼續出現在列表
      .where(and(eq(schema.scenes.projectId, input.projectId), isNull(schema.scenes.deletedAt)))
      .orderBy(asc(schema.scenes.orderIndex));
    return rows;
  }),

  /** 把一筆完成的生成加入分鏡（成品 → 敘事的橋） */
  addFromGeneration: authedProcedure
    .input(z.object({ generationId: z.string().uuid(), title: z.string().min(1).max(60).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.generationId));
      if (!gen || gen.status !== "done" || !gen.resultUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "生成尚未完成" });
      requireGroup(ctx.auth, gen.groupId);
      // 2.3：專案檢視者不能把成品加入分鏡（內容寫入）
      await assertProjectEditable(ctx.auth, { id: gen.projectId, groupId: gen.groupId });
      const [asset] = await db
        .select()
        .from(schema.assets)
        .where(sql`${schema.assets.meta} ->> 'generationId' = ${gen.id}`);
      // 交易＋per-project advisory lock：與拆分鏡/新增分鏡共用同一把序號鎖,
      // 併發「讀 max→插入」不再算到同一個 max 而寫出重複 orderIndex
      return db.transaction(async (tx) => {
        await lockSceneOrder(tx, gen.projectId);
        const [{ maxOrder }] = await tx
          .select({ maxOrder: sql<number>`coalesce(max(${schema.scenes.orderIndex}), 0)` })
          .from(schema.scenes)
          // 已軟刪除的分鏡不算進最大 orderIndex（否則新格會被推到刪除格之後留洞）
          .where(and(eq(schema.scenes.projectId, gen.projectId), isNull(schema.scenes.deletedAt)));
        const [scene] = await tx
          .insert(schema.scenes)
          .values({
            projectId: gen.projectId,
            orderIndex: Number(maxOrder) + 1,
            title: input.title ?? gen.prompt.slice(0, 30),
            durationSec: gen.kind === "video" ? 5 : 3,
            status: "review",
            assetId: asset?.id,
            prompt: gen.prompt, // 帶入原生成提示詞，讓「加入分鏡」的格子日後也能就地重生
          })
          .returning();
        return scene;
      });
    }),

  /**
   * 直接建一格草稿分鏡（工作台深度整合：AI 導演建議「存成分鏡」直落③）：
   * 帶建議提示詞的空白格，之後可就地生成。插入走與拆分鏡相同的交易＋per-project 序號鎖。
   */
  addDraft: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        title: z.string().min(1).max(60),
        prompt: z.string().max(2000).optional(),
        voiceover: z.string().max(500).optional(),
        durationSec: z.number().int().min(1).max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectChecked(ctx, input.projectId, true);
      return db.transaction(async (tx) => {
        await lockSceneOrder(tx, project.id);
        const [{ maxOrder }] = await tx
          .select({ maxOrder: sql<number>`coalesce(max(${schema.scenes.orderIndex}), 0)` })
          .from(schema.scenes)
          .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)));
        const [scene] = await tx
          .insert(schema.scenes)
          .values({
            projectId: project.id,
            orderIndex: Number(maxOrder) + 1,
            title: input.title,
            durationSec: input.durationSec ?? (project.format === "9:16" ? 4 : 5),
            status: "todo",
            prompt: input.prompt,
            voiceover: input.voiceover,
          })
          .returning();
        return scene;
      });
    }),

  /**
   * 版本回看（需求 #4）：把某筆「已完成」生成的成品設為分鏡現用——
   * 同一鏡歷來生成過的版本都留在生成紀錄，這裡一鍵切回任何一版（音訊成品切旁白、圖/影切主畫面）。
   */
  setVisualFromGeneration: authedProcedure
    .input(z.object({ sceneId: z.string().uuid(), generationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡（可能已刪除）" });
      await getProjectChecked(ctx, scene.projectId, true);
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.generationId));
      if (!gen || gen.status !== "done") throw new TRPCError({ code: "BAD_REQUEST", message: "生成尚未完成，無法設為現用" });
      // 生成與分鏡必須同專案（requireGroup 已由 getProjectChecked 保證組隔離；這裡再擋跨專案誤指）
      if (gen.projectId !== scene.projectId) throw new TRPCError({ code: "FORBIDDEN", message: "這筆生成不屬於此專案" });
      // 找該生成入庫的素材（比照 addFromGeneration 的 meta->>generationId；排除已回收，取最新一筆）
      const [asset] = await db
        .select()
        .from(schema.assets)
        .where(and(sql`${schema.assets.meta} ->> 'generationId' = ${gen.id}`, isNull(schema.assets.deletedAt)))
        .orderBy(desc(schema.assets.createdAt))
        .limit(1);
      if (!asset) throw new TRPCError({ code: "BAD_REQUEST", message: "此生成沒有可用素材（文字輸出、或素材已在回收桶）" });
      // 音訊成品＝旁白；圖/影＝主畫面（與 advanceGeneration 回填的角色判斷一致）
      const patch = asset.kind === "audio" ? { narrationAssetId: asset.id } : { assetId: asset.id };
      const [updated] = await db.update(schema.scenes).set(patch).where(eq(schema.scenes.id, scene.id)).returning();
      return updated;
    }),

  /** ↑↓ 移動（與相鄰分鏡交換順序） */
  move: authedProcedure
    .input(z.object({ sceneId: z.string().uuid(), direction: z.enum(["up", "down"]) }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
      await getProjectChecked(ctx, scene.projectId, true);
      // 交易＋序號鎖：兩個併發 move（雙擊↑↓／兩人同時排）各自「讀清單→互換」會用過期的
      // orderIndex 交換出重複值；上鎖後讀與寫成對序列化,兩筆 update 也不再有半套(只換到一邊)
      return db.transaction(async (tx) => {
        await lockSceneOrder(tx, scene.projectId);
        const all = await tx
          .select()
          .from(schema.scenes)
          // 只在未刪除的分鏡之間換序——含已刪除格會算錯相鄰、把 orderIndex 交換給隱形格
          .where(and(eq(schema.scenes.projectId, scene.projectId), isNull(schema.scenes.deletedAt)))
          .orderBy(asc(schema.scenes.orderIndex));
        const idx = all.findIndex((s) => s.id === scene.id);
        // 以鎖內重讀的列為準（入口讀到的 scene 可能已被並發 move 換位）
        const cur = all[idx];
        const swapWith = input.direction === "up" ? all[idx - 1] : all[idx + 1];
        if (!cur || !swapWith) return { ok: true }; // 已在頂/底（或已被並發刪除）
        await tx.update(schema.scenes).set({ orderIndex: swapWith.orderIndex }).where(eq(schema.scenes.id, cur.id));
        await tx.update(schema.scenes).set({ orderIndex: cur.orderIndex }).where(eq(schema.scenes.id, swapWith.id));
        return { ok: true };
      });
    }),

  /** 刪除分鏡＝軟刪除（回收桶）：保留使用者手打的 prompt／voiceover，可從回收桶還原 */
  remove: authedProcedure.input(z.object({ sceneId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [scene] = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
    if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
    await getProjectChecked(ctx, scene.projectId, true); // 2.3：檢視者不能刪分鏡
    await db.update(schema.scenes).set({ deletedAt: new Date() }).where(eq(schema.scenes.id, input.sceneId));
    return { ok: true };
  }),

  /** 還原分鏡（回收桶 → 分鏡列）：清掉 deletedAt，接回原本引用的素材 */
  restore: authedProcedure.input(z.object({ sceneId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, input.sceneId));
    if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
    await getProjectChecked(ctx, scene.projectId, true); // 2.3：檢視者不能還原分鏡
    // 修 R3-BINV-01：還原時把 orderIndex 重排到尾端，別沿用被刪當下的舊序號——否則與現有分鏡撞出
    // 重複 orderIndex，破壞排序唯一性（move/reorder 交換失準）。交易＋lockSceneOrder 序列化同專案建格。
    await db.transaction(async (tx) => {
      await lockSceneOrder(tx, scene.projectId);
      const [{ maxOrder }] = await tx
        .select({ maxOrder: sql<number>`coalesce(max(${schema.scenes.orderIndex}), -1)` })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.projectId, scene.projectId), isNull(schema.scenes.deletedAt)));
      await tx.update(schema.scenes).set({ deletedAt: null, orderIndex: Number(maxOrder) + 1 }).where(eq(schema.scenes.id, input.sceneId));
    });
    return { ok: true };
  }),

  /** 永久刪除分鏡（回收桶內「永久刪除」）：真的 db.delete，不可復原 */
  purge: authedProcedure.input(z.object({ sceneId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, input.sceneId));
    if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
    await getProjectChecked(ctx, scene.projectId, true); // 2.3：檢視者不能永久刪除分鏡（不可回復）
    await db.delete(schema.scenes).where(eq(schema.scenes.id, input.sceneId));
    return { ok: true };
  }),

  /** 就地編輯分鏡欄位（標題／秒數／旁白）：只更新有帶的欄位 */
  update: authedProcedure
    .input(
      z.object({
        sceneId: z.string().uuid(),
        title: z.string().min(1).max(60).optional(),
        durationSec: z.number().int().min(1).max(60).optional(),
        voiceover: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
      await getProjectChecked(ctx, scene.projectId, true);
      const patch: Partial<typeof schema.scenes.$inferInsert> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.durationSec !== undefined) patch.durationSec = input.durationSec;
      if (input.voiceover !== undefined) patch.voiceover = input.voiceover;
      if (Object.keys(patch).length === 0) return scene; // 無欄位可更，回原狀
      const [updated] = await db.update(schema.scenes).set(patch).where(eq(schema.scenes.id, input.sceneId)).returning();
      return updated;
    }),

  /** 就地生成：以該分鏡的 prompt 送出生成並綁定該格，完成後由 advanceGeneration 回填 assetId（草稿→出圖一條線） */
  generateInto: authedProcedure
    .input(z.object({
      sceneId: z.string().uuid(),
      modelId: z.string(),
      prompt: z.string().optional(),
      /** 冪等鍵：timeout 重送同鍵回原列，不重複扣點 */
      clientRequestId: z.string().uuid().optional(),
      /** 生成台勾選的角色/場景卡：就地生成也注入同一套錨點——否則逐鏡出圖與生成台出圖畫風/角色不一致 */
      characterIds: z.array(z.string().uuid()).max(6).optional(),
      scenePresetIds: z.array(z.string().uuid()).max(4).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
      const project = await getProjectChecked(ctx, scene.projectId, true);
      assertProjectNotArchived(project); // 封存專案不接受付費生成
      const prompt = input.prompt ?? scene.prompt ?? "";
      if (!prompt.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "這一格還沒有生成提示詞，請先填寫或改用生成台" });
      // 伺服器端防抖：這一格已有進行中的「畫面」生成就擋下——本鈕直接扣點、無二次確認，快速雙擊會重複送出、
      // 重複扣點。以「進行中(queued/running)＋同格＋visual 角色」查有無在跑（catch 常見雙擊；非強一致鎖）。
      const [pendingVisual] = await db
        .select({ id: schema.generations.id })
        .from(schema.generations)
        .where(and(
          eq(schema.generations.sceneId, scene.id),
          sql`(${schema.generations.sceneRole} is null or ${schema.generations.sceneRole} = 'visual')`,
          inArray(schema.generations.status, ["queued", "running"]),
        ))
        .limit(1);
      if (pendingVisual) throw new TRPCError({ code: "CONFLICT", message: "這一格正在生成中，請稍候再生成" });
      // TD-02：分鏡就地生成走 Command（政策＋狀態機＋ACL＋扣點）
      const gen = await executeGenerationCommand({
        auth: ctx.auth,
        source: "web",
        id: input.clientRequestId, // 冪等鍵：timeout 重送同鍵回原列，不重複扣點
        projectId: scene.projectId,
        modelId: input.modelId,
        prompt,
        sceneId: scene.id,
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
        reasonPrefix: "分鏡生成",
      });
      return { generationId: gen.id };
    }),

  /** 逐鏡配音：以該分鏡的 voiceover 當提示詞送 TTS，綁 narration 角色，完成後回填 narrationAssetId */
  generateVoiceover: authedProcedure
    .input(z.object({ sceneId: z.string().uuid(), modelId: z.string().optional(), clientRequestId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
      const project = await getProjectChecked(ctx, scene.projectId, true);
      assertProjectNotArchived(project); // 封存專案不接受付費生成
      const prompt = scene.voiceover ?? "";
      if (!prompt.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "這一格還沒有配音詞，請先在分鏡裡填" });
      // 只放行「文字轉語音(TTS)」類：text-to-audio（配樂/音效）雖同為 kind=audio，但會生出音樂而非旁白，
      // 混入 narration 槽＝扣點又拿到錯內容，故以 category 精確把關（不能只看 kind）。
      const modelId = input.modelId ?? "fal-ai/kokoro/mandarin-chinese";
      const model = getModel(modelId);
      if (!model || model.category !== "text-to-speech") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "配音需要用語音（TTS）模型" });
      }
      // 伺服器端防抖：同格已有進行中的「配音」生成就擋下，避免快速雙擊重複送出、重複扣點（本鈕直接扣點無二次確認）
      const [pendingVoice] = await db
        .select({ id: schema.generations.id })
        .from(schema.generations)
        .where(and(
          eq(schema.generations.sceneId, scene.id),
          eq(schema.generations.sceneRole, "narration"),
          inArray(schema.generations.status, ["queued", "running"]),
        ))
        .limit(1);
      if (pendingVoice) throw new TRPCError({ code: "CONFLICT", message: "這一格正在生成配音，請稍候" });
      // TD-02：配音生成走 Command
      const gen = await executeGenerationCommand({
        auth: ctx.auth,
        source: "web",
        id: input.clientRequestId, // 冪等鍵：timeout 重送同鍵回原列，不重複扣點
        projectId: scene.projectId,
        modelId,
        prompt,
        sceneId: scene.id,
        sceneRole: "narration",
        reasonPrefix: "配音生成",
      });
      return { generationId: gen.id };
    }),

  /** 拖曳排序：依前端給的順序逐筆寫 orderIndex（保留既有 move ↑↓，不衝突） */
  reorder: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      await getProjectChecked(ctx, input.projectId, true);
      // 交易＋序號鎖：逐筆寫 orderIndex 與其他建格/move 序列化——否則拖曳中另一人拆分鏡,
      // 新格會拿到與重排結果重疊的序號;交易也保證重排不留半套
      // 重複 id 直接拒絕：重複代表前端狀態已壞，寫入會產生跳號/覆蓋，不能默默吞掉
      if (new Set(input.orderedIds).size !== input.orderedIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "排序清單有重複的分鏡，請重新整理後再拖曳" });
      }
      return db.transaction(async (tx) => {
        await lockSceneOrder(tx, input.projectId);
        // 只允許重排本專案「未刪除」的分鏡，避免越權改到別專案的列、也不動回收桶裡的格
        const rows = await tx
          .select({ id: schema.scenes.id })
          .from(schema.scenes)
          .where(and(eq(schema.scenes.projectId, input.projectId), isNull(schema.scenes.deletedAt)))
          .orderBy(asc(schema.scenes.orderIndex));
        const own = new Set(rows.map((r) => r.id));
        const listed = new Set(input.orderedIds);
        let idx = 0;
        for (const id of input.orderedIds) {
          if (!own.has(id)) continue;
          await tx.update(schema.scenes).set({ orderIndex: idx }).where(eq(schema.scenes.id, id));
          idx += 1;
        }
        // 清單漏掉的既有分鏡（併發新增/前端 stale）：依原相對順序補到尾端重新編號，
        // 不讓它們保留舊 orderIndex 與新序號重疊（QA-020）
        for (const row of rows) {
          if (listed.has(row.id)) continue;
          await tx.update(schema.scenes).set({ orderIndex: idx }).where(eq(schema.scenes.id, row.id));
          idx += 1;
        }
        return { ok: true };
      });
    }),
});
