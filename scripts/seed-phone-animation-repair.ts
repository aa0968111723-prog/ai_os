import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema, pool } from "../server/db";
import { emptyEvaluationDimensions } from "../shared/animationEvaluation";

const email = process.env.SEED_ADMIN_EMAIL || "admin@aidirector.local";
const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
if (!user) throw new Error(`找不到 ${email}`);
const [group] = await db.select({
  groupId: schema.groups.id,
  groupName: schema.groups.name,
}).from(schema.groups).where(eq(schema.groups.name, "動畫組"));
if (!group) throw new Error("找不到動畫組");
const [membership] = await db.select().from(schema.groupMembers).where(and(
  eq(schema.groupMembers.userId, user.id),
  eq(schema.groupMembers.groupId, group.groupId),
));
if (!membership) {
  await db.insert(schema.groupMembers).values({ userId: user.id, groupId: group.groupId, role: "leader" });
}

const title = "手機動畫修復閉環";
const [existing] = await db.select({ id: schema.projects.id }).from(schema.projects)
  .where(and(eq(schema.projects.ownerId, user.id), eq(schema.projects.title, title)));
const projectId = existing?.id ?? randomUUID();
if (!existing) {
  await db.insert(schema.projects).values({
    id: projectId,
    groupId: group.groupId,
    ownerId: user.id,
    title,
    kind: "animation",
    platform: "youtube",
    format: "9:16",
  });
}

const [image] = await db.insert(schema.assets).values({
  projectId,
  groupId: group.groupId,
  kind: "image",
  title: "現用畫面",
  url: "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#8d6e63"/><text x="160" y="96" text-anchor="middle" fill="white" font-size="22">現用</text></svg>`),
}).returning({ id: schema.assets.id });

await db.delete(schema.generationConsistencyEvaluations).where(eq(schema.generationConsistencyEvaluations.projectId, projectId));
await db.delete(schema.generations).where(eq(schema.generations.projectId, projectId));
await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));

const shots = await db.insert(schema.scenes).values([
  { projectId, orderIndex: 3, title: "Shot 04", prompt: "人物站在橋上", assetId: image.id },
  { projectId, orderIndex: 4, title: "Shot 05", prompt: "把藏寶圖換到右手", assetId: image.id },
  { projectId, orderIndex: 7, title: "Shot 08", prompt: "黃昏畫風", assetId: image.id },
]).returning({ id: schema.scenes.id, title: schema.scenes.title });

const rows = [
  { code: "identity_drift", dimension: "identity" as const, reason: "人物外觀偏移" },
  { code: "hand_swap", dimension: "physics" as const, reason: "左右手持物與上一鏡不一致" },
  { code: "style_drift", dimension: "style" as const, reason: "畫風陰影偏離目前 Style" },
];

for (const [index, shot] of shots.entries()) {
  const generationId = randomUUID();
  await db.insert(schema.generations).values({
    id: generationId,
    projectId,
    groupId: group.groupId,
    userId: user.id,
    modelId: "fal-ai/flux/dev",
    kind: "image",
    status: "done",
    prompt: shot.title,
    sceneId: shot.id,
  });
  const dimensions = emptyEvaluationDimensions();
  dimensions[rows[index]!.dimension] = {
    status: "finding",
    confidence: "high",
    summary: rows[index]!.reason,
    evidenceSourceIds: [],
  };
  await db.insert(schema.generationConsistencyEvaluations).values({
    projectId,
    groupId: group.groupId,
    shotId: shot.id,
    generationId,
    candidateAssetId: image.id,
    packetId: randomUUID(),
    evaluatorProvider: "structural",
    evaluatorVersion: "animation-structural.v1",
    evidenceFingerprint: `phone-repair-${index}`,
    result: {
      schemaVersion: "animation-consistency-evaluation.v1",
      generationId,
      shotId: shot.id,
      evaluatorVersion: "animation-structural.v1",
      evidenceFingerprint: `phone-repair-${index}`,
      visualCheckStatus: index === 2 ? "not_checked" : "completed",
      dimensions,
      recommendation: "repair",
      findings: [{
        code: rows[index]!.code,
        dimension: rows[index]!.dimension,
        severity: rows[index]!.dimension === "physics" ? "blocker" : "warning",
        confidence: "high",
        reason: rows[index]!.reason,
        evidenceSourceIds: [],
      }],
    },
  });
}

console.log(JSON.stringify({ projectId, title, email }, null, 2));
await pool.end();
