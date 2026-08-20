/**
 * Shot look adoption contract（real PostgreSQL）。
 *
 * ## 這份契約守什麼
 *
 * `scenes.update` 的「鏡採用造型」是 #721 以來的公開契約（e2e-story 的
 * 「鏡採用造型（lookIds）」斷言）。#791 在 update 加了「主人不在鏡上就拒絕」，
 * 把這個契約打斷——而 update 的 input 沒有 characterIds 欄位，拒絕等於逼呼叫端
 * 走兩段式寫入（正是 setCards 檔頭記載要消滅的孤兒來源）。
 *
 * 修正後的 canonical contract：
 *
 * 1. **採用造型＝造型主人出場**：主人不在鏡上時，同一筆原子寫入把他綁進
 *    characterIds（自動綁定），不拒絕、不留孤兒。
 * 2. **mutation response 就帶結果**：呼叫端不必再 GET 一次才知道採用成功。
 * 3. **GET / list 與 mutation response 一致**：兩邊讀的是同一列。
 * 4. **#791 的不變式原樣保留**：寫入之後每個造型的主人都在 characterIds 裡；
 *    setCards 的矛盾指令（送了排除主人的 characterIds 又送他的造型）仍拒絕。
 * 5. **fail-closed 不放鬆**：跨專案／不存在的造型、檢視者寫入、超過角色上限
 *    的自動綁定，全部拒絕。
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/routers/scenes.lookAdoption.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import type { AuthState } from "../services/auth";
import { MAX_GENERATE_CHARACTERS } from "../../shared/cardLimits";
import { buildContinuitySnapshot } from "../services/continuity";
import { scenesRouter } from "./scenes";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string, role: "leader" | "member" = "leader"): AuthState {
  return {
    user: { id: userId, name: "look", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role }],
    adminTeamIds: [],
  };
}

d("shot look adoption contract (real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.projectMembers).where(eq(schema.projectMembers.projectId, projectId));
      await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
      await db.delete(schema.characterLooks).where(eq(schema.characterLooks.projectId, projectId));
      await db.delete(schema.characters).where(eq(schema.characters.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  async function seed(title: string) {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "Look", email: `look-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title, kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);
    const ctx = { auth: authFor(userId, groupId) };
    const scenes = scenesRouter.createCaller(ctx as never);

    const [anjie] = await db.insert(schema.characters).values({
      projectId: project.id, groupId, name: "安潔", appearance: "長髮、米白外套", createdBy: userId,
    }).returning();
    const [lookA] = await db.insert(schema.characterLooks).values({
      projectId: project.id, groupId, characterId: anjie.id, name: "短髮時期", costume: "俐落短髮、深色大衣", createdBy: userId,
    }).returning();
    const [lookB] = await db.insert(schema.characterLooks).values({
      projectId: project.id, groupId, characterId: anjie.id, name: "雨天", costume: "黃色雨衣", createdBy: userId,
    }).returning();
    // 純寫景鏡：沒有角色、沒有造型——e2e-story 觸發回歸的正是這種鏡
    const [shot] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "清晨的坡道下著雨",
    }).returning();
    return { project, userId, groupId, scenes, anjie, lookA, lookB, shot };
  }

  it("初始沒有造型也沒有角色", async () => {
    const { shot } = await seed("初始狀態");
    expect(shot.lookIds).toBeNull();
    expect(shot.characterIds).toBeNull();
  });

  it("在無角色的鏡採用造型：mutation response 就帶 lookIds，且主人被同一筆寫入自動綁進來", async () => {
    const { scenes, shot, anjie, lookA } = await seed("採用造型");
    const upd = await scenes.update({ sceneId: shot.id, lookIds: [lookA.id] });
    // 這一條就是 e2e-story 的「鏡採用造型（lookIds）」——mutation response 是契約的一部分
    expect(upd.lookIds).toEqual([lookA.id]);
    // #791 的不變式：造型的主人必須在鏡上——用自動綁定滿足，不是放鬆
    expect(upd.characterIds).toEqual([anjie.id]);
  });

  it("reload 後仍在：GET/list 與 mutation response 一致", async () => {
    const { scenes, shot, anjie, lookA } = await seed("讀回一致");
    const upd = await scenes.update({ sceneId: shot.id, lookIds: [lookA.id] });
    const list = await scenes.listByProject({ projectId: shot.projectId });
    const fresh = list.find((s: { id: string }) => s.id === shot.id)!;
    expect(fresh.lookIds).toEqual(upd.lookIds);
    expect(fresh.characterIds).toEqual(upd.characterIds);
    expect(fresh.lookIds).toEqual([lookA.id]);
    expect(fresh.characterIds).toEqual([anjie.id]);
  });

  it("主人已在鏡上時採用造型：characterIds 不動、不重複", async () => {
    const { project, scenes, anjie, lookA } = await seed("已綁角色");
    const [shot] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 2, title: "安潔特寫", characterIds: [anjie.id],
    }).returning();
    const upd = await scenes.update({ sceneId: shot.id, lookIds: [lookA.id] });
    expect(upd.lookIds).toEqual([lookA.id]);
    expect(upd.characterIds).toEqual([anjie.id]);
  });

  it("切換另一套造型：替換而非累加，角色不重複", async () => {
    const { scenes, shot, anjie, lookA, lookB } = await seed("切換造型");
    await scenes.update({ sceneId: shot.id, lookIds: [lookA.id] });
    const upd = await scenes.update({ sceneId: shot.id, lookIds: [lookB.id] });
    expect(upd.lookIds).toEqual([lookB.id]);
    expect(upd.characterIds).toEqual([anjie.id]);
  });

  it("移除造型（lookIds: []）→ null；已綁的角色留著", async () => {
    const { scenes, shot, anjie, lookA } = await seed("移除造型");
    await scenes.update({ sceneId: shot.id, lookIds: [lookA.id] });
    const upd = await scenes.update({ sceneId: shot.id, lookIds: [] });
    expect(upd.lookIds).toBeNull();
    // 移除造型≠移除角色：角色出場與否是另一個決定（setCards 的職權）
    expect(upd.characterIds).toEqual([anjie.id]);
  });

  it("重複的 lookIds 去重後寫入", async () => {
    const { scenes, shot, lookA } = await seed("去重");
    const upd = await scenes.update({ sceneId: shot.id, lookIds: [lookA.id, lookA.id] });
    expect(upd.lookIds).toEqual([lookA.id]);
  });

  it("跨專案的造型 fail-closed 拒絕，資料一個位元都不動", async () => {
    const a = await seed("跨專案A");
    const b = await seed("跨專案B");
    await expect(a.scenes.update({ sceneId: a.shot.id, lookIds: [b.lookA.id] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, a.shot.id));
    expect(fresh.lookIds).toBeNull();
    expect(fresh.characterIds).toBeNull();
  });

  it("不存在的造型拒絕", async () => {
    const { scenes, shot } = await seed("幽靈造型");
    await expect(scenes.update({ sceneId: shot.id, lookIds: [randomUUID()] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("檢視者（viewer）不能採用造型", async () => {
    const { project, groupId, shot, lookA } = await seed("檢視者");
    const viewerId = randomUUID();
    leftovers.users.push(viewerId);
    await db.insert(schema.users).values({
      id: viewerId, name: "Viewer", email: `viewer-${viewerId}@t.test`, passwordHash: "x",
    });
    await db.insert(schema.projectMembers).values({
      projectId: project.id, userId: viewerId, role: "viewer",
    });
    const viewerScenes = scenesRouter.createCaller({ auth: authFor(viewerId, groupId, "member") } as never);
    await expect(viewerScenes.update({ sceneId: shot.id, lookIds: [lookA.id] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.id));
    expect(fresh.lookIds).toBeNull();
  });

  it("自動綁定不能突破角色數上限", async () => {
    const { project, groupId, userId, scenes, shot, lookA } = await seed("角色上限");
    // 先塞滿上限（直接落庫：測的是 update 的守衛，不是塞滿的過程）
    const filler = await Promise.all(
      Array.from({ length: MAX_GENERATE_CHARACTERS }, (_, i) =>
        db.insert(schema.characters).values({
          projectId: project.id, groupId, name: `路人${i}`, appearance: "路人", createdBy: userId,
        }).returning().then((rows) => rows[0].id)),
    );
    await db.update(schema.scenes).set({ characterIds: filler }).where(eq(schema.scenes.id, shot.id));
    await expect(scenes.update({ sceneId: shot.id, lookIds: [lookA.id] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.id));
    expect(fresh.lookIds).toBeNull();
    expect(fresh.characterIds).toEqual(filler);
  });

  it("setCards 的矛盾指令仍拒絕：送了排除主人的 characterIds 又送他的造型", async () => {
    const { project, groupId, userId, scenes, shot, lookA } = await seed("矛盾指令");
    const [other] = await db.insert(schema.characters).values({
      projectId: project.id, groupId, name: "阿福", appearance: "橘白胖貓", createdBy: userId,
    }).returning();
    await expect(scenes.setCards({ sceneId: shot.id, characterIds: [other.id], lookIds: [lookA.id] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("generation context 讀得到採用的造型（continuity snapshot 帶 costume 錨點）", async () => {
    const { scenes, shot, anjie, lookA } = await seed("生成脈絡");
    const upd = await scenes.update({ sceneId: shot.id, lookIds: [lookA.id] });
    const snapshot = await buildContinuitySnapshot(shot.projectId, {
      characterIds: upd.characterIds ?? [],
      lookIds: upd.lookIds ?? [],
    });
    expect(snapshot).not.toBeNull();
    const character = snapshot!.characters.find((c) => c.id === anjie.id);
    expect(character).toBeDefined();
    expect(character).toMatchObject({ lookId: lookA.id, lookCostume: "俐落短髮、深色大衣" });
  });
});
