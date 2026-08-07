import { z } from "zod";
import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { executeGenerationCommand } from "../services/generationCommand";
import { getModel, type ModelEntry } from "../../shared/models";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "../../shared/cardLimits";
import {
  SCENE_CARD_COLUMN,
  SCENE_CARD_KINDS,
  resolveCardLine,
  resolveSceneCards,
  type CardLookupEntry,
  type SceneCardKind,
} from "../../shared/sceneCards";
import { sceneSpeechLines, speechForTts } from "../../shared/sceneSpeech";
import {
  MAX_SCRIPT_SCENES,
  SCRIPT_CARD_LABELS,
  SCRIPT_CARD_MAX,
  SCRIPT_TITLE_MAX,
  SCRIPT_VOICEOVER_MAX,
  SCRIPT_AMBIENCE_MAX,
  SCRIPT_ACTION_MAX,
  SCRIPT_DIALOGUE_MAX,
  SCRIPT_MUSIC_MAX,
  parseStoryboardScript,
  resolveScriptTargets,
  type StoryboardScriptScene,
} from "../../shared/storyboardScript";
import { loadSceneCardLookup, sceneCardColumns } from "../services/sceneCards";
import { assertGenerationEntityIds } from "../services/generationCore";
import {
  buildSceneVersions,
  findDuplicateCurrent,
  isSceneRefineModel,
  sceneVisualPrompt,
  isSceneRegenModel,
  summarizeSceneVersions,
  type SceneExternalAsset,
  type SceneVersionGenerationRow,
} from "../../shared/sceneVersions";
import { lockSceneOrder } from "../services/locks";
import { assertProjectEditable, assertProjectNotArchived } from "../services/projectAcl";
import { MAX_PROMPT_CHARS } from "./prompts";

/** 單格版本清單一次最多回幾筆（一格反覆修上百次是異常，不必無上限撈） */
const SCENE_VERSION_LIMIT = 120;

/**
 * 修剪點的上限（毫秒）＝60 分鐘。這不是業務規則，是「素材長度的寬鬆天花板」：
 * 站上生成的素材以秒計，60 分鐘遠超任何合理值，純粹擋住把整數欄位撐爆的輸入。
 */
const TRIM_MAX_MS = 60 * 60 * 1000;

export type SceneAssetSlot = "assetId" | "narrationAssetId" | "ambienceAssetId" | "musicAssetId";

/**
 * 素材 kind → 這一格的哪個現用指標欄；null＝不能當分鏡素材（例如 doc）。
 *
 * 音訊有兩個槽（旁白／環境音）之後，kind 本身已經不足以判斷要放哪一格——
 * 但預設仍是旁白：那是既有行為，改預設會讓舊的「切回這一版」靜默切到別的軌。
 * 要指到環境音的呼叫端必須明講（setVisualFromAsset 的 role 參數）。
 */
export function sceneSlotForAssetKind(kind: string): SceneAssetSlot | null {
  if (kind === "audio") return "narrationAssetId"; // 音訊＝旁白槽（與 advanceGeneration 回填同口徑）
  if (kind === "image" || kind === "video") return "assetId";
  return null;
}

/**
 * 「以這張為底圖修正」的純規則守門：不合規回中文訊息，合規回 null。
 *
 * 抽成純函式是為了讓每一條拒絕理由都測得到——這幾條規則擋的是「扣了點才發現送錯」，
 * 靠手動點畫面驗不完（模型目錄有 300+ 條，底圖狀態有現用／指定／已回收／非圖片數種）。
 */
export function refineRejection(input: {
  model: Pick<ModelEntry, "label" | "kind" | "needs"> | undefined;
  prompt: string;
  /** 解析後的底圖 id（可能來自輸入或這一格現用）；null＝這一格還沒有畫面 */
  sourceAssetId: string | null;
  /** 底圖素材列（已濾掉回收桶）；undefined＝查無 */
  source: { projectId: string; kind: string } | undefined;
  sceneProjectId: string;
}): string | null {
  if (!input.model || !isSceneRefineModel(input.model)) {
    return "「以這張為底圖修正」需要用吃底圖的圖生圖／圖生影片模型";
  }
  if (!input.prompt.trim()) return "請先寫下要改哪裡（例：把天空換成黃昏，其餘不變）";
  if (!input.sourceAssetId) return "這一格還沒有畫面可以修——請先「生成這一格」，或在版本清單挑一版當底圖";
  if (!input.source || input.source.projectId !== input.sceneProjectId) {
    return "找不到底圖，或它不屬於本專案（可能已在回收桶）";
  }
  if (input.source.kind !== "image") return "底圖必須是圖片——影片／音訊版本不能拿來修圖";
  return null;
}

/** 「生成／重生這一格」的純模型守門：不合規回中文訊息，合規回 null */
export function regenRejection(model: Pick<ModelEntry, "label" | "kind" | "needs"> | undefined): string | null {
  if (!model || (model.kind !== "image" && model.kind !== "video")) {
    return "分鏡就地生成需要用圖像或影片模型";
  }
  // 需要底圖的模型走 scenes.refine（那裡才會帶 sourceAssetId）。不擋的話會一路送到
  // generationCore 才因「此模型需要來源」被拒——使用者按了鈕、等了一下，才拿到一句看不懂的錯。
  if (!isSceneRegenModel(model)) {
    return `「${model.label}」需要底圖，請改用單格工作室的「以這張為底圖修正」`;
  }
  return null;
}

/**
 * 「這一格正在生成畫面嗎」——就地生成／修正共用的伺服器端防抖。
 * 兩顆鈕都直接扣點、沒有二次確認，快速雙擊或兩人同時按會重複送出、重複扣點。
 * （catch 常見雙擊；非強一致鎖）
 */
async function assertNoPendingVisual(sceneId: string): Promise<void> {
  const [pendingVisual] = await db
    .select({ id: schema.generations.id })
    .from(schema.generations)
    .where(and(
      eq(schema.generations.sceneId, sceneId),
      sql`(${schema.generations.sceneRole} is null or ${schema.generations.sceneRole} = 'visual')`,
      // awaiting_approval：超額待核也算「在途」，防連點堆多筆待核
      inArray(schema.generations.status, ["queued", "running", "awaiting_approval"]),
    ))
    .limit(1);
  if (pendingVisual) throw new TRPCError({ code: "CONFLICT", message: "這一格正在生成或待核准中，請稍候再生成" });
}

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

