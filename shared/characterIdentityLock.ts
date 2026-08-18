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
