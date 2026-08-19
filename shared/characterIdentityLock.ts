/**
 * 小華 is a locked female look in the 動畫組 A–F promo.
 * EXTRACT sometimes invents「年輕男性」from the name 小華; never persist that
 * unless the script itself explicitly says she is male (it does not).
 */
export const XIAOHUA_LOCKED_APPEARANCE = "大二化工、粉橘短髮女孩、白帽T";
export const XIAOHUA_LOCKED_COSTUME = "白帽T、休閒日常";

/** Story / title / prompt / look named 淡江 or 淡大. */
export function mentionsTamkangCampus(...parts: Array<string | null | undefined>): boolean {
  return parts.some((part) => Boolean(part && /淡江|淡大/.test(part)));
}

/** Live ask「淡江大二化工」must not be stored as bare 大二化工. */
export function withTamkangSophomore(appearance: string, source = ""): string {
  if (!mentionsTamkangCampus(appearance, source)) return appearance;
  if (/淡江大二化工/.test(appearance)) return appearance;
  if (/大二化工/.test(appearance)) return appearance.replace(/大二化工/g, "淡江大二化工");
  if (/粉橘短髮女孩|白帽T/.test(appearance)) return `淡江大二化工、${appearance}`;
  return appearance;
}

export function xiaohuaLockedAppearance(source = ""): string {
  return withTamkangSophomore(XIAOHUA_LOCKED_APPEARANCE, source);
}

const MALE_FLIP = /年輕男性|男性|男生|男孩|男大生|黑長直髮/;
const FEMALE_LOOK = /女孩|女大生|粉橘|短髮女孩|她/;

export function isXiaohuaName(name: string | null | undefined): boolean {
  return Boolean(name && /小華/.test(name));
}

/** Only honor an explicit "小華 is male" clause; A–F never has one. */
export function scriptExplicitlyMaleXiaohua(script: string): boolean {
  if (!/小華/.test(script)) return false;
  if (FEMALE_LOOK.test(script)) return false;
  return /小華[^。\n]{0,24}(男生|男性|男孩|男大生)/.test(script);
}

export function applyXiaohuaIdentityLock<
  T extends { name?: string | null; appearance?: string | null; costume?: string | null },
>(character: T, script: string): T {
  if (!isXiaohuaName(character.name)) return character;
  if (scriptExplicitlyMaleXiaohua(script)) return character;
  const appearance = character.appearance ?? "";
  const costume = character.costume ?? "";
  const flipped = MALE_FLIP.test(`${appearance} ${costume}`);
  const missingFemale = !FEMALE_LOOK.test(appearance);
  const source = `${appearance} ${script}`;
  const empty = !appearance.trim() || appearance.trim() === "待補外觀描述";
  const campus = mentionsTamkangCampus(appearance, script);
  if (!flipped && !missingFemale && appearance.trim()) {
    return { ...character, appearance: withTamkangSophomore(appearance, source) };
  }
  // Another project's 小華 (藍外套／紅旗袍) is not the A–F 白帽T lock.
  // Only empty cards, EXTRACT male flips, and 淡江／淡大 scripts take the promo look.
  if (!flipped && !empty && !campus) {
    return character;
  }
  const keepCostume = /白帽/.test(costume) && !MALE_FLIP.test(costume);
  return {
    ...character,
    appearance: xiaohuaLockedAppearance(source),
    costume: keepCostume ? costume : XIAOHUA_LOCKED_COSTUME,
  };
}

export function lockXiaohuaCharacters<
  T extends { name?: string | null; appearance?: string | null; costume?: string | null },
>(characters: T[] | undefined, script: string): T[] {
  return (characters ?? []).map((c) => applyXiaohuaIdentityLock(c, script));
}

/** EXTRACT invents「年輕男性／黑長直髮」for 小華. Text-lock wins over that. */
export function rewriteXiaohuaInventedMaleLook(text: string): string {
  if (!text) return text;
  return text
    .replace(/年輕男性/g, "粉橘短髮女孩")
    .replace(/黑長直髮/g, "粉橘短髮")
    // Live 第9鏡: 「主：粉橘髮女孩、白T（是男性）」— lock is 粉橘短髮女孩, not a parenthetical male.
    .replace(/[（(]\s*(?:是)?(?:男性|男生)\s*[）)]/g, "")
    .replace(/[、，]\s*是(?:男性|男生)/g, "")
    .replace(/是(?:男性|男生)/g, "");
}

function rewriteXiaohuaLockedCopy(text: string, force: boolean): string {
  return rewriteXiaohuaInventedMaleLook(rewriteXiaohuaMaleCopy(text, force));
}

/**
 * EXTRACT often writes「夕陽光照在他身上」for 小華. She is female.
 * Never turn 其他 → 其她. Keep 他們 / 他家.
 */
