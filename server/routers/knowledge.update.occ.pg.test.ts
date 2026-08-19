/**
 * knowledge.update OCC: title/content writes fail-closed on baseline CAS.
 * No rev column — omitted baseline must not silent-LWW.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/routers/knowledge.update.occ.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import type { AuthState } from "../services/auth";
import { knowledgeRouter } from "./knowledge";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "kb", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

d("knowledge.update baseline CAS (real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[]; knowledge: string[] } = {
    users: [],
    projects: [],
    knowledge: [],
  };

  afterAll(async () => {
    for (const id of leftovers.knowledge) {
      await db.delete(schema.textVersions).where(eq(schema.textVersions.refId, id));
      await db.delete(schema.knowledge).where(eq(schema.knowledge.id, id));
    }
    for (const projectId of leftovers.projects) {
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  async function seed() {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "Kb", email: `kb-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "知識 OCC", kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);
    const kn = knowledgeRouter.createCaller({ auth: authFor(userId, groupId) } as never);
    const row = await kn.add({
      projectId: project.id,
      kind: "note",
      title: "原稿",
      content: "起點全文",
    });
    leftovers.knowledge.push(row.id);
    return { kn, row };
  }

  it("stale baseline cannot silent-LWW a newer knowledge body", async () => {
    const { kn, row } = await seed();
    const newer = await kn.update({
      id: row.id,
      content: "夥伴較新",
      baseline: { title: "原稿", content: "起點全文" },
    });
    expect(newer.content).toBe("夥伴較新");

    await expect(kn.update({
      id: row.id,
      content: "失焦舊稿",
      baseline: { title: "原稿", content: "起點全文" },
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const got = await kn.get({ id: row.id });
    expect(got.content).toBe("夥伴較新");
    expect(got.title).toBe("原稿");
  });

  it("omitting baseline on title/content refuses silent LWW", async () => {
    const { kn, row } = await seed();
    await expect(kn.update({
      id: row.id,
      content: "沒帶基準就寫",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    const got = await kn.get({ id: row.id });
    expect(got.content).toBe("起點全文");
  });

  it("pin-only without baseline does not rewrite a partner's newer body", async () => {
    const { kn, row } = await seed();
    await kn.update({
      id: row.id,
      content: "夥伴較新",
      baseline: { title: "原稿", content: "起點全文" },
    });
    const pinned = await kn.update({ id: row.id, pinned: true });
    expect(pinned.pinned).toBe(true);
    expect(pinned.content).toBe("夥伴較新");
  });
});
