import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema, pool } from "../server/db";
import type { AuthState } from "../server/services/auth";
import { freezeShotContextPacket } from "../server/services/shotContextPackets";

const email = process.env.SEED_ADMIN_EMAIL || "admin@aidirector.local";
const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
if (!user) throw new Error(`找不到 ${email}`);
const [membership] = await db.select({
  groupId: schema.groupMembers.groupId,
  role: schema.groupMembers.role,
  groupName: schema.groups.name,
  teamId: schema.groups.teamId,
  teamName: schema.teams.name,
}).from(schema.groupMembers)
  .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
  .innerJoin(schema.teams, eq(schema.teams.id, schema.groups.teamId))
  .where(and(eq(schema.groupMembers.userId, user.id), eq(schema.groups.name, "動畫組")));
if (!membership) throw new Error("找不到動畫組 membership");

const auth: AuthState = {
  user: {
    id: user.id,
    name: user.name,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
    mustChangePassword: user.mustChangePassword,
  },
  groups: [{
    groupId: membership.groupId,
    groupName: membership.groupName,
    teamId: membership.teamId,
    teamName: membership.teamName,
    role: membership.role,
  }],
  adminTeamIds: [],
};

const projectId = randomUUID();
await db.insert(schema.projects).values({
  id: projectId,
  groupId: membership.groupId,
  ownerId: user.id,
  title: `動畫連貫審查證據 ${Date.now() % 100000}`,
  kind: "animation",
  platform: "youtube",
  format: "16:9",
  worldview: { styles: ["手繪水彩"], taboos: ["文字浮水印"] },
});
const [character] = await db.insert(schema.characters).values({
  projectId,
  groupId: membership.groupId,
  name: "小蓮",
  appearance: "六歲女孩、齊瀏海黑色短髮、紅色雨衣",
  createdBy: user.id,
}).returning({ id: schema.characters.id });
const [prop] = await db.insert(schema.props).values({
  projectId,
  groupId: membership.groupId,
  name: "紅燈籠",
  appearance: "紅紙、金色流蘇、正面福字",
  ownerKind: "character",
  ownerId: character.id,
  createdBy: user.id,
}).returning({ id: schema.props.id });

const svg = (label: string, color: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="${color}"/><circle cx="320" cy="175" r="88" fill="#f7d7b5"/><path d="M250 155h140v130H250z" fill="#b7353b"/><text x="320" y="325" text-anchor="middle" font-size="28" fill="white">${label}</text></svg>`,
)}`;
const assets = await db.insert(schema.assets).values([
  { projectId, groupId: membership.groupId, kind: "image", title: "上一鏡", url: svg("上一鏡", "#24334f"), uploadedBy: user.id },
  { projectId, groupId: membership.groupId, kind: "image", title: "目前鏡", url: svg("目前鏡", "#5d426e"), uploadedBy: user.id },
  { projectId, groupId: membership.groupId, kind: "image", title: "下一鏡", url: svg("下一鏡", "#2f6550"), uploadedBy: user.id },
]).returning({ id: schema.assets.id });
const shots = await db.insert(schema.scenes).values([
  {
    projectId, title: "鏡1・走入老街", orderIndex: 0, durationSec: 4,
    prompt: "小蓮提著紅燈籠往畫面右側走", action: "往右走",
    characterIds: [character.id], propIds: [prop.id], assetId: assets[0]!.id, reviewStatus: "approved",
  },
  {
    projectId, title: "鏡2・燈籠換手需確認", orderIndex: 1, durationSec: 4,
    prompt: "小蓮在老街中央停下", action: "停下並舉起燈籠",
    characterIds: [character.id], propIds: [prop.id], assetId: assets[1]!.id, reviewStatus: "changes",
  },
  {
    projectId, title: "鏡3・繼續前進", orderIndex: 2, durationSec: 4,
    prompt: "小蓮繼續往畫面右側前進", action: "往右走",
    characterIds: [character.id], propIds: [prop.id], assetId: assets[2]!.id, reviewStatus: "approved",
  },
]).returning({ id: schema.scenes.id });

await freezeShotContextPacket({
  auth,
  projectId,
  shotId: shots[1]!.id,
  modelId: "fal-ai/nano-banana-2/edit",
});
await db.update(schema.shotContextPacketHeads).set({
  stale: true,
  staleReason: "角色造型上游設定已變更",
  updatedAt: new Date(),
}).where(eq(schema.shotContextPacketHeads.shotId, shots[1]!.id));

console.log(JSON.stringify({ projectId, reviewShotId: shots[1]!.id }));
await pool.end();

