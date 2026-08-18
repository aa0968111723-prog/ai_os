/**
 * Disposable LOCAL 淡江禪學社 fixture — 動畫組 only.
 * Six SHOTLIST lines. 小華 + 禪定龜龜 only. No paid FAL. No live groups.
 * Uses canonical tables directly (services must not import routers).
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  TKU_ZEN_CHARACTERS,
  TKU_ZEN_LOCATIONS,
  TKU_ZEN_LOOKS,
  TKU_ZEN_PROMO_SCRIPT,
  TKU_ZEN_PROMO_TITLE,
  TKU_ZEN_SHOTLIST_LINES,
  TKU_ZEN_SHOTS,
  TKU_ZEN_WORLDVIEW,
  tkuZenDialogueLines,
  tkuZenHasForbidden,
  tkuZenLibraryMapContent,
} from "../../shared/fixtures/tkuZenPromo";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";

export { TKU_ZEN_PROMO_TITLE };

export async function materializeTkuZenPromoContent(input: {
  userId: string;
  projectId: string;
  groupId: string;
}) {
  await db.update(schema.projects).set({
    worldview: worldviewSchema.parse(TKU_ZEN_WORLDVIEW),
    updatedAt: new Date(),
  }).where(eq(schema.projects.id, input.projectId));

  const [existingStory] = await db.select({ id: schema.stories.id }).from(schema.stories)
    .where(eq(schema.stories.projectId, input.projectId));
  if (existingStory) {
    await db.update(schema.stories).set({
      content: TKU_ZEN_PROMO_SCRIPT,
      updatedBy: input.userId,
      updatedAt: new Date(),
    }).where(eq(schema.stories.id, existingStory.id));
  } else {
    await db.insert(schema.stories).values({
      projectId: input.projectId,
      groupId: input.groupId,
      content: TKU_ZEN_PROMO_SCRIPT,
      updatedBy: input.userId,
    });
  }

  const characterIds: Record<string, string> = {};
  for (const card of TKU_ZEN_CHARACTERS) {
    const [row] = await db.insert(schema.characters).values({
      projectId: input.projectId,
      groupId: input.groupId,
      name: card.name,
      appearance: card.appearance,
      notes: card.notes,
      createdBy: input.userId,
    }).returning({ id: schema.characters.id });
    characterIds[card.key] = row.id;
  }

  const lookIdsByCharacter: Record<string, string[]> = {};
  for (const look of TKU_ZEN_LOOKS) {
    const characterId = characterIds[look.character];
    if (!characterId) continue;
    const [row] = await db.insert(schema.characterLooks).values({
      projectId: input.projectId,
      groupId: input.groupId,
      characterId,
      name: look.name,
      costume: look.costume,
      notes: look.notes,
      source: "manual",
      createdBy: input.userId,
    }).returning({ id: schema.characterLooks.id });
    (lookIdsByCharacter[look.character] ??= []).push(row.id);
  }

  await db.insert(schema.knowledge).values([
    {
      projectId: input.projectId,
      groupId: input.groupId,
      kind: "script",
      title: "淡江禪學社 SHOTLIST",
      content: TKU_ZEN_PROMO_SCRIPT,
      pinned: true,
      createdBy: input.userId,
    },
    {
      projectId: input.projectId,
      groupId: input.groupId,
      kind: "note",
      title: "D:\\淡大劇本 素材對照（本機路徑，不呼叫付費 FAL）",
      content: tkuZenLibraryMapContent(),
      pinned: true,
      createdBy: input.userId,
    },
  ]);

  const locationIds: Record<string, string> = {};
  for (const loc of TKU_ZEN_LOCATIONS) {
    const [row] = await db.insert(schema.scenePresets).values({
      projectId: input.projectId,
      groupId: input.groupId,
      name: loc.name,
      palette: loc.palette,
      lighting: loc.lighting,
      createdBy: input.userId,
    }).returning({ id: schema.scenePresets.id });
    locationIds[loc.key] = row.id;
  }

  const [act] = await db.insert(schema.storyScenes).values({
    projectId: input.projectId,
    orderIndex: 1,
    title: "淡江禪學社・小華",
    summary: "150s SHOTLIST fallback",
    storyExcerpt: TKU_ZEN_SHOTLIST_LINES.join("\n"),
    locationId: locationIds.slope,
    environment: { timeOfDay: "day", notes: "SHOTLIST" },
  }).returning({ id: schema.storyScenes.id });

  const shotIds: string[] = [];
  for (const spec of TKU_ZEN_SHOTS) {
    const boundChars = spec.characters
      .map((key) => characterIds[key])
      .filter((id): id is string => Boolean(id));
    const locationId = locationIds[spec.location];
    const boundLooks = [...new Set(spec.characters.flatMap((key) => lookIdsByCharacter[key] ?? []))];
    const [row] = await db.insert(schema.scenes).values({
      projectId: input.projectId,
      orderIndex: spec.index,
      title: spec.title,
      durationSec: spec.durationSec,
      status: "todo",
      prompt: spec.prompt,
      dialogue: spec.dialogue,
      action: spec.action,
      storySceneId: act.id,
      characterIds: boundChars,
      scenePresetIds: locationId ? [locationId] : [],
      lookIds: boundLooks.length ? boundLooks : null,
    }).returning({ id: schema.scenes.id });
    shotIds.push(row.id);
  }

  return { characterIds, locationIds, actId: act.id, shotIds };
}

export async function loadTkuZenPromoSnapshot(projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
  const characters = await db.select().from(schema.characters).where(eq(schema.characters.projectId, projectId));
  const props = await db.select().from(schema.props).where(eq(schema.props.projectId, projectId));
  const presets = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.projectId, projectId));
  const acts = await db.select().from(schema.storyScenes).where(eq(schema.storyScenes.projectId, projectId));
  const shots = await db.select().from(schema.scenes).where(and(
    eq(schema.scenes.projectId, projectId),
    isNull(schema.scenes.deletedAt),
  ));
  const looks = await db.select().from(schema.characterLooks).where(eq(schema.characterLooks.projectId, projectId));
  const knowledge = await db.select().from(schema.knowledge).where(and(
    eq(schema.knowledge.projectId, projectId),
    isNull(schema.knowledge.deletedAt),
  ));
  return { project, story, characters, props, presets, acts, shots, looks, knowledge };
}

export function assertTkuZenPromoSnapshot(snap: Awaited<ReturnType<typeof loadTkuZenPromoSnapshot>>) {
  if (!snap.project) throw new Error("project missing");
  if (!snap.story?.content.includes(TKU_ZEN_SHOTLIST_LINES[0])) throw new Error("SHOTLIST script did not persist");
  const names = snap.characters.map((c) => c.name).sort();
  if (names.join() !== ["小華", "禪定龜龜"].sort().join()) {
    throw new Error(`characters mismatch: ${names.join(",")}`);
  }
  if (snap.characters.length !== 2) throw new Error("only 小華 + 禪定龜龜 allowed");
  if (snap.props.length !== 0) throw new Error("fixture must not invent props");
  if (snap.acts.length !== 1) throw new Error(`expected 1 scene, got ${snap.acts.length}`);
  if (snap.shots.length !== 6) throw new Error(`expected 6 SHOTLIST shots, got ${snap.shots.length}`);

  const xiaohua = snap.characters.find((c) => c.name === "小華");
  const turtle = snap.characters.find((c) => c.name === "禪定龜龜");
  if (!xiaohua || !turtle) throw new Error("core cards missing");
  if (!xiaohua.appearance.includes("大二化工") || !xiaohua.appearance.includes("白帽T") || !xiaohua.appearance.includes("短髮")) {
    throw new Error("小華 appearance lost 大二化工／白帽T／短髮");
  }
  if (!xiaohua.appearance.includes("粉橘短髮")) throw new Error("小華 appearance lost 粉橘短髮 visual lock");
  if (!turtle.appearance.includes("吉祥物龜龜")) throw new Error("龜龜 appearance lost 吉祥物龜龜 lock");
  if (!snap.presets.some((p) => p.name === "克難坡")) throw new Error("克難坡 preset missing");
  if (snap.looks.length !== TKU_ZEN_LOOKS.length) {
    throw new Error(`expected ${TKU_ZEN_LOOKS.length} looks, got ${snap.looks.length}`);
  }
  if (!snap.looks.some((look) => (look.notes ?? "").includes("pink_bob_girl_threeview_v01.png"))) {
    throw new Error("小華 threeview library path not pinned on a look");
  }
  if (!snap.knowledge.some((row) => row.kind === "script" && row.content.includes(TKU_ZEN_SHOTLIST_LINES[0]))) {
    throw new Error("script knowledge missing");
  }
  if (!snap.knowledge.some((row) => (row.content ?? "").includes(String.raw`角色圖\粉橘短髮女孩`))) {
    throw new Error("library map knowledge missing");
  }

  const orderedShots = [...snap.shots].sort((a, b) => a.orderIndex - b.orderIndex);
  const spoken = tkuZenDialogueLines(orderedShots.map((s) => ({ dialogue: s.dialogue ?? "" })));
  if (spoken.join("\n") !== [...TKU_ZEN_SHOTLIST_LINES].join("\n")) {
    throw new Error(`dialogue drifted from SHOTLIST: ${spoken.join(" | ")}`);
  }

  const blob = [
    snap.story.content,
    ...snap.characters.map((c) => `${c.name}\n${c.appearance}\n${c.notes ?? ""}`),
    ...orderedShots.map((s) => `${s.title}\n${s.prompt ?? ""}\n${s.dialogue ?? ""}\n${s.action ?? ""}`),
  ].join("\n");
  const forbidden = tkuZenHasForbidden(blob);
  if (forbidden.length) throw new Error(`forbidden tokens persisted: ${forbidden.join(",")}`);

  const xiaohuaLookIds = snap.looks.filter((look) => look.characterId === xiaohua.id).map((look) => look.id);
  const turtleLookIds = snap.looks.filter((look) => look.characterId === turtle.id).map((look) => look.id);
  for (const shot of orderedShots) {
    if ((shot.characterIds ?? []).includes(xiaohua.id)
      && !xiaohuaLookIds.every((id) => (shot.lookIds ?? []).includes(id))) {
      throw new Error(`shot ${shot.title} missing 小華 lookIds`);
    }
    if ((shot.characterIds ?? []).includes(turtle.id)
      && !turtleLookIds.every((id) => (shot.lookIds ?? []).includes(id))) {
      throw new Error(`shot ${shot.title} missing 龜龜 lookIds`);
    }
  }

  if (orderedShots.slice(0, 2).some((s) => (s.characterIds ?? []).includes(turtle.id))) {
    throw new Error("龜龜 bound before SHOTLIST line 3");
  }
}
