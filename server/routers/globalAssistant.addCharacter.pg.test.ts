/**
 * Global assistant add_character writes 角色, not 素材清單, on unparsed projects.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/routers/globalAssistant.addCharacter.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import type { AuthState } from "../services/auth";
import { XIAOHUA_LOCKED_APPEARANCE } from "../../shared/characterIdentityLock";
import { PENDING_CHARACTER_APPEARANCE } from "../../shared/assistantCharacterPropose";
import { runSiteActionCore } from "./globalAssistant";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "site-char", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

d("global assistant add_character (real PostgreSQL)", () => {
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

  it("unparsed project (no stories row) still writes characters count=1; 素材清單 unchanged", async () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "SiteChar", email: `site-char-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-unparsed-xiaohua", kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);

    const stories = await db.select().from(schema.stories).where(eq(schema.stories.projectId, project.id));
    expect(stories).toHaveLength(0);
    const beforeChars = await db.select().from(schema.characters).where(eq(schema.characters.projectId, project.id));
    expect(beforeChars).toHaveLength(0);

    const result = await runSiteActionCore(authFor(userId, groupId), {
      type: "add_character",
      groupId,
      projectId: project.id,
      name: "小華",
      appearance: PENDING_CHARACTER_APPEARANCE,
    });
    expect(result.type).toBe("add_character");
    expect(result.verification.status).toBe("verified");
    if (result.type !== "add_character") return;
    expect(result.name).toBe("小華");
    expect(result.reused).toBe(false);

    const rows = await db.select().from(schema.characters).where(eq(schema.characters.projectId, project.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("小華");
    expect(rows[0]!.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
    expect(rows[0]!.appearance).toContain("粉橘短髮女孩");
    expect(rows[0]!.id).toBe(result.characterId);
  });
});
