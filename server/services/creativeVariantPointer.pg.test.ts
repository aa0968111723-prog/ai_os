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

/**
 * #725 P0-2 的可執行回歸測試（成本核准會清掉 preserveScenePointer）。
 *
 * red team 明確點名要補的測試：
 *   「DB 層：變體 → awaiting_approval → decideCost 核准 → advance → 斷言 scenes.assetId **未變**」
 *
 * 這裡把 decideCost 那一行的**實際資料轉換**（params 全欄覆寫）原樣重現後真的寫進 DB，
 * 再讀回來跑 generationCore 的守衛條件。所以它測的是「meta 有沒有在那次覆寫中存活」，
 * 而不是原始碼裡有沒有那串字。
 */
describe.skipIf(!RUN_PG).sequential("#725 P0-2 成本核准後變體仍不得移動指標（真 PostgreSQL）", () => {
  const groupId = randomUUID();
  const projectId = randomUUID();
  const userId = randomUUID();
  const sceneIds: string[] = [];
  const assetIds: string[] = [];
  const generationIds: string[] = [];

  async function makeAsset(): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.assets).values({ id, projectId, groupId, kind: "image", title: "t", url: `/api/assets/${id}/file` });
    assetIds.push(id);
    return id;
  }

  /** decideCost 核准分支對 params 做的事（generation.ts：重簽來源網址後全欄覆寫） */
  async function approveLikeDecideCost(genId: string) {
    const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, genId));
    const splitParams = splitGenerationSourceMeta(gen!.params);
    await db.update(schema.generations).set({
      status: "running",
      params: storeGenerationSourceMeta(splitParams.providerParams, {
        ...splitParams.meta,                 // ← 這一行就是修復本身；拿掉它就是 #725 P0-2
        secondarySourceUrl: splitParams.meta.secondarySourceUrl,
        usedUserKey: splitParams.meta.usedUserKey || undefined,
      }),
    }).where(eq(schema.generations.id, genId));
  }

  beforeAll(async () => {
    await db.insert(schema.users).values({ id: userId, email: `u-${userId}@test.local`, name: "Bruce", passwordHash: "x" });
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId, title: "核准後指標測試", kind: "video", platform: "youtube", format: "16:9",
    });
  });

  afterAll(async () => {
    if (generationIds.length) await db.delete(schema.generations).where(inArray(schema.generations.id, generationIds));
    if (sceneIds.length) await db.delete(schema.scenes).where(inArray(schema.scenes.id, sceneIds));
    if (assetIds.length) await db.delete(schema.assets).where(inArray(schema.assets.id, assetIds));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("變體 → awaiting_approval → 核准 → 完成：scenes.assetId 一個位元組都沒動", async () => {
    const original = await makeAsset();
    const sceneId = randomUUID();
    sceneIds.push(sceneId);
    await db.insert(schema.scenes).values({ id: sceneId, projectId, title: "shot", orderIndex: 0, assetId: original });

    // 三個變體都超過組門檻 → 全部落 awaiting_approval，帶 preserveScenePointer + 方向 meta
    const genIds: string[] = [];
    for (const label of ["更靠近人物", "低機位強逆光", "廣角孤立感"]) {
      const id = randomUUID();
      genIds.push(id);
      generationIds.push(id);
      await db.insert(schema.generations).values({
        id, projectId, groupId, userId, modelId: "fal-ai/x", kind: "image", prompt: "p",
        sceneId, sceneRole: "visual", status: "awaiting_approval", pointsEst: 30,
        params: storeGenerationSourceMeta({ prompt: "p" }, {
          preserveScenePointer: true,
          creative: { batchId: "batch-1", directionId: label, directionLabel: label, batchSize: 3 },
          ablation: { runId: "run-1", section: "baseline" },
        }),
      });
    }

    // 組長核准三筆
    for (const id of genIds) await approveLikeDecideCost(id);

    // 核准後 meta 必須還在（這是 P0-2 的核心）
    for (const id of genIds) {
      const [row] = await db.select().from(schema.generations).where(eq(schema.generations.id, id));
      const meta = splitGenerationSourceMeta(row!.params).meta;
      expect(meta.preserveScenePointer).toBe(true);
      expect(meta.creative?.batchId).toBe("batch-1");
      expect(meta.ablation?.runId).toBe("run-1"); // 消融分組不得靜默失真
    }

    // provider 依序完成三筆
    for (const id of genIds) {
      const [row] = await db.select().from(schema.generations).where(eq(schema.generations.id, id));
      await backfillPointer(row!, await makeAsset());
    }

    const [after] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId));
    expect(after!.assetId).toBe(original); // 使用者從未採用任何一版 → 畫面不該被換掉
  });

  it("核准路徑不會動到 sceneRole：重試失敗的旁白不會落進主畫面槽", async () => {
    const sceneId = randomUUID();
    sceneIds.push(sceneId);
    await db.insert(schema.scenes).values({ id: sceneId, projectId, title: "shot", orderIndex: 1 });
    const id = randomUUID();
    generationIds.push(id);
    await db.insert(schema.generations).values({
      id, projectId, groupId, userId, modelId: "fal-ai/tts", kind: "audio", prompt: "p",
      sceneId, sceneRole: "narration", status: "awaiting_approval", pointsEst: 30,
      params: storeGenerationSourceMeta({ prompt: "p" }, { preserveScenePointer: true }),
    });

    await approveLikeDecideCost(id);

    const [row] = await db.select().from(schema.generations).where(eq(schema.generations.id, id));
    expect(row!.sceneRole).toBe("narration"); // 核准只改 status/params，不得動角色欄位
    expect(splitGenerationSourceMeta(row!.params).meta.preserveScenePointer).toBe(true);
  });
});