export function rewriteXiaohuaMaleCopy(text: string, force = false): string {
  if (!text) return text;
  if (!force && !/小華/.test(text)) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== "他") {
      out += ch;
      continue;
    }
    const prev = text[i - 1] ?? "";
    const next = text[i + 1] ?? "";
    if (prev === "其" || next === "們" || next === "家") {
      out += "他";
    } else {
      out += "她";
    }
  }
  return out;
}

function mentionsXiaohua(text: string | null | undefined): boolean {
  return Boolean(text && /小華/.test(text));
}

function refsXiaohua(refs: string[] | null | undefined): boolean {
  return (refs ?? []).some((name) => isXiaohuaName(name));
}

function rewriteMaybe(text: string | null | undefined, force: boolean): string | null | undefined {
  if (text == null) return text;
  return rewriteXiaohuaLockedCopy(text, force);
}

function campusBlobFromPlan(
  plan: {
    locations?: Array<{ name?: string | null }>;
    scenes: LockableScene<LockableShot>[];
  },
  script: string,
): string {
  const locations = (plan.locations ?? []).map((loc) => loc.name ?? "").join("\n");
  const scenes = plan.scenes
    .map((scene) => [scene.title, scene.summary, scene.excerpt, scene.locationRef, ...scene.shots.map(shotBlob)].join("\n"))
    .join("\n");
  return `${script}\n${locations}\n${scenes}`;
}

type LockableShot = {
  title?: string | null;
  prompt: string;
  action?: string | null;
  dialogue?: string | null;
  voiceover?: string | null;
  characterRefs?: string[] | null;
};

type LockableScene<S extends LockableShot> = {
  title?: string | null;
  summary?: string | null;
  excerpt?: string | null;
  locationRef?: string | null;
  shots: S[];
};

function shouldLockXiaohuaAct1Gate(script: string): boolean {
  return /小華/.test(script) && /校門口/.test(script);
}

function rewriteAct1Kenanpo(text: string | null | undefined): string | null | undefined {
  if (text == null) return text;
  return text.replace(/克難坡/g, "淡大校門口");
}

/**
 * SHOTLIST A is 淡大校門口（校名牌、暖色光）. 克難坡 is B-roll only.
 * EXTRACT sometimes parks act 1 on 克難坡 because the library map mentions it.
 */
export function lockXiaohuaAct1Location<
  T extends {
    locations?: Array<{ name?: string | null }>;
    scenes: Array<{
      title?: string | null;
      summary?: string | null;
      excerpt?: string | null;
      locationRef?: string | null;
      shots: Array<{ title?: string | null; prompt: string; action?: string | null; dialogue?: string | null; voiceover?: string | null }>;
    }>;
  },
>(plan: T, script: string): T {
  if (!shouldLockXiaohuaAct1Gate(script)) return plan;
  const locations = (plan.locations ?? []).map((loc, i) => {
    if (i !== 0 || !/克難坡/.test(loc.name ?? "")) return loc;
    return { ...loc, name: "校門口" };
  });
  const scenes = plan.scenes.map((scene, i) => {
    if (i !== 0) return scene;
    const locationRef = /克難坡/.test(scene.locationRef ?? "") ? "校門口" : scene.locationRef;
    return {
      ...scene,
      locationRef,
      title: rewriteAct1Kenanpo(scene.title) ?? scene.title,
      summary: rewriteAct1Kenanpo(scene.summary),
      excerpt: rewriteAct1Kenanpo(scene.excerpt),
      shots: scene.shots.map((shot) => ({
        ...shot,
        title: rewriteAct1Kenanpo(shot.title),
        prompt: rewriteAct1Kenanpo(shot.prompt) ?? shot.prompt,
        action: rewriteAct1Kenanpo(shot.action),
        dialogue: rewriteAct1Kenanpo(shot.dialogue),
        voiceover: rewriteAct1Kenanpo(shot.voiceover),
      })),
    };
  });
  return { ...plan, ...(plan.locations ? { locations } : {}), scenes };
}

/** Lock 小華 cards and rewrite 他→她 in scene/shot copy that names or refs her. */
export function lockXiaohuaPlan<T extends { characters?: Array<{ name?: string | null; appearance?: string | null; costume?: string | null }>; locations?: Array<{ name?: string | null }>; scenes: LockableScene<LockableShot>[] }>(
  plan: T,
  script: string,
): T {
  const campus = campusBlobFromPlan(plan, script);
  const characters = lockXiaohuaCharacters(plan.characters, campus);
  if (scriptExplicitlyMaleXiaohua(script)) {
    return lockXiaohuaAct1Location({ ...plan, characters, scenes: plan.scenes }, script);
  }
  const scenes = plan.scenes.map((scene) => {
    const sceneForce =
      mentionsXiaohua(scene.title) ||
      mentionsXiaohua(scene.summary) ||
      mentionsXiaohua(scene.excerpt) ||
      scene.shots.some((shot) => refsXiaohua(shot.characterRefs) || mentionsXiaohua(shotBlob(shot)));
    return {
      ...scene,
      title: rewriteMaybe(scene.title, sceneForce || mentionsXiaohua(scene.title)) ?? scene.title,
      summary: rewriteMaybe(scene.summary, sceneForce),
      excerpt: rewriteMaybe(scene.excerpt, sceneForce),
      shots: scene.shots.map((shot) => {
        const force = sceneForce || refsXiaohua(shot.characterRefs) || mentionsXiaohua(shotBlob(shot));
        return {
          ...shot,
          title: rewriteMaybe(shot.title, force),
          prompt: rewriteXiaohuaLockedCopy(shot.prompt, force),
          action: rewriteMaybe(shot.action, force),
          dialogue: rewriteMaybe(shot.dialogue, force),
          voiceover: rewriteMaybe(shot.voiceover, force),
        };
      }),
    };
  });
  // Act 1 rewrite may introduce 淡大校門口 after cards were locked from a 大二化工-only paste.
  const located = lockXiaohuaAct1Location({ ...plan, characters, scenes }, script);
  return {
    ...located,
    characters: lockXiaohuaCharacters(located.characters, campusBlobFromPlan(located, script)),
  };
}

