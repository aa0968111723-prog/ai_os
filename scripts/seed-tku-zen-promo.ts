/**
 * Disposable LOCAL test project for the user-specified 60s 淡江禪學社 promo.
 * Only writes into 動畫組. Never production / never 總會短影音／動畫／卉庭.
 * No paid FAL. Asset files from D:\淡大劇本 are a follow-up if absent.
 *
 *   npx tsx scripts/seed-tku-zen-promo.ts
 */
import { and, eq } from "drizzle-orm";
import { db, schema, pool } from "../server/db";
import {
  TKU_ZEN_PROMO_KIND,
  TKU_ZEN_PROMO_PLATFORM,
  TKU_ZEN_PROMO_TITLE,
} from "../shared/fixtures/tkuZenPromo";
import {
  assertTkuZenPromoSnapshot,
  loadTkuZenPromoSnapshot,
  materializeTkuZenPromoContent,
} from "../server/services/tkuZenPromoProject";
import { markBootReady } from "../server/services/boot";

const FORBIDDEN_GROUPS = ["總會短影音", "動畫", "卉庭"];

markBootReady();

const email = process.env.SEED_ADMIN_EMAIL;
if (!email) throw new Error("SEED_ADMIN_EMAIL is required");
const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
if (!user) throw new Error(`找不到 ${email}`);

const [group] = await db.select({
  groupId: schema.groups.id,
  groupName: schema.groups.name,
  teamId: schema.groups.teamId,
  teamName: schema.teams.name,
}).from(schema.groups)
  .innerJoin(schema.teams, eq(schema.teams.id, schema.groups.teamId))
  .where(eq(schema.groups.name, "動畫組"));
if (!group) throw new Error("找不到動畫組");
if (FORBIDDEN_GROUPS.includes(group.groupName)) {
  throw new Error(`拒絕寫入正式組「${group.groupName}」`);
}

const [existingMembership] = await db.select().from(schema.groupMembers).where(and(
  eq(schema.groupMembers.userId, user.id),
  eq(schema.groupMembers.groupId, group.groupId),
));
if (!existingMembership) {
  await db.insert(schema.groupMembers).values({
    userId: user.id,
    groupId: group.groupId,
    role: "leader",
  });
}

const stale = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(
  eq(schema.projects.groupId, group.groupId),
  eq(schema.projects.title, TKU_ZEN_PROMO_TITLE),
));
for (const row of stale) {
  await db.delete(schema.scenes).where(eq(schema.scenes.projectId, row.id));
  await db.delete(schema.storyScenes).where(eq(schema.storyScenes.projectId, row.id));
  await db.delete(schema.stories).where(eq(schema.stories.projectId, row.id));
  await db.delete(schema.characterLooks).where(eq(schema.characterLooks.projectId, row.id));
  await db.delete(schema.characters).where(eq(schema.characters.projectId, row.id));
  await db.delete(schema.props).where(eq(schema.props.projectId, row.id));
  await db.delete(schema.scenePresets).where(eq(schema.scenePresets.projectId, row.id));
  await db.delete(schema.projects).where(eq(schema.projects.id, row.id));
}

const [project] = await db.insert(schema.projects).values({
  groupId: group.groupId,
  ownerId: user.id,
  title: TKU_ZEN_PROMO_TITLE,
  kind: TKU_ZEN_PROMO_KIND,
  platform: TKU_ZEN_PROMO_PLATFORM,
  format: "9:16",
}).returning({ id: schema.projects.id });

await materializeTkuZenPromoContent({
  userId: user.id,
  projectId: project.id,
  groupId: group.groupId,
});

const snap = await loadTkuZenPromoSnapshot(project.id);
assertTkuZenPromoSnapshot(snap);
const again = await loadTkuZenPromoSnapshot(project.id);
assertTkuZenPromoSnapshot(again);

console.log(JSON.stringify({
  ok: true,
  projectId: project.id,
  title: TKU_ZEN_PROMO_TITLE,
  group: group.groupName,
  characters: snap.characters.map((c) => c.name),
  props: snap.props.map((p) => p.name),
  acts: snap.acts.length,
  shots: snap.shots.length,
  assetImport: "follow-up — D:\\\\淡大劇本 not required on this VM",
}, null, 2));

await pool.end();