/**
 * 文字腳本的三行卡片 → 要寫進哪幾欄。
 *
 * 三條規則都在 resolveCardLine 裡，這裡只負責把結果變成 patch 並把「看得懂但不照做」
 * 的理由講出來。**不套用時一定要出聲**：整行靜默跳過的話，使用者看到的是
 * 「更新 3 鏡」而他寫的角色一個都沒進去——那比報錯難查得多。
 *
 * 不必再過一次 assertGenerationEntityIds：id 全部來自 loadSceneCardLookup(project.id)，
 * 名冊本身就只撈本專案的卡片，寫不出跨專案的引用（與 setCards 收外部 UUID 的處境不同）。
 */
export function cardPatchFromScript(
  scene: StoryboardScriptScene,
  current: Partial<Record<"characterIds" | "scenePresetIds" | "propIds", string[] | null>> | null,
  lookup: Record<SceneCardKind, CardLookupEntry[]>,
  where: string,
  warnings: string[],
): Partial<typeof schema.scenes.$inferInsert> {
  const patch: Partial<typeof schema.scenes.$inferInsert> = {};
  for (const kind of SCENE_CARD_KINDS) {
    const column = SCENE_CARD_COLUMN[kind];
    const now = current?.[column] ?? [];
    const outcome = resolveCardLine(scene[kind], lookup[kind], {
      max: SCRIPT_CARD_MAX[kind],
      human: SCRIPT_CARD_LABELS[kind],
      currentCount: now.length,
    });
    if (outcome.kind === "keep") {
      if (outcome.warning) warnings.push(`${where}${outcome.warning}`);
      continue;
    }
    // 名單一模一樣就不算更新——順序也要一樣，因為它決定提示詞裡卡片的組裝順序
    if (outcome.ids.length === now.length && outcome.ids.every((id, i) => id === now[i])) continue;
    patch[column] = outcome.ids.length ? outcome.ids : null;
  }
  return patch;
}

