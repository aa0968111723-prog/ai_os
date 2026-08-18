/**
 * Project assistant add_character: ask emits a confirm card, runAction writes the row.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/routers/assistant.addCharacter.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import type { AuthState } from "../services/auth";
import { PENDING_CHARACTER_APPEARANCE, proposeAddCharacterActions } from "../../shared/assistantCharacterPropose";
import { XIAOHUA_LOCKED_APPEARANCE } from "../../shared/characterIdentityLock";
import { assistantRouter } from "./assistant";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "char-ask", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

d("project assistant add_character (real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.characters).where(eq(schema.characters.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it("editor ask「新增角色 小華」emits a confirm card; runAction inserts count=1", async () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "CharAsk", email: `char-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-add-character", kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);

    const cards = proposeAddCharacterActions("新增角色 小華");
    expect(cards).toEqual([
      { type: "add_character", name: "小華", appearance: XIAOHUA_LOCKED_APPEARANCE },
    ]);

    const assistant = assistantRouter.createCaller({ auth: authFor(userId, groupId) } as never);
    const before = await db.select().from(schema.characters).where(eq(schema.characters.projectId, project.id));
    expect(before).toHaveLength(0);

    const result = await assistant.runAction({
      projectId: project.id,
      action: { type: "add_character", name: cards[0]!.name, appearance: PENDING_CHARACTER_APPEARANCE },
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("add_character");
    expect("verification" in result && result.verification?.status).toBe("verified");
    expect("verificationMethod" in result && result.verificationMethod).toBe("authoritative_character_row_read_back");
    if (result.kind !== "add_character") return;
    expect(result.name).toBe("小華");
    expect(result.reused).toBe(false);

    const rows = await db.select().from(schema.characters).where(eq(schema.characters.projectId, project.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("小華");
    expect(rows[0]!.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
    expect(rows[0]!.appearance).toContain("粉橘短髮女孩");
    expect(rows[0]!.id).toBe(result.characterId);

    const maleWrite = await assistant.runAction({
      projectId: project.id,
      action: { type: "add_character", name: "小華", appearance: "年輕男性" },
    });
    expect(maleWrite.ok).toBe(true);
    if (maleWrite.kind !== "add_character") return;
    expect(maleWrite.reused).toBe(true);
    const after = await db.select().from(schema.characters).where(eq(schema.characters.projectId, project.id));
    expect(after).toHaveLength(1);
    expect(after[0]!.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
    expect(after[0]!.appearance).not.toContain("年輕男性");
  });

  it("same-name 年輕男性 card still gets a confirm; confirm updates that row to 粉橘短髮女孩", async () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "CharReuse", email: `char-reuse-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-add-character-reuse", kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);
    await db.insert(schema.characters).values({
      projectId: project.id,
      groupId,
      name: "小華",
      appearance: "年輕男性",
      createdBy: userId,
    });
    await db.insert(schema.characters).values({
      projectId: project.id,
      groupId,
      name: "禪定龜龜",
      appearance: "綠色烏龜",
      createdBy: userId,
    });

    const message = "新增角色 小華 粉橘短髮女孩、大二化工";
    const existing = [{ name: "小華", appearance: "年輕男性" }, { name: "禪定龜龜", appearance: "綠色烏龜" }];
    const cards = proposeAddCharacterActions(message, existing);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.name).toBe("小華");
    expect(cards[0]!.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);

    const assistant = assistantRouter.createCaller({ auth: authFor(userId, groupId) } as never);
    const result = await assistant.runAction({
      projectId: project.id,
      action: { type: "add_character", name: "小華", appearance: "年輕男性" },
    });
    expect(result.ok).toBe(true);
    if (result.kind !== "add_character") return;
    expect(result.reused).toBe(true);
    expect(result.message).toContain("已更新角色");

    const rows = await db.select().from(schema.characters).where(eq(schema.characters.projectId, project.id));
    expect(rows).toHaveLength(2);
    const xiaohua = rows.find((row) => row.name === "小華");
    expect(xiaohua?.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
    expect(xiaohua?.appearance).toContain("粉橘短髮女孩");
    expect(xiaohua?.appearance).not.toContain("年輕男性");
  });
});
