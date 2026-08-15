/**
 * Cross-team ACL + recheck idempotency against real PostgreSQL.
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/services/commercialRights.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { evaluateAndStoreAssetRights, getAssetRights } from "./commercialRights";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "t", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "t", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  } as AuthState;
}

async function seed() {
  const userId = randomUUID();
  const groupId = randomUUID();
  await db.insert(schema.users).values({
    id: userId, name: "rights", email: `${userId}@t.test`, passwordHash: "x",
  });
  const [project] = await db.insert(schema.projects).values({
    groupId, ownerId: userId, title: "rights", kind: "video", platform: "test", format: "16:9",
  }).returning();
  const [asset] = await db.insert(schema.assets).values({
    projectId: project!.id,
    groupId,
    kind: "image",
    title: "自有風景",
    url: "/x.jpg",
    uploadedBy: userId,
  }).returning();
  return { userId, groupId, project: project!, asset: asset! };
}

d("commercial rights persistence (PostgreSQL)", () => {
  it("19. refuses another group's asset and 20. recheck is idempotent", async () => {
    const mine = await seed();
    const first = await evaluateAndStoreAssetRights({
      auth: authFor(mine.userId, mine.groupId),
      assetId: mine.asset.id,
      ownerClaim: { ownsOrLicensed: true, note: "我拍的" },
      trigger: "intake",
    });
    const second = await evaluateAndStoreAssetRights({
      auth: authFor(mine.userId, mine.groupId),
      assetId: mine.asset.id,
      ownerClaim: { ownsOrLicensed: true, note: "我拍的" },
      trigger: "recheck",
    });
    expect(first.profile.rightsStatus).toBe("CLEAR");
    expect(second.reused).toBe(true);

    const other = await seed();
    await expect(getAssetRights({
      auth: authFor(other.userId, other.groupId),
      assetId: mine.asset.id,
    })).rejects.toBeInstanceOf(TRPCError);

    const checks = await db.select().from(schema.assetRightsChecks).where(eq(schema.assetRightsChecks.assetId, mine.asset.id));
    expect(checks).toHaveLength(1);
  });
});