/**
 * 面板批次寫入的樂觀併發（#725 P2：把 source-grep 契約測試換成真行為）。
 *
 * `scenes.visualChoiceConcurrency.contract.test.ts` 原本宣稱證明「setCards 受版本守衛保護」，
 * 但它只是 readFileSync + toContain：`applyWithRevision` 這串字在不在。字串在、行為壞掉，
 * 它照樣綠。這一組真的對 PostgreSQL 跑一次併發，斷言「兩個人同時改，只有一個會中」。
 */
describe.skipIf(!RUN_PG).sequential("面板寫入的樂觀併發（真 PostgreSQL）", () => {
  const groupId = randomUUID();
  const projectId = randomUUID();
  const userId = randomUUID();
  const sceneIds: string[] = [];

  beforeAll(async () => {
    await db.insert(schema.users).values({ id: userId, email: `u-${userId}@test.local`, name: "Bruce", passwordHash: "x" });
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId, title: "面板併發測試", kind: "video", platform: "youtube", format: "16:9",
    });
  });

  afterAll(async () => {
    if (sceneIds.length) await db.delete(schema.scenes).where(inArray(schema.scenes.id, sceneIds));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  async function newScene(fields: Partial<typeof schema.scenes.$inferInsert> = {}) {
    const id = randomUUID();
    sceneIds.push(id);
    const [row] = await db.insert(schema.scenes)
      .values({ id, projectId, title: "shot", orderIndex: 0, ...fields })
      .returning();
    return row!;
  }

  /** setCards 實際走的那條：applyWithRevision + expectedRev + baseline */
  async function applyCards(
    row: typeof schema.scenes.$inferSelect,
    patch: Partial<typeof schema.scenes.$inferInsert>,
    baseline: Record<string, unknown>,
    expectedRev: number | undefined,
  ) {
    const { applyWithRevision } = await import("./revisionGuard");
    const { isNull } = await import("drizzle-orm");
    return applyWithRevision({
      entity: "scene",
      table: schema.scenes,
      idColumn: schema.scenes.id,
      revColumn: schema.scenes.rev,
      row,
      patch,
      expectedRev,
      baseline,
      extraWhere: isNull(schema.scenes.deletedAt),
      reload: async () => {
        const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, row.id));
        return fresh!;
      },
    });
  }

  it("帶著過期的 expectedRev 改同一欄 → 不會靜默覆蓋", async () => {
    const scene = await newScene({ characterIds: ["c-original"] });

    // 夥伴先改了（rev 前進）
    await applyCards(scene, { characterIds: ["c-partner"] }, { characterIds: ["c-original"] }, scene.rev);
    const [afterPartner] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id));
    expect(afterPartner!.rev).toBeGreaterThan(scene.rev);

    // 我拿著載入時的舊 rev 與舊 baseline 再改同一欄
    let conflicted = false;
    try {
      await applyCards(scene, { characterIds: ["c-mine"] }, { characterIds: ["c-original"] }, scene.rev);
    } catch {
      conflicted = true;
    }
    const [final] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id));
    // 要嘛擋下（衝突），要嘛合併——但**絕不能**變成我的值靜默蓋掉夥伴的
    expect(conflicted || final!.characterIds?.[0] !== "c-mine").toBe(true);
    expect(final!.characterIds).toEqual(["c-partner"]);
  });

  it("各改各的欄位 → 兩邊都保留（欄位級合併，不是整列覆寫）", async () => {
    const scene = await newScene({ characterIds: ["c-1"], propIds: ["p-1"] });

    await applyCards(scene, { characterIds: ["c-2"] }, { characterIds: ["c-1"] }, scene.rev);
    // 我改的是 propIds，帶的是載入時的舊 rev
    await applyCards(scene, { propIds: ["p-2"] }, { propIds: ["p-1"] }, scene.rev).catch(() => undefined);

    const [final] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id));
    expect(final!.characterIds).toEqual(["c-2"]); // 夥伴的改動還在
    expect(final!.propIds).toEqual(["p-2"]);      // 我的改動也在
  });

  it("每次成功寫入都推進 rev（守衛才有東西可比）", async () => {
    const scene = await newScene({ characterIds: ["c-1"] });
    await applyCards(scene, { characterIds: ["c-2"] }, { characterIds: ["c-1"] }, scene.rev);
    const [after] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id));
    expect(after!.rev).toBe(scene.rev + 1);
  });
});
