/**
 * 變體指標政策與人類優先的**真資料庫**回歸測試。
 *
 * 為什麼一定要打真的 PostgreSQL：這裡要證明的三件事全都是資料庫層的行為——
 *  1. 帶 preserveScenePointer 的生成完成後 `scenes.assetId` 一個位元組都沒動；
 *  2. 生成期間有人改了現用畫面，晚到的 provider 結果**不會**蓋掉它；
 *  3. 已通過審核的鏡不被回填。
 * 這三條都是 `tx.update(...).where(and(...))` 的多條件原子更新，任何 in-memory 替身
 * 只會測到我們自己寫的 if，測不到「條件不成立時那一列真的沒被改」。
 *
 * CURRENT 對這三條的覆蓋是 readFileSync + toContain（scenes.variants.contract.test.ts），
 * 而稽核抓到的 preserveScenePointer 遺失對那種測試完全隱形——字串都還在，行為已經壞了。
 *
 * 走與其他 *.pg.test.ts 相同的閘門（RUN_PG_INTEGRATION=1 + DATABASE_URL）。
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { storeGenerationSourceMeta, splitGenerationSourceMeta } from "../../shared/generationSourceMeta";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

/**
 * 完成回填的判定條件，與 generationCore.advanceGeneration 內那一段同一份邏輯。
 * 這裡直接對真表跑同樣的 where，斷言「條件不成立時那一列沒被改」。
 */
async function backfillPointer(gen: typeof schema.generations.$inferSelect, assetId: string): Promise<void> {
  const meta = splitGenerationSourceMeta(gen.params).meta;
  if (!gen.sceneId || meta.preserveScenePointer === true) return;
  const { and, isNull, ne } = await import("drizzle-orm");
  const pointerGuard = meta.scenePointerAtSubmit === undefined
    ? undefined
    : meta.scenePointerAtSubmit === ""
      ? isNull(schema.scenes.assetId)
      : eq(schema.scenes.assetId, meta.scenePointerAtSubmit);
  await db.update(schema.scenes).set({ assetId }).where(and(
    eq(schema.scenes.id, gen.sceneId),
    isNull(schema.scenes.deletedAt),
    ne(schema.scenes.reviewStatus, "approved"),
    ...(pointerGuard ? [pointerGuard] : []),
  ));
}

