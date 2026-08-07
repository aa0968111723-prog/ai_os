/**
 * 文字腳本的卡片行：名字回推卡片的**名冊**（真 PostgreSQL）。
 *
 * 為什麼這一支非接真資料庫不可：名冊的難處全在 SQL 上——素材卡的顯示名要靠
 * 兩張表的 left join 拼出來（「安倢的紅傘」），主人被刪掉就得退回原名，
 * 而 ownerKind 不對的那一半 join 必須不成立。用假的 db 寫這些等於在測我自己寫的 stub，
 * 而寫錯的症狀是「使用者照畫面上的名字寫回，伺服器說找不到」。
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { loadSceneCardLookup } from "../services/sceneCards";
import { resolveCardLine } from "../../shared/sceneCards";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;

/** 與其他 pg 測試同一套：不建 group/team 列，直接用隨機 id（這幾張表沒有 FK 約束） */
async function seedProject() {
  const userId = randomUUID();
  const groupId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    name: "Card script test",
    email: `card-script-${userId}@example.test`,
    passwordHash: "test-only",
  });
  const [project] = await db
    .insert(schema.projects)
    .values({ groupId, ownerId: userId, title: "卡片寫回測試", kind: "video", platform: "test", format: "16:9" })
    .returning();
  return { ...project, userId };
}

type Seeded = Awaited<ReturnType<typeof seedProject>>;
/** 卡片的必填欄位（外觀／色板／建立者）與本測試無關，統一補一份最小值 */
const mkChar = async (p: Seeded, name: string) =>
  (await db
    .insert(schema.characters)
    .values({ projectId: p.id, groupId: p.groupId, createdBy: p.userId, name, appearance: "—" })
    .returning())[0]!;
const mkPreset = async (p: Seeded, name: string) =>
  (await db
    .insert(schema.scenePresets)
    .values({ projectId: p.id, groupId: p.groupId, createdBy: p.userId, name, palette: "—" })
    .returning())[0]!;
const mkProp = async (
  p: Seeded,
  name: string,
  owner?: { ownerKind: "character" | "scene"; ownerId: string },
) =>
  (await db
    .insert(schema.props)
    .values({ projectId: p.id, groupId: p.groupId, createdBy: p.userId, name, appearance: "—", ...owner })
    .returning())[0]!;

const opts = { max: 6, human: "素材卡", currentCount: 0 };

d("文字腳本的卡片名冊（真 PostgreSQL）", () => {
  it("素材卡收「顯示名」與「原名」兩種寫法，顯示名由主人卡 join 出來", async () => {
    const project = await seedProject();
    const anjie = await mkChar(project, "安倢");
    await mkProp(project, "紅傘", { ownerKind: "character", ownerId: anjie.id });

    const lookup = await loadSceneCardLookup(project.id);
    expect(lookup.props).toHaveLength(1);
    expect(lookup.props[0]!.names).toEqual(["安倢的紅傘", "紅傘"]);
    // 使用者照畫面上看到的名字寫回，要真的對得上
    expect(resolveCardLine("安倢的紅傘", lookup.props, opts).kind).toBe("set");
    expect(resolveCardLine("紅傘", lookup.props, opts).kind).toBe("set");
  });

  it("場景卡當主人也拼得出顯示名（ownerKind 不對的那一半 join 必須不成立）", async () => {
    const project = await seedProject();
    const hall = await mkPreset(project, "禪堂");
    // 同 id 的角色卡不存在，所以 character 那一半 join 只能靠 ownerKind 擋掉
    await mkProp(project, "蒲團", { ownerKind: "scene", ownerId: hall.id });

    const lookup = await loadSceneCardLookup(project.id);
    expect(lookup.props[0]!.names).toEqual(["禪堂的蒲團", "蒲團"]);
  });

  it("獨立物件（沒有主人）只有一種寫法，不會多出一個空主人的名字", async () => {
    const project = await seedProject();
    await mkProp(project, "主視覺牌");

    const lookup = await loadSceneCardLookup(project.id);
    expect(lookup.props[0]!.names).toEqual(["主視覺牌"]);
  });

  it("主人卡被刪掉 → 退回原名；此時畫面上顯示的也是原名，兩邊仍然對得上", async () => {
    const project = await seedProject();
    const anjie = await mkChar(project, "安倢");
    await mkProp(project, "紅傘", { ownerKind: "character", ownerId: anjie.id });
    await db.delete(schema.characters).where(eq(schema.characters.id, anjie.id));

    const lookup = await loadSceneCardLookup(project.id);
    expect(lookup.props[0]!.names).toEqual(["紅傘"]);
  });

  it("只收本專案的卡片——別的專案同名卡不該讓這一行變成「有歧義」", async () => {
    const mine = await seedProject();
    const theirs = await seedProject();
    await mkChar(mine, "安倢");
    await mkChar(theirs, "安倢");

    const lookup = await loadSceneCardLookup(mine.id);
    expect(lookup.characters).toHaveLength(1);
    expect(resolveCardLine("安倢", lookup.characters, { ...opts, human: "角色卡" }).kind).toBe("set");
  });

  /**
   * 名冊不能像給 LLM 的代號清單那樣截斷：截掉的那張卡在文字裡就變成「找不到這個名字」，
   * 而使用者明明在分鏡表上看得到它、也是照著它寫的。
   */
  it("卡片很多時名冊不截斷（截斷等於讓畫面上存在的卡片寫不回去）", async () => {
    const project = await seedProject();
    for (let i = 1; i <= 25; i += 1) await mkChar(project, `角色${i}`);

    const lookup = await loadSceneCardLookup(project.id);
    expect(lookup.characters).toHaveLength(25);
    expect(resolveCardLine("角色25", lookup.characters, { ...opts, human: "角色卡" }).kind).toBe("set");
  });
});
