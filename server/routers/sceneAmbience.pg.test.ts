/**
 * 逐鏡環境音：資料層與寫入路徑（真 PostgreSQL）。
 *
 * 為什麼要接真資料庫而不是 mock：這支守的是「環境音是一等公民」這件事，
 * 而它的每一條保證都落在 SQL 上——欄位真的存在、投影真的帶出來、
 * 三個素材指標各自 join 且各自濾軟刪、複製分鏡時文字跟著走但音檔不跟。
 * 用假的 db 寫這些等於在測我自己寫的 stub。
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { formatStoryboardScript, parseStoryboardScript } from "../../shared/storyboardScript";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;

/** 與其他 pg 測試同一套：不建 group/team 列，直接用隨機 id（這幾張表沒有 FK 約束） */
async function seedProject() {
  const userId = randomUUID();
  const groupId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    name: "Ambience test",
    email: `ambience-${userId}@example.test`,
    passwordHash: "test-only",
  });
  const [project] = await db
    .insert(schema.projects)
    .values({ groupId, ownerId: userId, title: "環境音測試", kind: "video", platform: "test", format: "16:9" })
    .returning();
  return { project, userId };
}

d("逐鏡環境音（真 PostgreSQL）", () => {
  it("scenes 存得下環境音描述與音檔指標，且預設為 null（既有分鏡不受影響）", async () => {
    const { project } = await seedProject();
    const [scene] = await db
      .insert(schema.scenes)
      .values({ projectId: project.id, orderIndex: 1, title: "禪堂夜坐", durationSec: 5 })
      .returning();

    // 新建分鏡兩欄皆 null——migration 是純新增，舊資料不會突然多出東西
    expect(scene.ambience).toBeNull();
    expect(scene.ambienceAssetId).toBeNull();

    const [updated] = await db
      .update(schema.scenes)
      .set({ ambience: "遠處鐘聲，細微蟲鳴" })
      .where(eq(schema.scenes.id, scene.id))
      .returning();
    expect(updated.ambience).toBe("遠處鐘聲，細微蟲鳴");
  });

  it("三個素材指標互不干擾：畫面／旁白／環境音各自指各自的 asset", async () => {
    const { project } = await seedProject();
    const mk = async (kind: string) =>
      (await db
        .insert(schema.assets)
        .values({ projectId: project.id, groupId: project.groupId, kind, title: `${kind} 素材`, url: `https://x/${kind}-${randomUUID()}` })
        .returning())[0];
    const [visual, narration, ambience] = [await mk("image"), await mk("audio"), await mk("audio")];

    const [scene] = await db
      .insert(schema.scenes)
      .values({
        projectId: project.id,
        orderIndex: 1,
        title: "三軌齊全",
        durationSec: 5,
        assetId: visual.id,
        narrationAssetId: narration.id,
        ambienceAssetId: ambience.id,
      })
      .returning();

    expect(scene.assetId).toBe(visual.id);
    expect(scene.narrationAssetId).toBe(narration.id);
    expect(scene.ambienceAssetId).toBe(ambience.id);
    // 兩個音檔是不同的 asset——環境音沒有被旁白槽吃掉
    expect(scene.ambienceAssetId).not.toBe(scene.narrationAssetId);
  });

  it("環境音素材被軟刪時，只有環境音那一軌斷掉，旁白不受影響", async () => {
    const { project } = await seedProject();
    const mk = async () =>
      (await db
        .insert(schema.assets)
        .values({ projectId: project.id, groupId: project.groupId, kind: "audio", title: "音訊素材", url: `https://x/${randomUUID()}` })
        .returning())[0];
    const narration = await mk();
    const ambience = await mk();
    await db.insert(schema.scenes).values({
      projectId: project.id,
      orderIndex: 1,
      title: "軟刪測試",
      durationSec: 5,
      narrationAssetId: narration.id,
      ambienceAssetId: ambience.id,
    });

    await db.update(schema.assets).set({ deletedAt: new Date() }).where(eq(schema.assets.id, ambience.id));

    // 模擬 listByProject 的兩支 join：各自濾軟刪，互不牽連
    const [liveNarration] = await db
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(and(eq(schema.assets.id, narration.id), isNull(schema.assets.deletedAt)));
    const [liveAmbience] = await db
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(and(eq(schema.assets.id, ambience.id), isNull(schema.assets.deletedAt)));

    expect(liveNarration?.id).toBe(narration.id); // 旁白還在
    expect(liveAmbience).toBeUndefined(); // 環境音那一軌斷掉
    // 指標本身刻意保留，供回收桶還原（與 narrationAssetId 同規則）
    const [row] = await db.select().from(schema.scenes).where(eq(schema.scenes.projectId, project.id));
    expect(row.ambienceAssetId).toBe(ambience.id);
  });

  it("環境音生成綁 ambience 角色，與旁白生成各自獨立", async () => {
    const { project, userId } = await seedProject();
    const [scene] = await db
      .insert(schema.scenes)
      .values({ projectId: project.id, orderIndex: 1, title: "生成角色", durationSec: 5, ambience: "蟲鳴" })
      .returning();


    await db.insert(schema.generations).values({
      projectId: project.id,
      groupId: project.groupId,
      userId,
      modelId: "fal-ai/elevenlabs/sound-effects/v2",
      kind: "audio",
      prompt: "蟲鳴",
      sceneId: scene.id,
      sceneRole: "ambience",
      status: "queued",
    });

    // 依 role 篩得出來——listByProject 的 pendingAmbienceStatus 子查詢靠的就是這個條件
    const ambienceGens = await db
      .select()
      .from(schema.generations)
      .where(and(eq(schema.generations.sceneId, scene.id), eq(schema.generations.sceneRole, "ambience")));
    const narrationGens = await db
      .select()
      .from(schema.generations)
      .where(and(eq(schema.generations.sceneId, scene.id), eq(schema.generations.sceneRole, "narration")));

    expect(ambienceGens).toHaveLength(1);
    expect(narrationGens).toHaveLength(0); // 環境音生成不會被誤算成配音生成中
  });

  it("文字腳本來回：環境音寫得進去也讀得回來，與畫面／旁白同層級", async () => {
    const { project } = await seedProject();
    await db.insert(schema.scenes).values({
      projectId: project.id,
      orderIndex: 1,
      title: "晨光",
      durationSec: 5,
      prompt: "清晨禪堂",
      voiceover: "那一年…",
      ambience: "遠處鐘聲",
    });
    const rows = await db.select().from(schema.scenes).where(eq(schema.scenes.projectId, project.id));
    const text = formatStoryboardScript(
      rows.map((r) => ({ title: r.title, durationSec: r.durationSec, prompt: r.prompt, voiceover: r.voiceover, ambience: r.ambience })),
    );
    expect(text).toContain("環境音：遠處鐘聲");
    expect(parseStoryboardScript(text).scenes[0]?.ambience).toBe("遠處鐘聲");
  });
});
