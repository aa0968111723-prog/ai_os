/**
 * 小華 is a locked female look in the 動畫組 A–F promo.
 * EXTRACT sometimes invents「年輕男性」from the name 小華; never persist that
 * unless the script itself explicitly says she is male (it does not).
 */
export const XIAOHUA_LOCKED_APPEARANCE = "大二化工、粉橘短髮女孩、白帽T";
export const XIAOHUA_LOCKED_COSTUME = "白帽T、休閒日常";

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
  if (!flipped && !missingFemale && appearance.trim()) return character;
  const keepCostume = /白帽/.test(costume) && !MALE_FLIP.test(costume);
  return {
    ...character,
    appearance: XIAOHUA_LOCKED_APPEARANCE,
    costume: keepCostume ? costume : XIAOHUA_LOCKED_COSTUME,
  };
}

export function lockXiaohuaCharacters<
  T extends { name?: string | null; appearance?: string | null; costume?: string | null },
>(characters: T[] | undefined, script: string): T[] {
  return (characters ?? []).map((c) => applyXiaohuaIdentityLock(c, script));
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
  return rewriteXiaohuaMaleCopy(text, force);
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
  shots: S[];
};

/** Lock 小華 cards and rewrite 他→她 in scene/shot copy that names or refs her. */
export function lockXiaohuaPlan<T extends { characters?: Array<{ name?: string | null; appearance?: string | null; costume?: string | null }>; scenes: LockableScene<LockableShot>[] }>(
  plan: T,
  script: string,
): T {
  const characters = lockXiaohuaCharacters(plan.characters, script);
  if (scriptExplicitlyMaleXiaohua(script)) {
    return { ...plan, characters, scenes: plan.scenes };
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
          prompt: rewriteXiaohuaMaleCopy(shot.prompt, force),
          action: rewriteMaybe(shot.action, force),
          dialogue: rewriteMaybe(shot.dialogue, force),
          voiceover: rewriteMaybe(shot.voiceover, force),
        };
      }),
    };
  });
  return { ...plan, characters, scenes };
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
    title: row.title != null ? rewriteXiaohuaMaleCopy(row.title, true) : row.title,
    prompt: row.prompt != null ? rewriteXiaohuaMaleCopy(row.prompt, true) : row.prompt,
    action: row.action != null ? rewriteXiaohuaMaleCopy(row.action, true) : row.action,
    dialogue: row.dialogue != null ? rewriteXiaohuaMaleCopy(row.dialogue, true) : row.dialogue,
    voiceover: row.voiceover != null ? rewriteXiaohuaMaleCopy(row.voiceover, true) : row.voiceover,
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
>(row: T): T {
  return lockXiaohuaCopyFields(row);
}