function shotBlob(shot: LockableShot): string {
  return [shot.title, shot.prompt, shot.action, shot.dialogue, shot.voiceover].filter(Boolean).join("");
}

/** 拆分鏡 / addDraft-style rows: rewrite 他→她 when the script or copy names 小華. */
export function lockXiaohuaCopyFields<
  T extends {
    title?: string | null;
    prompt?: string | null;
    action?: string | null;
    dialogue?: string | null;
    voiceover?: string | null;
  },
>(row: T, script = ""): T {
  if (scriptExplicitlyMaleXiaohua(script)) return row;
  const blob = [row.title, row.prompt, row.action, row.dialogue, row.voiceover].filter(Boolean).join("");
  const force = mentionsXiaohua(script) || mentionsXiaohua(blob);
  if (!force) return row;
  return {
    ...row,
    title: row.title != null ? rewriteXiaohuaLockedCopy(row.title, true) : row.title,
    prompt: row.prompt != null ? rewriteXiaohuaLockedCopy(row.prompt, true) : row.prompt,
    action: row.action != null ? rewriteXiaohuaLockedCopy(row.action, true) : row.action,
    dialogue: row.dialogue != null ? rewriteXiaohuaLockedCopy(row.dialogue, true) : row.dialogue,
    voiceover: row.voiceover != null ? rewriteXiaohuaLockedCopy(row.voiceover, true) : row.voiceover,
  };
}

/** Persist-time rewrite for already-materialized 小華 shot rows (no delete). */
export function rewritePersistedXiaohuaShotCopy<
  T extends {
    title?: string | null;
    prompt?: string | null;
    action?: string | null;
    dialogue?: string | null;
    voiceover?: string | null;
  },
>(row: T, boundToXiaohua = false): T {
  return lockXiaohuaCopyFields(row, boundToXiaohua ? "小華" : "");
}

/**
 * Last-mile lock for Fal / preview prompts. Card titles already rewrite 他→她;
 * generateInto still painted a boy when the prompt said 年輕男性 or never
 * named 粉橘短髮女孩.
 */
export function lockXiaohuaGenerationPrompt(prompt: string, characterNames: string[] = []): string {
  if (!prompt) return prompt;
  const namesXiaohua = characterNames.some((name) => isXiaohuaName(name));
  if (!mentionsXiaohua(prompt) && !namesXiaohua) return prompt;
  // Do not honor 年輕男性 inside the prompt itself — EXTRACT invents
  // 「小華…年輕男性」within 24 chars, which is not an explicit male clause.
  const rewritten = rewriteXiaohuaInventedMaleLook(rewriteXiaohuaMaleCopy(prompt, true))
    .replace(/男孩/g, "女孩")
    .replace(/男生/g, "女生");
  const source = [prompt, rewritten, ...characterNames].join(" ");
  const lockLine = xiaohuaLockedAppearance(source);
  // 她 is a pronoun lock, not a look. Fal still draws a boy+turtle without 粉橘短髮女孩.
  // 0 own sheets: text-lock must still carry 粉橘短髮女孩, and 淡江 when the prompt/story has 淡大.
  const hasLook = /粉橘短髮女孩/.test(rewritten);
  const hasNonMaleCardLock = /外觀鎖定\s*小華[：:]/.test(rewritten) && !MALE_FLIP.test(rewritten);
  const stillMale = /年輕男性|是男性|是男生|男孩|男生|[（(]\s*(?:是)?男性/.test(rewritten);
  const needsCampus = mentionsTamkangCampus(source) && !/淡江大二化工/.test(rewritten);
  // Isolation previews already carry 外觀鎖定 小華：藍外套 — do not append A–F 白帽T.
  if (hasNonMaleCardLock && !stillMale) return rewritten;
  if (hasLook && !stillMale && !needsCampus) return rewritten;
  return `${rewritten}\n\n外觀鎖定 小華：${lockLine}`;
}