/** 分鏡：簡易排序（↑↓）＋從生成成品加入（定案：不做拖曳時間軸） */
export const scenesRouter = router({
  listByProject: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await getProjectChecked(ctx, input.projectId);
    // 旁白音檔另用一次別名 join（與主畫面 assetId 的 join 分開，避免同表兩次 join 撞名）
    const narrationAssets = aliasedTable(schema.assets, "narration_assets");
    // 環境音同理再一次別名：三個素材指標各自 join，任一被軟刪只影響自己那一軌
    const ambienceAssets = aliasedTable(schema.assets, "ambience_assets");
    const rows = await db
      .select({
        id: schema.scenes.id,
        title: schema.scenes.title,
        orderIndex: schema.scenes.orderIndex,
        durationSec: schema.scenes.durationSec,
        // 修剪：分鏡表要標「已修剪」，粗剪預覽要照著入點播（見 shared/timeline.ts）
        trimStartMs: schema.scenes.trimStartMs,
        trimEndMs: schema.scenes.trimEndMs,
        status: schema.scenes.status,
        assetId: schema.scenes.assetId,
        prompt: schema.scenes.prompt,
        voiceover: schema.scenes.voiceover,
        ambience: schema.scenes.ambience,
        action: schema.scenes.action,
        dialogue: schema.scenes.dialogue,
        music: schema.scenes.music,
        // 逐鏡卡片綁定：分鏡表每格顯示「這鏡用誰、在哪、拿什麼」，也決定就地生成注入哪幾張
        characterIds: schema.scenes.characterIds,
        scenePresetIds: schema.scenes.scenePresetIds,
        propIds: schema.scenes.propIds,
        assetUrl: schema.assets.url,
        assetKind: schema.assets.kind,
        // 逐鏡配音音檔網址（該格已生成的旁白）：前端播放用
        narrationUrl: narrationAssets.url,
        // 來源生成 id：前端「已加入分鏡」用穩定鍵比對（assetUrl 會在成品落地時被改寫，比 URL 會誤判）
        generationId: sql<string | null>`${schema.assets.meta} ->> 'generationId'`,
        // 該格是否有進行中的就地生成（草稿→出圖進度指示）。用純量子查詢而非 join，避免同格多筆
        // 進行中生成把分鏡列乘開成重複列；兩個子查詢用相同排序取同一筆，pendingGenId 與 status 一致。
        // 只看「畫面(visual)」生成——排除 narration，否則配音生成中會誤把主畫面標成生成中、鎖住重生鈕
        pendingGenStatus: sql<"queued" | "running" | "awaiting_approval" | null>`(
          select g.status from ${schema.generations} g
          where g.scene_id = ${schema.scenes.id} and (g.scene_role is null or g.scene_role = 'visual') and g.status in ('queued', 'running', 'awaiting_approval')
          order by g.created_at desc, g.id desc limit 1
        )`,
        pendingGenId: sql<string | null>`(
          select g.id from ${schema.generations} g
          where g.scene_id = ${schema.scenes.id} and (g.scene_role is null or g.scene_role = 'visual') and g.status in ('queued', 'running', 'awaiting_approval')
          order by g.created_at desc, g.id desc limit 1
        )`,
        // 該格是否有進行中的「配音」生成（配音生成中指示）：獨立於主畫面生成，只看 narration 角色。
        pendingVoiceStatus: sql<"queued" | "running" | "awaiting_approval" | null>`(
          select g.status from ${schema.generations} g
          where g.scene_id = ${schema.scenes.id} and g.scene_role = 'narration' and g.status in ('queued', 'running', 'awaiting_approval')
          order by g.created_at desc, g.id desc limit 1
        )`,
        // 逐鏡環境音音檔網址；與 narrationUrl 同理走各自的 join，判斷「這格有沒有環境音」一律看它
        ambienceUrl: ambienceAssets.url,
        // 進行中的「環境音」生成：與畫面／配音三軌各自獨立，生成中不互相鎖
        pendingAmbienceStatus: sql<"queued" | "running" | "awaiting_approval" | null>`(
          select g.status from ${schema.generations} g
          where g.scene_id = ${schema.scenes.id} and g.scene_role = 'ambience' and g.status in ('queued', 'running', 'awaiting_approval')
          order by g.created_at desc, g.id desc limit 1
        )`,
      })
      .from(schema.scenes)
      // JOIN 也要排除軟刪素材：deleteAsset 刻意保留 scenes.assetId（供還原），若 join 不濾 deletedAt，
      // 該格會繼續顯示已刪素材的縮圖/音檔——與交付包（box 已濾）不一致。還原後 join 自動重連。
      .leftJoin(schema.assets, and(eq(schema.scenes.assetId, schema.assets.id), isNull(schema.assets.deletedAt)))
      .leftJoin(narrationAssets, and(eq(schema.scenes.narrationAssetId, narrationAssets.id), isNull(narrationAssets.deletedAt)))
      .leftJoin(ambienceAssets, and(eq(schema.scenes.ambienceAssetId, ambienceAssets.id), isNull(ambienceAssets.deletedAt)))
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
        // 把來源生成回綁到這一格：否則它不在該格的版本清單裡——使用者切到別版之後就再也切不回
        // 這張「當初加入分鏡的原圖」（版本必須可逆）。只在生成尚未綁定任何格時綁，
        // 同一筆成品被加進第二格時不搶走第一格的歷史（第二格仍會以「外部帶入」列出現用素材）。
        //
        // role 一律 visual：本 mutation 無論成品是圖/影/音都寫進 assetId（見上），
        // 角色必須跟著「實際落在哪個槽」，否則音訊會被標成 narration，
        // 版本清單拿它去比 narrationAssetId（null）就會顯示成「不是現用」——與畫面上看到的相反。
        await tx
          .update(schema.generations)
          .set({ sceneId: scene!.id, sceneRole: "visual" })
          .where(and(eq(schema.generations.id, gen.id), isNull(schema.generations.sceneId)));
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
   * 單格版本清單（單格工作室）：同一格歷來的每一次生成 ＋ 現在被引用的素材，
   * 算成「第 N 版」的清單。畫面與旁白各自編號。
   *
   * 為什麼不新開版本表：見 `shared/sceneVersions.ts` 檔頭——`generations` 本來就是逐版紀錄，
   * `scenes.assetId`／`narrationAssetId` 本來就是「現用是哪一版」的單一真相；再開一張表只會多一個要對帳的真相。
   *
   * 讀取權限（不帶 forEdit）：檢視者也能回看版本與成本，只是不能切換。
   */
  versions: authedProcedure.input(z.object({ sceneId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [scene] = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
    if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡（可能已刪除）" });
    await getProjectChecked(ctx, scene.projectId);

    const gens = await db
      .select({
        id: schema.generations.id,
        status: schema.generations.status,
        sceneRole: schema.generations.sceneRole,
        modelId: schema.generations.modelId,
        prompt: schema.generations.prompt,
        sourceUrl: schema.generations.sourceUrl,
        error: schema.generations.error,
        createdAt: schema.generations.createdAt,
        pointsEst: schema.generations.pointsEst,
        pointsActual: schema.generations.pointsActual,
        pointsRefunded: schema.generations.pointsRefunded,
      })
      .from(schema.generations)
      .where(eq(schema.generations.sceneId, scene.id))
      .orderBy(desc(schema.generations.createdAt))
      .limit(SCENE_VERSION_LIMIT);

    // 這些生成落地成哪個素材：一次撈完在記憶體對映。
    // 不用「每列一個 meta->>'generationId' 相關子查詢」——那是 N 次無索引全表掃（meta 沒有 GIN 索引），
    // 一格改過幾十次就會把分鏡頁拖垮。
    const genIds = gens.map((g) => g.id);
    const assetRows = genIds.length
      ? await db
          .select({
            id: schema.assets.id,
            url: schema.assets.url,
            kind: schema.assets.kind,
            createdAt: schema.assets.createdAt,
            generationId: sql<string | null>`${schema.assets.meta} ->> 'generationId'`,
          })
          .from(schema.assets)
          .where(and(
            eq(schema.assets.projectId, scene.projectId),
            isNull(schema.assets.deletedAt),
            inArray(sql`(${schema.assets.meta} ->> 'generationId')`, genIds),
          ))
          .orderBy(asc(schema.assets.createdAt))
      : [];
    const assetByGen = new Map<string, (typeof assetRows)[number]>();
    for (const a of assetRows) if (a.generationId) assetByGen.set(a.generationId, a); // 同筆生成多列時取最新

    const rows: SceneVersionGenerationRow[] = gens.map((g) => {
      const asset = assetByGen.get(g.id);
      return {
        generationId: g.id,
        status: g.status,
        sceneRole: g.sceneRole ?? null,
        modelId: g.modelId,
        prompt: g.prompt,
        sourceUrl: g.sourceUrl,
        error: g.error,
        createdAt: g.createdAt.toISOString(),
        pointsEst: g.pointsEst,
        pointsActual: g.pointsActual,
        pointsRefunded: g.pointsRefunded,
        assetId: asset?.id ?? null,
        assetUrl: asset?.url ?? null,
        assetKind: asset?.kind ?? null,
      };
    });

    // 現在被引用、但不是本格生成產出的素材（例：素材庫直接指派、或舊資料沒回綁的「＋加入分鏡」）。
    // 沒有這一段，該素材不會出現在版本清單裡，切走之後就再也切不回來。
    const pointerIds = [scene.assetId, scene.narrationAssetId, scene.ambienceAssetId, scene.musicAssetId].filter((id): id is string => !!id);
    const pointerRows = pointerIds.length
      ? await db
          .select({
            id: schema.assets.id,
            url: schema.assets.url,
            kind: schema.assets.kind,
            title: schema.assets.title,
            createdAt: schema.assets.createdAt,
          })
          .from(schema.assets)
          .where(and(inArray(schema.assets.id, pointerIds), isNull(schema.assets.deletedAt)))
      : [];
    const externals: SceneExternalAsset[] = pointerRows.map((a) => ({
      assetId: a.id,
      assetUrl: a.url,
      assetKind: a.kind,
      title: a.title,
      createdAt: a.createdAt.toISOString(),
    }));

    const versions = buildSceneVersions(
      rows,
      { assetId: scene.assetId, narrationAssetId: scene.narrationAssetId, ambienceAssetId: scene.ambienceAssetId },
      externals,
    );
    // 指標欄結構上保證同一 role 只有一個現用；投影出兩個＝查詢寫錯，當場擋下不要讓 UI 顯示兩個「現用」
    const duplicated = findDuplicateCurrent(versions);
    if (duplicated.length > 0) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `版本投影異常：${duplicated.join("/")} 出現多個現用版本` });
    }
    return {
      sceneId: scene.id,
      projectId: scene.projectId,
      title: scene.title,
      prompt: scene.prompt,
      voiceover: scene.voiceover,
      assetId: scene.assetId,
      narrationAssetId: scene.narrationAssetId,
      ambience: scene.ambience,
      ambienceAssetId: scene.ambienceAssetId,
      action: scene.action,
      dialogue: scene.dialogue,
      music: scene.music,
      versions,
      summary: summarizeSceneVersions(versions),
      /** 已達回傳上限：清單只到最近 N 版，提醒前端別把「共 N 版」講成全部 */
      truncated: gens.length >= SCENE_VERSION_LIMIT,
    };
  }),

  /**
   * 版本切換（單格工作室）：直接把這一格的現用指標指到某個素材。
   * 與 setVisualFromGeneration 的差別是它以「素材」為鍵——外部帶入、沒有生成紀錄的版本也切得回去。
   */
  setVisualFromAsset: authedProcedure
    .input(z.object({
      sceneId: z.string().uuid(),
      assetId: z.string().uuid(),
      /** 音訊要進哪一軌；不給＝沿用 sceneSlotForAssetKind 的既有預設（旁白） */
      role: z.enum(["narration", "ambience", "music"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡（可能已刪除）" });
      await getProjectChecked(ctx, scene.projectId, true);
      const [asset] = await db
        .select()
        .from(schema.assets)
        .where(and(eq(schema.assets.id, input.assetId), isNull(schema.assets.deletedAt)));
      // 同專案才准指派（組隔離已由 getProjectChecked 保證；這裡再擋跨專案誤指）
      if (!asset || asset.projectId !== scene.projectId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "找不到這個素材，或它不屬於本專案（可能已在回收桶）" });
      }
      // 音訊＝旁白槽；圖/影＝主畫面槽（與 advanceGeneration 回填、setVisualFromGeneration 同口徑）
      const slot = sceneSlotForAssetKind(asset.kind);
      if (!slot) throw new TRPCError({ code: "BAD_REQUEST", message: "只有圖片／影片／音訊可以設為分鏡素材" });
      // role 只對音訊有意義：拿它去改圖／影的落點會把畫面塞進音軌
      if (input.role && asset.kind !== "audio") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只有音訊素材可以指定要進旁白、環境音還是配樂" });
      }
      const ROLE_SLOT: Record<string, SceneAssetSlot> = {
        ambience: "ambienceAssetId",
        music: "musicAssetId",
        narration: "narrationAssetId",
      };
      const target: SceneAssetSlot = input.role ? ROLE_SLOT[input.role]! : slot;
      const patch = { [target]: asset.id };
      const [updated] = await db.update(schema.scenes).set(patch).where(eq(schema.scenes.id, scene.id)).returning();
      return updated;
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
      // 落點看生成當時記下的 sceneRole，不是素材的 kind——與 advanceGeneration 的回填同一條規則
      // （generationCore.ts 的角色感知回填）。只看 kind==='audio' 會把環境音寫進 narrationAssetId：
      // 環境音那一軌沒動、旁白指標反而被音效蓋掉，交付包的「02_旁白音檔」裝進環境音，全程沒有錯誤。
      const patch =
        gen.sceneRole === "narration"
          ? { narrationAssetId: asset.id }
          : gen.sceneRole === "ambience"
            ? { ambienceAssetId: asset.id }
            : asset.kind === "audio"
              // 舊資料沒有 sceneRole（那時只有旁白一條音訊路徑），維持原本的落點
              ? { narrationAssetId: asset.id }
              : { assetId: asset.id };
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
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "這一格剛被夥伴刪除了（可到回收桶還原），沒辦法調整順序" });
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

  /**
   * 在某一鏡之後插入一格（整理分鏡用）。
   *
   * 先前只有「加到最後」＋↑↓ 一路搬——想在第 3 鏡後面補一格，要按十幾次箭頭。
   * duplicate=true 時複製來源鏡的標題／秒數／提示詞／旁白／卡片綁定；
   * **不複製成品**（assetId／narrationAssetId）：那是花過點數的產物，複製一份引用
   * 會讓兩格指向同一素材，刪一格就互相影響。新格一律從 todo 開始。
   */
  insertAfter: authedProcedure
    .input(z.object({ sceneId: z.string().uuid(), duplicate: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "要插在哪一格後面的那一格剛被夥伴刪除了（可到回收桶還原）" });
      const project = await getProjectChecked(ctx, scene.projectId, true);
      assertProjectNotArchived(project);
      return db.transaction(async (tx) => {
        await lockSceneOrder(tx, project.id);
        // 鎖內重讀：並發 move／insert 可能已經改過序號
        const all = await tx
          .select()
          .from(schema.scenes)
          .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)))
          .orderBy(asc(schema.scenes.orderIndex));
        const idx = all.findIndex((s) => s.id === scene.id);
        if (idx < 0) throw new TRPCError({ code: "NOT_FOUND", message: "分鏡已被刪除" });
        const cur = all[idx]!;
        // 後面每一格 +1 讓出位置（由後往前更新，避免中途撞到同序號）
        for (const later of all.slice(idx + 1).reverse()) {
          await tx
            .update(schema.scenes)
            .set({ orderIndex: later.orderIndex + 1 })
            .where(eq(schema.scenes.id, later.id));
        }
        const dup = input.duplicate === true;
        const [created] = await tx
          .insert(schema.scenes)
          .values({
            projectId: project.id,
            orderIndex: cur.orderIndex + 1,
            title: dup ? `${cur.title} 複本`.slice(0, 60) : "新分鏡",
            durationSec: dup ? cur.durationSec : project.format === "9:16" ? 4 : 5,
            status: "todo",
            prompt: dup ? cur.prompt : null,
            voiceover: dup ? cur.voiceover : null,
            // 環境音的「文字」跟 prompt/voiceover 同類（是設定），音檔本身不複製——與 assetId 同規則
            ambience: dup ? cur.ambience : null,
            // 走位是設定不是產物，跟著複製（同 prompt/voiceover/ambience）
            action: dup ? cur.action : null,
            dialogue: dup ? cur.dialogue : null,
            music: dup ? cur.music : null,
            // 卡片綁定是設定不是產物，複製它才符合「照這一鏡再拍一顆」的預期
            characterIds: dup ? cur.characterIds : null,
            scenePresetIds: dup ? cur.scenePresetIds : null,
            propIds: dup ? cur.propIds : null,
          })
          .returning();
        return created;
      });
    }),

  /** 刪除分鏡＝軟刪除（回收桶）：保留使用者手打的 prompt／voiceover，可從回收桶還原 */
  remove: authedProcedure.input(z.object({ sceneId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [scene] = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
    if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "這一格已經不在分鏡列上了——夥伴剛刪過（可到回收桶還原）" });
    await getProjectChecked(ctx, scene.projectId, true); // 2.3：檢視者不能刪分鏡
    await db.update(schema.scenes).set({ deletedAt: new Date() }).where(eq(schema.scenes.id, input.sceneId));
    return { ok: true };
  }),

  /** 還原分鏡（回收桶 → 分鏡列）：清掉 deletedAt，接回原本引用的素材 */
  restore: authedProcedure.input(z.object({ sceneId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, input.sceneId));
    if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "回收桶裡找不到這一格了（可能已被夥伴永久刪除）" });
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
    if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "回收桶裡找不到這一格了（夥伴可能已經永久刪除或還原它）" });
    await getProjectChecked(ctx, scene.projectId, true); // 2.3：檢視者不能永久刪除分鏡（不可回復）
    await db.delete(schema.scenes).where(eq(schema.scenes.id, input.sceneId));
    return { ok: true };
  }),

  /** 就地編輯分鏡欄位（標題／秒數／旁白／提示詞）：只更新有帶的欄位 */
  update: authedProcedure
    .input(
      z.object({
        sceneId: z.string().uuid(),
        // 上限與文字腳本寫回共用同一組常數——兩邊各寫一份數字，遲早有一邊被調大變成後門
        title: z.string().min(1).max(SCRIPT_TITLE_MAX).optional(),
        durationSec: z.number().int().min(1).max(60).optional(),
        voiceover: z.string().max(SCRIPT_VOICEOVER_MAX).optional(),
        ambience: z.string().max(SCRIPT_AMBIENCE_MAX).optional(),
        action: z.string().max(SCRIPT_ACTION_MAX).optional(),
        dialogue: z.string().max(SCRIPT_DIALOGUE_MAX).optional(),
        music: z.string().max(SCRIPT_MUSIC_MAX).optional(),
        // 獨立單格修：允許就地改提示詞，之後「重生這一格」用新 prompt（不影響其他格）
        prompt: z.string().max(MAX_PROMPT_CHARS).optional(),
        // 修剪（毫秒）：上限 60 分鐘＝素材長度的寬鬆天花板；trimEndMs 可傳 null 表示「取消修剪」
        trimStartMs: z.number().int().min(0).max(TRIM_MAX_MS).optional(),
        trimEndMs: z.number().int().min(0).max(TRIM_MAX_MS).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "這一格剛被夥伴刪除了（可到回收桶還原），你剛才的修改沒有存進去" });
      await getProjectChecked(ctx, scene.projectId, true);
      const patch: Partial<typeof schema.scenes.$inferInsert> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.durationSec !== undefined) patch.durationSec = input.durationSec;
      if (input.voiceover !== undefined) patch.voiceover = input.voiceover;
      if (input.ambience !== undefined) patch.ambience = input.ambience;
      if (input.action !== undefined) patch.action = input.action;
      if (input.dialogue !== undefined) patch.dialogue = input.dialogue;
      if (input.music !== undefined) patch.music = input.music;
      if (input.prompt !== undefined) patch.prompt = input.prompt;
      if (input.trimStartMs !== undefined) patch.trimStartMs = input.trimStartMs;
      if (input.trimEndMs !== undefined) patch.trimEndMs = input.trimEndMs;
      // 出點必須大於入點，否則是零長度或負長度剪輯——交付出去的時間軸會打不開。
      // 兩欄可以分開送，所以要拿「合併後」的值判斷，不能只看這次送了什麼。
      const nextStart = patch.trimStartMs ?? scene.trimStartMs;
      const nextEnd = patch.trimEndMs !== undefined ? patch.trimEndMs : scene.trimEndMs;
      if (nextEnd !== null && nextEnd !== undefined && nextEnd <= nextStart) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "修剪的結束點必須晚於開始點" });
      }
      if (Object.keys(patch).length === 0) return scene; // 無欄位可更，回原狀
      const [updated] = await db.update(schema.scenes).set(patch).where(eq(schema.scenes.id, input.sceneId)).returning();
      return updated;
    }),

  /**
   * 文字分鏡腳本一次寫回：整份文字 → 更新既有鏡、多的新增到末尾。
   *
   * 刻意保守，兩條原則：
   * 1. **永不刪除**——文字裡少寫一鏡，那一格只是「保留不動」。忘了寫不該讓已出圖的格消失。
   * 2. **省略不等於清空**——只寫標題的那一鏡，畫面／旁白維持原值。
   * 解析一律在伺服器做（不信任前端送來的結構化結果），前端那份只用於預覽差異。
   */
  applyScript: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      // 12 鏡 × 每鏡提示詞上限仍有餘裕；再長多半是整份文件貼錯地方
      text: z.string().max(60_000),
      /**
       * 使用者算差異時看到的那份分鏡（依 orderIndex 排序的 id）。
       *
       * 寫回是拿「鏡次／位置」對格的，而畫面上那份清單最舊可能是 10 秒前的（listByProject 的
       * refetchInterval）。夥伴在這段空窗刪掉第 2 鏡，第 3 鏡的文字就會整批落到原本的第 4 鏡上——
       * 被覆蓋的畫面／旁白沒有回收桶可還原，而確認框還指名道姓說要蓋第 3 鏡。
       * 對不上就整批拒絕，讓人重開一次全文；沒帶（舊前端、MCP）則維持原行為不做檢查。
       */
      expectedSceneIds: z.array(z.string().uuid()).max(MAX_SCRIPT_SCENES).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectChecked(ctx, input.projectId, true);
      assertProjectNotArchived(project);
      const parsed = parseStoryboardScript(input.text);
      if (parsed.errors.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: parsed.errors.join("；") });
      }
      if (!parsed.scenes.length) {
        return { updated: 0, created: 0, keptUntouched: 0, warnings: parsed.warnings };
      }

      const warnings = [...parsed.warnings];
      // 名冊只在文字裡真的寫了卡片行時才撈——沒寫的那絕大多數次寫回不該多打三支查詢
      const wroteCards = parsed.scenes.some((s) => SCENE_CARD_KINDS.some((k) => s[k] !== undefined));
      const cardLookup = wroteCards ? await loadSceneCardLookup(project.id) : null;

      // 與拆分鏡／新增分鏡共用同一把序號鎖：併發寫回不會插出重複 orderIndex
      return db.transaction(async (tx) => {
        await lockSceneOrder(tx, project.id);
        const rows = await tx
          .select()
          .from(schema.scenes)
          .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)))
          .orderBy(asc(schema.scenes.orderIndex));

        // 指紋比對放在鎖之後：鎖外讀到的清單一樣可能在鎖等待期間被改掉。
        // 「鏡次→位置」的對應只在分鏡列沒動過時才成立，一動就整批拒絕，不做局部猜測——
        // 猜錯的代價是把別人的畫面／旁白蓋掉，而且沒有回收桶。
        const expected = input.expectedSceneIds;
        if (expected && (expected.length !== rows.length || expected.some((id, i) => id !== rows[i].id))) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "分鏡在你編輯期間被夥伴改過（新增、刪除或重新排序），這次沒有寫回。請取消編輯、重新打開全文再改一次",
          });
        }

        let updated = 0;
        let created = 0;
        let order = rows.length ? Math.max(...rows.map((r) => r.orderIndex)) : 0;

        // 鏡次優先於出現順序：中間整段沒寫時，「## 3.」仍指第 3 鏡，不會遞補去蓋掉第 2 鏡
        const targets = resolveScriptTargets(rows.length, parsed.scenes);
        for (const { scene, rowIndex } of targets) {
          const row = rowIndex === null ? null : rows[rowIndex];
          const where = row ? `第 ${(rowIndex ?? 0) + 1} 鏡的` : `新增的「${scene.title.slice(0, 12)}」的`;
          const cardPatch = cardLookup ? cardPatchFromScript(scene, row, cardLookup, where, warnings) : {};
          if (!row) {
            await tx.insert(schema.scenes).values({
              projectId: project.id,
              orderIndex: ++order,
              // 標題留空在既有鏡是「維持原值」，但新增的鏡沒有原值可維持——
              // 就地補一個看得懂的佔位，否則分鏡列會多出一格無名空白。
              title: (scene.title || `第 ${rows.length + created + 1} 鏡`).slice(0, SCRIPT_TITLE_MAX),
              durationSec: scene.durationSec ?? (project.format === "9:16" ? 4 : 5),
              status: "todo",
              prompt: scene.prompt ?? null,
              voiceover: scene.voiceover ?? null,
              ambience: scene.ambience ?? null,
              action: scene.action ?? null,
              dialogue: scene.dialogue ?? null,
              music: scene.music ?? null,
              ...cardPatch,
            });
            created += 1;
            continue;
          }
          // 只寫「文字裡真的有寫」的欄位——undefined＝沒寫到，維持原值
          const patch: Partial<typeof schema.scenes.$inferInsert> = {};
          if (scene.title && scene.title !== row.title) patch.title = scene.title.slice(0, SCRIPT_TITLE_MAX);
          if (scene.durationSec !== undefined && scene.durationSec !== row.durationSec) {
            patch.durationSec = scene.durationSec;
          }
          if (scene.prompt !== undefined && scene.prompt !== (row.prompt ?? "").trim()) {
            patch.prompt = scene.prompt;
          }
          if (scene.voiceover !== undefined && scene.voiceover !== (row.voiceover ?? "").trim()) {
            patch.voiceover = scene.voiceover;
          }
          if (scene.ambience !== undefined && scene.ambience !== (row.ambience ?? "").trim()) {
            patch.ambience = scene.ambience;
          }
          if (scene.action !== undefined && scene.action !== (row.action ?? "").trim()) {
            patch.action = scene.action;
          }
          if (scene.dialogue !== undefined && scene.dialogue !== (row.dialogue ?? "").trim()) {
            patch.dialogue = scene.dialogue;
          }
          if (scene.music !== undefined && scene.music !== (row.music ?? "").trim()) {
            patch.music = scene.music;
          }
          Object.assign(patch, cardPatch);
          if (Object.keys(patch).length === 0) continue;
          await tx.update(schema.scenes).set(patch).where(eq(schema.scenes.id, row.id));
          updated += 1;
        }

        return {
          updated,
          created,
          keptUntouched: Math.max(0, rows.length - targets.filter((t) => t.rowIndex !== null).length),
          warnings,
        };
      });
    }),

  /**
   * 逐鏡卡片綁定：這一鏡要用哪些角色／場景／素材卡（拆分鏡時 AI 先填，之後可人工改）。
   * 卡片本體仍在專案層，這裡只存引用；三欄皆空＝沒指定，逐鏡生成沿用生成台勾選。
   */
  setCards: authedProcedure
    .input(z.object({
      sceneId: z.string().uuid(),
      /**
       * 三排各自 optional，undefined＝這一排不動（與 scenes.update 同口徑）。
       *
       * 一定要能「只送動到的那一排」：面板是每勾一下就存，若照舊要求整組送出，
       * 呼叫端只能拿自己手上的 scene 快照補齊另外兩排——而那份快照最舊是 10 秒前的
       * （listByProject 的 refetchInterval）。夥伴剛在同一格綁上的場景卡就會被這次
       * 整組覆寫靜默清掉，兩邊都沒有提示，之後逐鏡出圖少注入那張場景錨點，畫風分岔而沒人知道為什麼。
       */
      characterIds: z.array(z.string().uuid()).max(MAX_GENERATE_CHARACTERS).optional(),
      scenePresetIds: z.array(z.string().uuid()).max(MAX_GENERATE_SCENE_PRESETS).optional(),
      propIds: z.array(z.string().uuid()).max(MAX_GENERATE_PROPS).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "這一格剛被夥伴刪除了（可到回收桶還原），卡片綁定沒有存進去" });
      await getProjectChecked(ctx, scene.projectId, true);
      // fail-closed：卡片必須屬於本專案，否則不寫入外鍵 UUID（與 generation 同一關）
      await assertGenerationEntityIds(scene.projectId, {
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
        propIds: input.propIds,
      });
      // 只覆寫真的送上來的那幾排（空陣列→null 的正規化仍由 sceneCardColumns 統一做）
      const columns = sceneCardColumns({
        characterIds: input.characterIds ?? [],
        scenePresetIds: input.scenePresetIds ?? [],
        propIds: input.propIds ?? [],
      });
      const patch: Partial<typeof schema.scenes.$inferInsert> = {};
      if (input.characterIds !== undefined) patch.characterIds = columns.characterIds;
      if (input.scenePresetIds !== undefined) patch.scenePresetIds = columns.scenePresetIds;
      if (input.propIds !== undefined) patch.propIds = columns.propIds;
      if (Object.keys(patch).length === 0) return scene; // 三排都沒送＝沒事可做
      const [updated] = await db
        .update(schema.scenes)
        .set(patch)
        .where(eq(schema.scenes.id, input.sceneId))
        .returning();
      return updated;
    }),

  /** 就地生成：以該分鏡的 prompt 送出生成並綁定該格，完成後由 advanceGeneration 回填 assetId（草稿→出圖一條線） */
  generateInto: authedProcedure
    .input(z.object({
      sceneId: z.string().uuid(),
      modelId: z.string(),
      // 與 generation.submit / prompts.save 同口徑
      prompt: z.string().max(MAX_PROMPT_CHARS).optional(),
      /** 冪等鍵：timeout 重送同鍵回原列，不重複扣點 */
      clientRequestId: z.string().uuid().optional(),
      /**
       * 生成台勾選的角色/場景/素材卡——只在「這一鏡沒有自己的綁定」時才用得到（fallback）。
       * 有綁定就以該鏡為準：第 3 鏡的紅傘特寫不該被全域勾選硬塞一個角色進來。
       */
      characterIds: z.array(z.string().uuid()).max(MAX_GENERATE_CHARACTERS).optional(),
      scenePresetIds: z.array(z.string().uuid()).max(MAX_GENERATE_SCENE_PRESETS).optional(),
      propIds: z.array(z.string().uuid()).max(MAX_GENERATE_PROPS).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "這一格剛被夥伴刪除了（可到回收桶還原），沒有送出生成，也沒有扣點" });
      const project = await getProjectChecked(ctx, scene.projectId, true);
      assertProjectNotArchived(project); // 封存專案不接受付費生成
      // kind 守衛（與 generateVoiceover 對稱）：就地生成回填主畫面 assetId，只接受圖像/影片模型。
      // text 模型扣點後不會入素材庫；audio 模型會把音訊寫進 visual 槽造成破圖。
      const model = getModel(input.modelId);
      const modelRejection = regenRejection(model);
      if (modelRejection) throw new TRPCError({ code: "BAD_REQUEST", message: modelRejection });
      // 呼叫端指定的提示詞優先；否則用這一鏡的畫面描述，影片類模型再接上走位
      const prompt = input.prompt ?? sceneVisualPrompt(scene, model);
      if (!prompt.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "這一格還沒有生成提示詞，請先填寫或改用生成台" });
      await assertNoPendingVisual(scene.id);
      // 這一鏡有綁卡片就整組用它；沒綁才沿用呼叫端（生成台）的勾選
      const cards = resolveSceneCards(scene, {
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
        propIds: input.propIds,
      });
      // TD-02：分鏡就地生成走 Command（政策＋狀態機＋ACL＋扣點）
      const gen = await executeGenerationCommand({
        auth: ctx.auth,
        source: "web",
        id: input.clientRequestId, // 冪等鍵：timeout 重送同鍵回原列，不重複扣點
        projectId: scene.projectId,
        modelId: input.modelId,
        prompt,
        sceneId: scene.id,
        characterIds: cards.characterIds,
        scenePresetIds: cards.scenePresetIds,
        propIds: cards.propIds,
        reasonPrefix: "分鏡生成",
      });
      return { generationId: gen.id };
    }),

  /**
   * 單格修正（單格工作室的核心）：拿這一格「現在這張」當底圖，只改指定的地方，
   * 完成後照樣回填本格的 assetId——把單一畫面拉出來反覆修，不牽動其他分鏡。
   *
   * 與 generateInto 的差別：
   * - generateInto＝文生圖，從頭重畫（構圖會整個換掉）
   * - refine＝圖生圖／圖生影片，以底圖為基準改（保留構圖，換天色／去背／放大／讓它動起來）
   *
   * 底圖預設就是這一格的現用素材；也可指定版本清單裡任何一版的素材（sourceAssetId），
   * 於是「回到第 2 版再從那裡改一次」是可行的。
   */
  refine: authedProcedure
    .input(z.object({
      sceneId: z.string().uuid(),
      modelId: z.string(),
      /** 修改指示（例：「把天空換成黃昏，其餘不變」）；與 generation.submit 同上限 */
      prompt: z.string().max(MAX_PROMPT_CHARS),
      /** 底圖素材；不帶＝用這一格目前的畫面 */
      sourceAssetId: z.string().uuid().optional(),
      /** 冪等鍵：timeout 重送同鍵回原列，不重複扣點 */
      clientRequestId: z.string().uuid().optional(),
      /** 與 generateInto 同口徑：只在這一鏡沒有自己的綁定時才當 fallback */
      characterIds: z.array(z.string().uuid()).max(MAX_GENERATE_CHARACTERS).optional(),
      scenePresetIds: z.array(z.string().uuid()).max(MAX_GENERATE_SCENE_PRESETS).optional(),
      propIds: z.array(z.string().uuid()).max(MAX_GENERATE_PROPS).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡（可能已刪除）" });
      const project = await getProjectChecked(ctx, scene.projectId, true);
      assertProjectNotArchived(project); // 封存專案不接受付費生成
      const model = getModel(input.modelId);
      // 底圖預設＝這一格現用畫面；查詢已濾掉回收桶（不可拿已刪素材當底圖）
      const sourceAssetId = input.sourceAssetId ?? scene.assetId;
      const [source] = sourceAssetId
        ? await db
            .select()
            .from(schema.assets)
            .where(and(eq(schema.assets.id, sourceAssetId), isNull(schema.assets.deletedAt)))
        : [];
      // 同專案才准當底圖（generationCore 的 assertGenerationEntityIds 也會擋；這裡先擋是為了給看得懂的訊息）
      const rejection = refineRejection({
        model,
        prompt: input.prompt,
        sourceAssetId,
        source,
        sceneProjectId: scene.projectId,
      });
      if (rejection) throw new TRPCError({ code: "BAD_REQUEST", message: rejection });
      await assertNoPendingVisual(scene.id);
      // 修圖與就地生成同一條規則：這一鏡綁了卡片就用它——付費修圖不該注入不相干的全域卡片
      const cards = resolveSceneCards(scene, {
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
        propIds: input.propIds,
      });
      // 走與其他生成同一條 Command（政策＋狀態機＋ACL＋估點＋扣點＋失敗退點）；
      // sourceAssetId 由 generationCore 換成短效簽名網址，fal 才抓得到、外人不可偽造。
      const gen = await executeGenerationCommand({
        auth: ctx.auth,
        source: "web",
        id: input.clientRequestId,
        projectId: scene.projectId,
        modelId: input.modelId,
        prompt: input.prompt,
        sourceAssetId: source.id,
        sceneId: scene.id,
        sceneRole: "visual",
        characterIds: cards.characterIds,
        scenePresetIds: cards.scenePresetIds,
        propIds: cards.propIds,
        reasonPrefix: "分鏡修圖",
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
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "這一格剛被夥伴刪除了（可到回收桶還原），沒有送出配音生成，也沒有扣點" });
      const project = await getProjectChecked(ctx, scene.projectId, true);
      assertProjectNotArchived(project); // 封存專案不接受付費生成
      // 旁白與對白是同一條說話序列：只寫了對白的鏡也要能配音，否則使用者明明滿滿台詞
      // 卻被擋在「還沒有配音詞」。括號指示（小聲、畫外）不進唸詞——唸出來是廢音檔。
      const speech = sceneSpeechLines(scene);
      const prompt = speechForTts(speech).map((l) => l.text).join("\n");
      if (!prompt.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "這一格還沒有旁白或對白，請先在分鏡或文字腳本裡填" });
      }
      // 只放行「文字轉語音(TTS)」類：text-to-audio（配樂/音效）雖同為 kind=audio，但會生出音樂而非旁白，
      // 混入 narration 槽＝扣點又拿到錯內容，故以 category 精確把關（不能只看 kind）。
      const modelId = input.modelId ?? "fal-ai/kokoro/mandarin-chinese";
      const model = getModel(modelId);
      if (!model || model.category !== "text-to-speech") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "配音需要用語音（TTS）模型" });
      }
      // 伺服器端防抖：同格已有進行中的「配音」生成就擋下，避免快速雙擊重複送出、重複扣點（本鈕直接扣點無二次確認）
      // 旁白獨立於畫面，故不共用 assertNoPendingVisual——配音生成中不該擋住畫面重生，反之亦然
      const [pendingVoice] = await db
        .select({ id: schema.generations.id })
        .from(schema.generations)
        .where(and(
          eq(schema.generations.sceneId, scene.id),
          eq(schema.generations.sceneRole, "narration"),
          // awaiting_approval 也算在途（與 assertNoPendingVisual 同口徑）：待核准的生成雖然還沒扣點、
          // 也還沒送供應商，但它已經佔住旁白這一軌。漏掉它就能在待核那筆之上再開一筆，
          // 同格同軌兩筆在途，兩筆先後核准會各自回填 narrationAssetId——先落地的那一版無聲被覆蓋。
          inArray(schema.generations.status, ["queued", "running", "awaiting_approval"]),
        ))
        .limit(1);
      if (pendingVoice) throw new TRPCError({ code: "CONFLICT", message: "這一格的配音正在生成或待核准中，請稍候" });
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

  /**
   * 逐鏡環境音：以該分鏡的 ambience 當提示詞送音效／配樂模型，綁 ambience 角色，
   * 完成後回填 ambienceAssetId。整支與 generateVoiceover 對稱，差別只有三處，且每一處都是刻意的：
   * 放行的模型類別是 text-to-audio（不是 TTS）、防抖看的是 ambience 角色、回填落在環境音槽。
   */
  generateAmbience: authedProcedure
    .input(z.object({ sceneId: z.string().uuid(), modelId: z.string().optional(), clientRequestId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "這一格剛被夥伴刪除了（可到回收桶還原），沒有送出環境音生成，也沒有扣點" });
      const project = await getProjectChecked(ctx, scene.projectId, true);
      assertProjectNotArchived(project); // 封存專案不接受付費生成
      const prompt = scene.ambience ?? "";
      if (!prompt.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "這一格還沒有環境音描述，請先在分鏡或腳本裡填" });
      // 與配音相反的把關：這裡只放行 text-to-audio（音效／配樂）。TTS 同為 kind=audio 但會把
      // 描述「唸出來」——「遠處鐘聲，細微鳥鳴」變成一個人朗讀那八個字，扣了點卻拿到廢音檔。
      const modelId = input.modelId ?? "fal-ai/elevenlabs/sound-effects/v2";
      const model = getModel(modelId);
      if (!model || model.category !== "text-to-audio") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "環境音需要用音效／配樂（text-to-audio）模型" });
      }
      // 伺服器端防抖：三軌各自獨立，環境音生成中不擋畫面與配音，反之亦然
      const [pendingAmbience] = await db
        .select({ id: schema.generations.id })
        .from(schema.generations)
        .where(and(
          eq(schema.generations.sceneId, scene.id),
          eq(schema.generations.sceneRole, "ambience"),
          // 同 generateVoiceover：待核准的生成沒扣點也沒送供應商，但它已經佔住環境音這一軌，
          // 再開一筆就是同格同軌兩筆在途，核准後兩筆都回填 ambienceAssetId 而互相覆蓋。
          inArray(schema.generations.status, ["queued", "running", "awaiting_approval"]),
        ))
        .limit(1);
      if (pendingAmbience) throw new TRPCError({ code: "CONFLICT", message: "這一格的環境音正在生成或待核准中，請稍候" });
      const gen = await executeGenerationCommand({
        auth: ctx.auth,
        source: "web",
        id: input.clientRequestId, // 冪等鍵：timeout 重送同鍵回原列，不重複扣點
        projectId: scene.projectId,
        modelId,
        prompt,
        sceneId: scene.id,
        sceneRole: "ambience",
        reasonPrefix: "環境音生成",
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
