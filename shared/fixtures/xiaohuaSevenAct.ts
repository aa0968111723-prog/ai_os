/**
 * RETIRED as a 小華 product fixture.
 * D:\淡大劇本 七幕 is 安倢/慕恩, not 小華. Mixing them is a product bug.
 * The only 小華 fixture is the A–F SHOTLIST in tkuZenPromo.ts.
 */
import {
  TKU_ZEN_PROMO_GROUP,
  TKU_ZEN_PROMO_SCRIPT,
  TKU_ZEN_PROMO_TITLE,
  TKU_ZEN_SHOTLIST_FIRST_PARSE,
  TKU_ZEN_SHOTLIST_LINES,
} from "./tkuZenPromo";

export const XIAOHUA_SEVEN_ACT_TITLE = TKU_ZEN_PROMO_TITLE;
export const XIAOHUA_SEVEN_ACT_GROUP = TKU_ZEN_PROMO_GROUP;

/** @deprecated Use TKU_ZEN_SHOTLIST_LINES. Kept so old imports do not silently revive 七幕. */
export const XIAOHUA_SEVEN_ACTS = [
  `A 校門口自我介紹。@小華：${TKU_ZEN_SHOTLIST_LINES[0]}`,
  `B 夕陽。@小華：${TKU_ZEN_SHOTLIST_LINES[1]}`,
  `C @小華：${TKU_ZEN_SHOTLIST_LINES[2]}`,
  `D @禪定龜龜：${TKU_ZEN_SHOTLIST_LINES[3]}`,
  `E @小華：${TKU_ZEN_SHOTLIST_LINES[4]}`,
  `F @禪定龜龜：${TKU_ZEN_SHOTLIST_LINES[5]}`,
] as const;

export const XIAOHUA_SEVEN_ACT_SCRIPT = TKU_ZEN_PROMO_SCRIPT;
export const XIAOHUA_SHOTLIST_PASTE = TKU_ZEN_SHOTLIST_FIRST_PARSE;

export function xiaohuaSevenActCharCount(): number {
  return XIAOHUA_SEVEN_ACT_SCRIPT.length;
}
