/**
 * 連戲檢查（PE 計畫 §23 雙向影響的「畫面過時」那一半，兼 P3 Continuity Checker 的第一版）。
 *
 * 問題：卡片改了，之前生成的畫面不會跟著變，也不會有人通知。使用者到成片才發現傘還是紅的。
 *
 * 做法：每一鏡「現在顯示的那張圖」都可以回溯到產出它的那次生成，而那次生成凍了一份
 * continuitySnapshot（當時角色/場景/道具卡長什麼樣）。把快照跟現在的卡片逐欄比對，
 * 就知道這張圖是不是已經對不上了——**不需要新欄位、不需要 migration**，
 * 也比「卡片有沒有被碰過」準（改備註不影響畫面，改外觀才影響）。
 *
 * 這支永遠唯讀：只回報，不自動重生成（重生成要花點數，是使用者的決定）。
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import {
  continuitySnapshotSchema,
  detectContinuityDrift,
  describeDrift,
  type ContinuityDrift,
  type ContinuityShotDirection,
  type CurrentCards,
} from "../../shared/continuity";

export interface ShotContinuityStatus {
  shotId: string;
  title: string;
  /** 這一鏡目前顯示的畫面素材 */
  assetId: string;
  drifts: ContinuityDrift[];
  /** 人看得懂的原因（空字串＝沒過時） */
  reason: string;
}

/** 一次撈齊全專案「會影響畫面」的卡片欄位（過時比對的右手邊） */
async function loadCurrentCards(projectId: string): Promise<CurrentCards> {
  const [characters, scenes, props, looks] = await Promise.all([
    db
      .select({ id: schema.characters.id, appearance: schema.characters.appearance })
      .from(schema.characters)
      .where(eq(schema.characters.projectId, projectId)),
    db
      .select({ id: schema.scenePresets.id, palette: schema.scenePresets.palette, lighting: schema.scenePresets.lighting })
      .from(schema.scenePresets)
      .where(eq(schema.scenePresets.projectId, projectId)),
    db
      .select({ id: schema.props.id, appearance: schema.props.appearance })
      .from(schema.props)
      .where(eq(schema.props.projectId, projectId)),
    db
      .select({
        id: schema.characterLooks.id,
        name: schema.characterLooks.name,
        costume: schema.characterLooks.costume,
      })
      .from(schema.characterLooks)
      .where(eq(schema.characterLooks.projectId, projectId)),
  ]);

  // 造型以 lookId 為鍵：只跟快照凍的那一張比。
  // （早期版本把「專案第一套造型」掛到每個角色上，結果只要專案後來多一套造型，
  //   所有舊圖都會被誤判成「換了造型」——e2e 的「卡片沒動時不誤報過時」就是被這個抓出來的。）
  return {
    characters: new Map(characters.map((c) => [c.id, { appearance: c.appearance }])),
    scenes: new Map(scenes.map((s) => [s.id, { palette: s.palette, lighting: s.lighting }])),
    props: new Map(props.map((p) => [p.id, { appearance: p.appearance }])),
    looks: new Map(looks.map((l) => [l.id, { name: l.name, costume: l.costume }])),
  };
}

/**
 * 全專案連戲檢查：回「畫面已經跟卡片對不上」的鏡。
 * 沒有畫面的鏡、找不到來源生成的鏡（例如手動上傳的圖）一律不列——無從判斷就別猜。
 */
export async function checkProjectContinuity(projectId: string): Promise<ShotContinuityStatus[]> {
  // 每一鏡現在顯示的圖 → 產出它的那次生成（assets.meta.generationId 是既有的回填連結）
  const rows = await db
    .select({
      shotId: schema.scenes.id,
      title: schema.scenes.title,
      assetId: schema.scenes.assetId,
      assetMeta: schema.assets.meta,
      // 鏡頭語言漂移的右手邊：這一鏡「現在」的鏡頭語言。
      // 與卡片一起在同一支查詢帶回來，不另外 N 次查。
      camera: schema.scenes.camera,
      performance: schema.scenes.performance,
      action: schema.scenes.action,
    })
    .from(schema.scenes)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.scenes.assetId))
    .where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt), isNull(schema.assets.deletedAt)))
    .orderBy(schema.scenes.orderIndex);

  const byGeneration = new Map<string, {
    shotId: string;
    title: string;
    assetId: string;
    direction: ContinuityShotDirection;
  }>();
  for (const r of rows) {
    const genId = (r.assetMeta as { generationId?: unknown } | null)?.generationId;
    if (typeof genId === "string" && r.assetId) {
      byGeneration.set(genId, {
        shotId: r.shotId,
        title: r.title,
        assetId: r.assetId,
        direction: { camera: r.camera, performance: r.performance, action: r.action },
      });
    }
  }
  if (byGeneration.size === 0) return [];

  const generations = await db
    .select({ id: schema.generations.id, continuitySnapshot: schema.generations.continuitySnapshot })
    .from(schema.generations)
    .where(inArray(schema.generations.id, [...byGeneration.keys()]));

  const current = await loadCurrentCards(projectId);
  const out: ShotContinuityStatus[] = [];
  for (const gen of generations) {
    const shot = byGeneration.get(gen.id);
    if (!shot) continue;
    // 快照可能是舊版形狀或壞資料：解析不過就當「無從判斷」，不製造假警報
    const parsed = continuitySnapshotSchema.safeParse(gen.continuitySnapshot);
    if (!parsed.success) continue;
    const drifts = detectContinuityDrift(parsed.data, current, shot.direction);
    if (!drifts.length) continue;
    out.push({ shotId: shot.shotId, title: shot.title, assetId: shot.assetId, drifts, reason: describeDrift(drifts) });
  }
  return out;
}
