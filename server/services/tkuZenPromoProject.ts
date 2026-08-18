/**
 * Disposable LOCAL 淡江禪學社 fixture — 動畫組 only.
 * Builds from the user-specified script text. No paid FAL. No live groups.
 * Uses canonical tables directly (services must not import routers).
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  TKU_ZEN_ACTS,
  TKU_ZEN_CHARACTERS,
  TKU_ZEN_LOCATIONS,
  TKU_ZEN_PROMO_SCRIPT,
  TKU_ZEN_PROMO_TITLE,
  TKU_ZEN_PROPS,
  TKU_ZEN_SHOTS,
  TKU_ZEN_WORLDVIEW,
  tkuZenMissingBeats,
  tkuZenTimeOrderOk,
  tkuZenTurtleActs,
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

  const propIds: Record<string, string> = {};
  for (const prop of TKU_ZEN_PROPS) {
    const [row] = await db.insert(schema.props).values({
      projectId: input.projectId,
      groupId: input.groupId,
      name: prop.name,
      appearance: prop.appearance,
      createdBy: input.userId,
    }).returning({ id: schema.props.id });
    propIds[prop.key] = row.id;
  }

  const actIds: Record<number, string> = {};
  for (const act of TKU_ZEN_ACTS) {
    const [row] = await db.insert(schema.storyScenes).values({
      projectId: input.projectId,
      orderIndex: act.act,
      title: act.title,
      summary: `${act.startSec}–${act.endSec}s`,
      storyExcerpt: act.excerpt,
      locationId: locationIds[act.location],
      environment: { timeOfDay: act.timeOfDay, notes: act.title },
    }).returning({ id: schema.storyScenes.id });
    actIds[act.act] = row.id;
  }

  const shotIds: string[] = [];
  let orderIndex = 0;
  for (const spec of TKU_ZEN_SHOTS) {
    orderIndex += 1;
    const boundChars = spec.characters
      .map((key) => characterIds[key])
      .filter((id): id is string => Boolean(id));
    const boundProps = spec.props
      .map((key) => propIds[key])
      .filter((id): id is string => Boolean(id));
    const locationId = locationIds[spec.location];
    const [row] = await db.insert(schema.scenes).values({
      projectId: input.projectId,
      orderIndex,
      title: spec.title,
      durationSec: spec.durationSec,
      status: "todo",
      prompt: spec.prompt,
      voiceover: spec.voiceover || undefined,
      dialogue: spec.dialogue || undefined,
      action: spec.action,
      storySceneId: actIds[spec.act],
      characterIds: boundChars,
      propIds: boundProps,
      scenePresetIds: locationId ? [locationId] : [],
    }).returning({ id: schema.scenes.id });
    shotIds.push(row.id);
  }

  return { characterIds, locationIds, propIds, actIds, shotIds };
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
  return { project, story, characters, props, presets, acts, shots };
}

export function assertTkuZenPromoSnapshot(snap: Awaited<ReturnType<typeof loadTkuZenPromoSnapshot>>) {
  if (!snap.project) throw new Error("project missing");
  if (!snap.story?.content.includes("小華——！起床啦！")) throw new Error("script did not persist");
  const names = snap.characters.map((c) => c.name).sort();
  if (names.join() !== ["媽媽", "小華", "禪定龜龜"].sort().join()) {
    throw new Error(`characters mismatch: ${names.join(",")}`);
  }
  const propNames = snap.props.map((p) => p.name);
  for (const need of ["行李箱", "手機", "床", "坡"]) {
    if (!propNames.includes(need)) throw new Error(`missing prop ${need}`);
  }
  if (snap.acts.length !== 7) throw new Error(`expected 7 acts, got ${snap.acts.length}`);
  if (snap.shots.length !== TKU_ZEN_SHOTS.length) {
    throw new Error(`expected ${TKU_ZEN_SHOTS.length} shots, got ${snap.shots.length}`);
  }
  if (tkuZenMissingBeats().length) throw new Error("fixture beats missing");
  if (!tkuZenTimeOrderOk()) throw new Error("time of day inverted");
  if (tkuZenTurtleActs().some((act) => act < 4)) throw new Error("turtle appears before act 4");

  const xiaohua = snap.characters.find((c) => c.name === "小華");
  const turtle = snap.characters.find((c) => c.name === "禪定龜龜");
  const suitcase = snap.props.find((p) => p.name === "行李箱");
  const phone = snap.props.find((p) => p.name === "手機");
  if (!xiaohua || !turtle || !suitcase || !phone) throw new Error("core cards missing");

  const orderedShots = [...snap.shots].sort((a, b) => a.orderIndex - b.orderIndex);
  const turtleShotActs = orderedShots
    .filter((s) => (s.characterIds ?? []).includes(turtle.id))
    .map((s) => snap.acts.find((a) => a.id === s.storySceneId)?.orderIndex ?? 0);
  if (turtleShotActs.some((act) => act < 4)) throw new Error("persisted turtle bound before act 4");

  const xiaohuaShots = orderedShots.filter((s) => (s.characterIds ?? []).includes(xiaohua.id));
  if (xiaohuaShots.length < 8) throw new Error("小華 identity not locked across enough shots");

  const suitcaseShots = orderedShots.filter((s) => (s.propIds ?? []).includes(suitcase.id));
  if (!suitcaseShots.length) throw new Error("suitcase not bound");
  const phoneShots = orderedShots.filter((s) => (s.propIds ?? []).includes(phone.id));
  if (phoneShots.length < 2) throw new Error("phone not bound on acts 1 and 3");

  const text = orderedShots.map((s) => `${s.dialogue ?? ""}\n${s.voiceover ?? ""}\n${s.action ?? ""}\n${s.prompt ?? ""}`).join("\n");
  for (const beat of ["起床啦", "手機", "倒回床", "長坡", "往後滑", "早八", "抱頭", "宇宙", "掉下來", "撞牆", "茶會"]) {
    if (!text.includes(beat)) throw new Error(`persisted shots dropped beat text: ${beat}`);
  }
}