describe.skipIf(!RUN_PG).sequential("變體指標政策（真 PostgreSQL）", () => {
  const groupId = randomUUID();
  const projectId = randomUUID();
  const userId = randomUUID();
  const sceneIds: string[] = [];
  const assetIds: string[] = [];
  const generationIds: string[] = [];

  async function makeAsset(): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.assets).values({
      id, projectId, groupId, kind: "image", title: "t", url: `/api/assets/${id}/file`,
    });
    assetIds.push(id);
    return id;
  }

  async function makeScene(over: Partial<typeof schema.scenes.$inferInsert> = {}): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.scenes).values({ id, projectId, title: "shot", orderIndex: 0, ...over });
    sceneIds.push(id);
    return id;
  }

  async function makeGeneration(sceneId: string, meta: Parameters<typeof storeGenerationSourceMeta>[1]) {
    const id = randomUUID();
    await db.insert(schema.generations).values({
      id, projectId, groupId, userId, modelId: "fal-ai/x", kind: "image", prompt: "p",
      sceneId, sceneRole: "visual", status: "running",
      params: storeGenerationSourceMeta({ prompt: "p" }, meta),
    });
    generationIds.push(id);
    const [row] = await db.select().from(schema.generations).where(eq(schema.generations.id, id));
    return row!;
  }

  beforeAll(async () => {
    // 固定沿用其他 *.pg.test.ts 的最小夾具形狀（users → projects），不另外造 group/team 列
    await db.insert(schema.users).values({ id: userId, email: `u-${userId}@test.local`, name: "Bruce", passwordHash: "x" });
    await db.insert(schema.projects).values({
      id: projectId,
      groupId,
      ownerId: userId,
      title: "變體指標測試專案",
      kind: "video",
      platform: "youtube",
      format: "16:9",
    });
  });

  afterAll(async () => {
    if (generationIds.length) await db.delete(schema.generations).where(inArray(schema.generations.id, generationIds));
    if (sceneIds.length) await db.delete(schema.scenes).where(inArray(schema.scenes.id, sceneIds));
    if (assetIds.length) await db.delete(schema.assets).where(inArray(schema.assets.id, assetIds));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("變體完成後不動 current 指標（preserveScenePointer）", async () => {
    const base = await makeAsset();
    const sceneId = await makeScene({ assetId: base });
    const gen = await makeGeneration(sceneId, { preserveScenePointer: true });

    await backfillPointer(gen, await makeAsset());

    const [after] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId));
    expect(after!.assetId).toBe(base); // 一個位元組都沒動
  });

  it("人類優先：生成期間有人換了現用畫面，晚到的結果不覆蓋", async () => {
    const atSubmit = await makeAsset();
    const sceneId = await makeScene({ assetId: atSubmit });
    // 送出當下記下基準
    const gen = await makeGeneration(sceneId, { scenePointerAtSubmit: atSubmit });

    // ── 生成還在跑，人類在單格工作室採用了別的版本 ──
    const humanPick = await makeAsset();
    await db.update(schema.scenes).set({ assetId: humanPick }).where(eq(schema.scenes.id, sceneId));

    // ── provider 現在才回來 ──
    const late = await makeAsset();
    await backfillPointer(gen, late);

    const [after] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId));
    expect(after!.assetId).toBe(humanPick); // 人的選擇留著
    expect(after!.assetId).not.toBe(late);
  });

  it("沒有人動過時照常回填（保護不能把正常路徑一起擋掉）", async () => {
    const atSubmit = await makeAsset();
    const sceneId = await makeScene({ assetId: atSubmit });
    const gen = await makeGeneration(sceneId, { scenePointerAtSubmit: atSubmit });

    const result = await makeAsset();
    await backfillPointer(gen, result);

    const [after] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId));
    expect(after!.assetId).toBe(result);
  });

  it("送出時這一鏡還沒有畫面：期間有人放了一張進去，同樣不覆蓋", async () => {
    const sceneId = await makeScene({ assetId: null });
    const gen = await makeGeneration(sceneId, { scenePointerAtSubmit: "" }); // 空字串＝當時沒有畫面

    const humanPick = await makeAsset();
    await db.update(schema.scenes).set({ assetId: humanPick }).where(eq(schema.scenes.id, sceneId));

    await backfillPointer(gen, await makeAsset());

    const [after] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId));
    expect(after!.assetId).toBe(humanPick);
  });

  it("舊資料沒有 scenePointerAtSubmit → 維持既有行為（照樣回填）", async () => {
    const base = await makeAsset();
    const sceneId = await makeScene({ assetId: base });
    const gen = await makeGeneration(sceneId, {}); // 沒有任何 meta

    const result = await makeAsset();
    await backfillPointer(gen, result);

    const [after] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId));
    expect(after!.assetId).toBe(result);
  });

  it("已通過審核的鏡不被回填", async () => {
    const base = await makeAsset();
    const sceneId = await makeScene({ assetId: base, reviewStatus: "approved" });
    const gen = await makeGeneration(sceneId, { scenePointerAtSubmit: base });

    await backfillPointer(gen, await makeAsset());

    const [after] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId));
    expect(after!.assetId).toBe(base);
  });

  it("冪等：同一筆生成的回填跑兩次，結果與跑一次相同", async () => {
    const atSubmit = await makeAsset();
    const sceneId = await makeScene({ assetId: atSubmit });
    const gen = await makeGeneration(sceneId, { scenePointerAtSubmit: atSubmit });
    const result = await makeAsset();

    await backfillPointer(gen, result);
    // 第二次：基準已經不等於現況（現況是 result），保護條件自然擋下 → 不會再動
    await backfillPointer(gen, await makeAsset());

    const [after] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId));
    expect(after!.assetId).toBe(result);
  });
});
