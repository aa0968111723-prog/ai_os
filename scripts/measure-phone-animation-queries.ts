/**
 * One-shot 20/100/300-shot query bound for phone.animationSummary.
 * Reuses animationProductionBoard — no per-shot N+1.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, schema, pool } from "../server/db";
import type { AuthState } from "../server/services/auth";
import { phoneAnimationSummary } from "../server/services/phoneAnimation";
import { animationProductionBoard } from "../server/services/animationBoard";

const groupId = randomUUID();
const userId = randomUUID();
const projectId = randomUUID();
const auth: AuthState = {
  user: { id: userId, name: "measure", email: "measure@example.test", isSuperAdmin: false, mustChangePassword: false },
  groups: [{ groupId, groupName: "動畫組", teamId: randomUUID(), teamName: "t", role: "leader" }],
  adminTeamIds: [],
};

await db.insert(schema.projects).values({
  id: projectId,
  groupId,
  ownerId: userId,
  title: "phone-query-bound",
  kind: "animation",
  platform: "test",
  format: "9:16",
});
const [image] = await db.insert(schema.assets).values({
  projectId, groupId, kind: "image", title: "cur", url: "https://example.test/cur.png",
}).returning({ id: schema.assets.id });
await db.insert(schema.scenes).values(Array.from({ length: 300 }, (_, index) => ({
  projectId,
  title: `鏡 ${index + 1}`,
  orderIndex: index,
  prompt: `shot ${index + 1}`,
  assetId: image.id,
})));

const rows = [];
for (const size of [20, 100, 300]) {
  const extra = (await db.select({ id: schema.scenes.id }).from(schema.scenes)
    .where(eq(schema.scenes.projectId, projectId)))
    .slice(size)
    .map((row) => row.id);
  if (extra.length) {
    await db.update(schema.scenes).set({ deletedAt: new Date() }).where(inArray(schema.scenes.id, extra));
  }
  const boardLabels: string[] = [];
  const phoneLabels: string[] = [];
  const boardStarted = performance.now();
  const board = await animationProductionBoard({
    auth,
    projectId,
    onQuery: (label) => boardLabels.push(label),
  });
  const boardMs = Math.round(performance.now() - boardStarted);
  const phoneStarted = performance.now();
  const summary = await phoneAnimationSummary({
    auth,
    projectId,
    onQuery: (label) => phoneLabels.push(label),
  });
  const phoneMs = Math.round(performance.now() - phoneStarted);
  rows.push({
    shots: size,
    boardRows: board.rows.length,
    boardQueries: boardLabels.length,
    boardUnique: new Set(boardLabels).size,
    boardMs,
    phoneNeedsReview: summary.counts.needsReview,
    phoneQueries: phoneLabels.length,
    phoneUnique: new Set(phoneLabels).size,
    phoneMs,
    boardLabels,
    phoneLabels,
  });
  if (extra.length) {
    await db.update(schema.scenes).set({ deletedAt: null }).where(inArray(schema.scenes.id, extra));
  }
}

await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
await pool.end();

console.log(JSON.stringify({ ok: rows.every((row) => row.boardUnique <= 6 && row.phoneUnique <= 6), rows }, null, 2));
