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
>(
  character: T,
  script: string,
  opts?: {
    /**
     * 這份外觀是**已入庫的資料**（角色卡／造型卡），不是 EXTRACT 的即時產物。
     *
     * 分界線是資料的可信度，不是呼叫的位置：
     * - **抽取路徑**（storyParse 的 150s fallback、助手 add_character 的 LLM 提案）
     *   吃的是模型輸出——腳本沒寫的外觀它會亂補、寫了的它會掉。缺女性字眼時
     *   推平成鎖定外觀是本鎖的本職（tku parse 契約：「大二化工、白帽T、短髮」→ 補回女孩）。
     * - **渲染路徑**（continuity 快照、卡片錨點）吃的是庫裡的正典資料——使用者為
     *   某個專案刻意寫的「紅旗袍、盤髮」「藍外套黑框眼鏡」沒有性別字眼，卻是那個
     *   專案自己的臉。推平它＝所有專案的小華共用一張全域臉，正是 #790 跨專案隔離
     *   e2e（「專案 B preview 鎖的是 B 的小華外觀」）要擋的洩漏（斷言寫了、行為
     *   沒跟上——CI 當時死在 story 之前沒人看見）。
     *
     * storedAppearance=true 時仍然擋男性標記與空外觀——那兩種在庫裡也是壞資料。
     */
    storedAppearance?: boolean;
  },
): T {
  if (!isXiaohuaName(character.name)) return character;
  if (scriptExplicitlyMaleXiaohua(script)) return character;
  const appearance = character.appearance ?? "";
  const costume = character.costume ?? "";
  const flipped = MALE_FLIP.test(`${appearance} ${costume}`);
  const missingFemale = !opts?.storedAppearance && !FEMALE_LOOK.test(appearance);
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
  const characters = lockXiaohuaCharacters(plan.characters, script);
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
          prompt: rewriteXiaohuaMaleCopy(shot.prompt, force),
          action: rewriteMaybe(shot.action, force),
          dialogue: rewriteMaybe(shot.dialogue, force),
          voiceover: rewriteMaybe(shot.voiceover, force),
        };
      }),
    };
  });
  return lockXiaohuaAct1Location({ ...plan, characters, scenes }, script);
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
  const rewritten = rewriteXiaohuaMaleCopy(prompt, true)
    .replace(/年輕男性/g, "粉橘短髮女孩")
    .replace(/黑長直髮/g, "粉橘短髮");
  // 她 is a pronoun lock, not a look. Fal still draws a boy without 粉橘短髮女孩.
  if (/女孩|女大生|粉橘/.test(rewritten)) return rewritten;
  return `${rewritten}\n\n外觀鎖定 小華：${XIAOHUA_LOCKED_APPEARANCE}`;
}
