/**
 * Disposable LOCAL 淡江禪學社 fixture — 動畫組 only.
 * Six spoken SHOTLIST beats. 小華 lock sheets + 龜龜 from the third line.
 * No paid FAL. No live groups. Services must not import routers.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import {
  TKU_ZEN_ACTS,
  TKU_ZEN_CHARACTERS,
  TKU_ZEN_LIBRARY,
  TKU_ZEN_LOCATIONS,
  TKU_ZEN_LOOKS,
  TKU_ZEN_PROMO_SCRIPT,
  TKU_ZEN_PROMO_TITLE,
  TKU_ZEN_SHOTLIST_LINES,
  TKU_ZEN_SHOTS,
  TKU_ZEN_WORLDVIEW,
  TKU_ZEN_XIAOHUA_SHEETS,
  tkuZenDialogueLines,
  tkuZenHasForbidden,
  tkuZenLibraryMapContent,
  tkuZenLibraryPath,
} from "../../shared/fixtures/tkuZenPromo";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";
import { saveBuffer, signAssetPath } from "./storage";

export { TKU_ZEN_PROMO_TITLE };

export function tkuZenLockSheetSearchDirs(): string[] {
  return [
    process.env.TKU_ZEN_LOCK_SHEET_DIR,
    path.join(process.cwd(), "shared/fixtures/tkuZenLockSheets"),
    tkuZenLibraryPath(TKU_ZEN_LIBRARY.xiaohua.folder),
  ].filter((dir): dir is string => Boolean(dir));
}

export function resolveTkuZenLockSheet(file: string): string | null {
  for (const dir of tkuZenLockSheetSearchDirs()) {
    const full = path.join(dir, file);
    if (existsSync(full)) return full;
  }
  return null;
}

async function attachLockSheet(input: {
  userId: string;
  projectId: string;
  groupId: string;
  file: string;
  title: string;
}): Promise<string | null> {
  const full = resolveTkuZenLockSheet(input.file);
  if (!full) return null;
  const buf = await readFile(full);
  const stored = await saveBuffer(buf, "image/png");
  const [created] = await db.insert(schema.assets).values({
    projectId: input.projectId,
    groupId: input.groupId,
    kind: "image",
    title: input.title,
    url: "",
    isAiGenerated: false,
    storagePath: stored.storagePath,
    mime: "image/png",
    sizeBytes: stored.sizeBytes,
    uploadedBy: input.userId,
    sha256: createHash("sha256").update(buf).digest("hex"),
    landState: "landed",
    meta: { lockSheet: input.file, source: "tku-zen-lock", noFal: true },
  }).returning({ id: schema.assets.id });
  await db.update(schema.assets).set({ url: signAssetPath(created.id) }).where(eq(schema.assets.id, created.id));
  return created.id;
}

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

  const sheetAssetIds: Record<string, string> = {};
  for (const [key, sheet] of Object.entries(TKU_ZEN_XIAOHUA_SHEETS)) {
    const assetId = await attachLockSheet({
      userId: input.userId,
      projectId: input.projectId,
      groupId: input.groupId,
      file: sheet.file,
      title: `小華 ${sheet.file}`,
    });
    if (assetId) sheetAssetIds[key] = assetId;
  }

  const characterIds: Record<string, string> = {};
  for (const card of TKU_ZEN_CHARACTERS) {
    const [row] = await db.insert(schema.characters).values({
      projectId: input.projectId,
      groupId: input.groupId,
      name: card.name,
      appearance: card.appearance,
      notes: card.notes,
      referenceAssetId: card.key === "xiaohua" ? (sheetAssetIds.costume ?? null) : null,
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
      referenceAssetId: look.sheet ? (sheetAssetIds[look.sheet] ?? null) : null,
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
      title: "SHOTLIST A–F 白帽T lock",
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

  const actIds: Record<number, string> = {};
  for (const act of TKU_ZEN_ACTS) {
    const [row] = await db.insert(schema.storyScenes).values({
      projectId: input.projectId,
      orderIndex: act.act,
      title: act.title,
      summary: `${act.timeOfDay}`,
      storyExcerpt: act.shots.map((s) => s.dialogue || s.action).filter(Boolean).join("\n"),
      locationId: locationIds[act.location],
      environment: { timeOfDay: act.timeOfDay, notes: act.title },
    }).returning({ id: schema.storyScenes.id });
    actIds[act.act] = row.id;
  }

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
      dialogue: spec.dialogue || undefined,
      action: spec.action,
      storySceneId: actIds[spec.act],
      characterIds: boundChars,
      scenePresetIds: locationId ? [locationId] : [],
      lookIds: boundLooks.length ? boundLooks : null,
    }).returning({ id: schema.scenes.id });
    shotIds.push(row.id);
  }

  return { characterIds, locationIds, actIds, shotIds, sheetAssetIds };
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
  const assets = await db.select().from(schema.assets).where(and(
    eq(schema.assets.projectId, projectId),
    isNull(schema.assets.deletedAt),
  ));
  return { project, story, characters, props, presets, acts, shots, looks, knowledge, assets };
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
  if (snap.acts.length !== 6) throw new Error(`expected 6 spoken acts, got ${snap.acts.length}`);
  if (snap.shots.length !== TKU_ZEN_SHOTS.length) {
    throw new Error(`expected ${TKU_ZEN_SHOTS.length} shots, got ${snap.shots.length}`);
  }

  const xiaohua = snap.characters.find((c) => c.name === "小華");
  const turtle = snap.characters.find((c) => c.name === "禪定龜龜");
  if (!xiaohua || !turtle) throw new Error("core cards missing");
  if (!xiaohua.appearance.includes("大二化工") || !xiaohua.appearance.includes("白帽T") || !xiaohua.appearance.includes("粉橘短髮女孩")) {
    throw new Error("小華 appearance lost 白帽T／粉橘短髮女孩 lock");
  }
  if (xiaohua.appearance.includes("針織外套") || xiaohua.appearance.includes("年輕男性") || xiaohua.appearance.includes("黑長直髮") || xiaohua.appearance.includes("安倢")) {
    throw new Error("小華 appearance flipped gender or mixed 七幕 lock");
  }
  if (!turtle.appearance.includes("吉祥物龜龜")) throw new Error("龜龜 appearance lost 吉祥物龜龜 lock");
  if (!snap.presets.some((p) => p.name === "校門口")) throw new Error("校門口 preset missing");
  if (!snap.presets.some((p) => p.name === "夕陽")) throw new Error("夕陽 preset missing");
  if (snap.presets.some((p) => p.name.includes("茶會"))) throw new Error("茶會 must not be a lip-sync act/preset");
  if (snap.looks.length !== TKU_ZEN_LOOKS.length) {
    throw new Error(`expected ${TKU_ZEN_LOOKS.length} looks, got ${snap.looks.length}`);
  }
  const xiaohuaLook = snap.looks.find((look) => look.characterId === xiaohua.id);
  if (!xiaohuaLook?.costume?.includes("白帽T")) throw new Error("小華 look lost 白帽T costume lock");
  if (snap.looks.filter((look) => look.characterId === xiaohua.id).length !== 1) {
    throw new Error("小華 must have exactly one look — script does not change costume");
  }
  if (!snap.knowledge.some((row) => row.content.includes("SHOTLIST.md"))) {
    throw new Error("SHOTLIST.md path missing from knowledge");
  }
  if (snap.knowledge.some((row) => row.content.includes("安倢") || row.content.includes("慕恩"))) {
    throw new Error("do not seed 安倢／慕恩 into 動畫組 小華");
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

  const turtleShotActs = orderedShots
    .filter((s) => (s.characterIds ?? []).includes(turtle.id))
    .map((s) => snap.acts.find((a) => a.id === s.storySceneId)?.orderIndex ?? 0);
  if (turtleShotActs.some((act) => act < 3)) throw new Error("龜龜 bound before the third spoken line");

  if (snap.assets.some((asset) => asset.title.includes(TKU_ZEN_XIAOHUA_SHEETS.costume.file))) {
    if (xiaohua.referenceAssetId == null) throw new Error("lock sheet uploaded but character.referenceAssetId empty");
  }
}
