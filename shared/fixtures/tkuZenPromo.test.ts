import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAR_APPEARANCE_MAX, CHAR_NOTES_MAX } from "../cardLimits";
import {
  SCRIPT_ACTION_MAX,
  SCRIPT_DIALOGUE_MAX,
  SCRIPT_PROMPT_MAX,
  SCRIPT_TITLE_MAX,
} from "../storyboardScript";
import {
  TKU_ZEN_ACTS,
  TKU_ZEN_CHARACTERS,
  TKU_ZEN_FALLBACK_DURATION_SEC,
  TKU_ZEN_FORBIDDEN,
  TKU_ZEN_LIBRARY,
  TKU_ZEN_LIBRARY_ROOT,
  TKU_ZEN_LOCATIONS,
  TKU_ZEN_LOOKS,
  TKU_ZEN_PROMO_SCRIPT,
  TKU_ZEN_SHOTLIST_A_LINE,
  TKU_ZEN_SHOTLIST_AD_PARSE,
  TKU_ZEN_SHOTLIST_FIRST_PARSE,
  TKU_ZEN_SHOTLIST_LINES,
  TKU_ZEN_SHOTS,
  TKU_ZEN_XIAOHUA_APPEARANCE,
  TKU_ZEN_XIAOHUA_COSTUME,
  TKU_ZEN_XIAOHUA_IDENTITY,
  TKU_ZEN_XIAOHUA_SHEETS,
  tkuZenDialogueLines,
  tkuZenHasForbidden,
  tkuZenLibraryMapContent,
  tkuZenLibraryPath,
  tkuZenTurtleFirstAct,
} from "./tkuZenPromo";

describe("淡江禪學社 小華 SHOTLIST fixture", () => {
  it("keeps 6 spoken SHOTLIST beats, only 小華 + 禪定龜龜", () => {
    expect(TKU_ZEN_ACTS).toHaveLength(6);
    expect(TKU_ZEN_CHARACTERS.map((c) => c.name)).toEqual(["小華", "禪定龜龜"]);
    expect(tkuZenDialogueLines(TKU_ZEN_SHOTS)).toEqual([...TKU_ZEN_SHOTLIST_LINES]);
    expect(TKU_ZEN_SHOTS.reduce((sum, shot) => sum + shot.durationSec, 0)).toBe(TKU_ZEN_FALLBACK_DURATION_SEC);
    expect(TKU_ZEN_PROMO_SCRIPT).toContain(TKU_ZEN_SHOTLIST_LINES[0]);
  });

  it("first-parse paste is ~300 Chinese chars / 6 paragraphs (not the 119-char cache hit)", () => {
    expect(TKU_ZEN_SHOTLIST_FIRST_PARSE.length).toBeGreaterThanOrEqual(280);
    expect(TKU_ZEN_SHOTLIST_FIRST_PARSE.length).toBeLessThanOrEqual(500);
    expect(TKU_ZEN_SHOTLIST_FIRST_PARSE.split(/\n\n/).length).toBe(6);
    for (const line of TKU_ZEN_SHOTLIST_LINES) expect(TKU_ZEN_SHOTLIST_FIRST_PARSE).toContain(line);
  });

  it("A-line only is the live 66-char success side of the 405B cliff", () => {
    expect(TKU_ZEN_SHOTLIST_A_LINE.length).toBe(66);
    expect(TKU_ZEN_SHOTLIST_A_LINE).toContain(TKU_ZEN_SHOTLIST_LINES[0]);
    expect(TKU_ZEN_SHOTLIST_A_LINE.length).toBeLessThan(TKU_ZEN_SHOTLIST_FIRST_PARSE.length);
  });

  it("A–D paste is the live 161-char OK-but-slow side of the 405B cliff", () => {
    expect(TKU_ZEN_SHOTLIST_AD_PARSE.length).toBe(161);
    expect(TKU_ZEN_SHOTLIST_AD_PARSE.split("\n")).toHaveLength(4);
    expect(TKU_ZEN_SHOTLIST_AD_PARSE).toContain(TKU_ZEN_SHOTLIST_LINES[0]);
    expect(TKU_ZEN_SHOTLIST_AD_PARSE).toContain(TKU_ZEN_SHOTLIST_LINES[3]);
    expect(TKU_ZEN_SHOTLIST_AD_PARSE).toContain("粉橘短髮女孩");
    expect(TKU_ZEN_SHOTLIST_AD_PARSE).not.toContain("年輕男性");
    expect(TKU_ZEN_SHOTLIST_A_LINE.length).toBeLessThan(TKU_ZEN_SHOTLIST_AD_PARSE.length);
    expect(TKU_ZEN_SHOTLIST_AD_PARSE.length).toBeLessThan(TKU_ZEN_SHOTLIST_FIRST_PARSE.length);
  });

  it("locks 小華 to 白帽T／粉橘短髮女孩 A–F and keeps one unchanging look", () => {
    const xiaohua = TKU_ZEN_CHARACTERS.find((c) => c.key === "xiaohua");
    expect(xiaohua?.appearance).toBe(TKU_ZEN_XIAOHUA_APPEARANCE);
    expect(xiaohua?.appearance).toContain("大二化工");
    expect(xiaohua?.appearance).toContain("白帽T");
    expect(xiaohua?.appearance).toContain("短髮");
    expect(xiaohua?.appearance).toContain("粉橘短髮女孩");
    expect(xiaohua?.appearance).not.toContain("針織外套");
    expect(xiaohua?.appearance).not.toContain("年輕男性");
    expect(xiaohua?.appearance).not.toContain("黑長直髮");
    expect(TKU_ZEN_LOOKS.filter((look) => look.character === "xiaohua")).toHaveLength(1);
    expect(TKU_ZEN_LOOKS.find((look) => look.character === "xiaohua")?.costume).toBe(TKU_ZEN_XIAOHUA_COSTUME);
    expect(TKU_ZEN_LOCATIONS.find((loc) => loc.key === "gate")?.name).toBe("校門口");
    expect(TKU_ZEN_LOCATIONS.find((loc) => loc.key === "gate")?.palette).toContain("校名牌");
    expect(TKU_ZEN_LOCATIONS.find((loc) => loc.key === "gate")?.lighting).toContain("暖色光");
    expect(TKU_ZEN_LOCATIONS.find((loc) => loc.key === "sunset")?.name).toBe("夕陽");
    // 場景名目前是字面值聯集，TS 因此認為 === "茶會" 永遠為 false。
    // 這條斷言守的是「日後有人把茶會加回 fixture」，所以要保留執行期檢查——
    // 明確放寬成 string 才不會變成一個編譯錯誤（而不是被刪掉）。
    const locationNames: string[] = TKU_ZEN_LOCATIONS.map((loc) => loc.name);
    expect(locationNames.some((name) => name === "茶會" || name.includes("茶會") || name.includes("克難坡"))).toBe(false);
  });

  it("keeps 龜龜 off until the third spoken line and drops the invented 媽媽 beats", () => {
    expect(tkuZenTurtleFirstAct()).toBe(3);
    expect(TKU_ZEN_SHOTS.filter((s) => s.act < 3).every((s) => !s.characters.includes("turtle"))).toBe(true);
    const blob = [
      TKU_ZEN_PROMO_SCRIPT,
      ...TKU_ZEN_CHARACTERS.map((c) => `${c.name}\n${c.appearance}\n${c.notes}`),
      ...TKU_ZEN_SHOTS.map((s) => `${s.title}\n${s.prompt}\n${s.dialogue}\n${s.action}`),
    ].join("\n");
    expect(tkuZenHasForbidden(blob)).toEqual([]);
    expect(TKU_ZEN_FORBIDDEN).not.toContain("白帽T");
    expect(TKU_ZEN_FORBIDDEN).not.toContain("七幕");
    expect(TKU_ZEN_FORBIDDEN).toContain("安倢");
    expect(TKU_ZEN_FORBIDDEN).toContain("走上克難坡");
    expect(TKU_ZEN_FORBIDDEN).toContain("茶會社課擺攤");
    expect(TKU_ZEN_FORBIDDEN).toContain("針織外套");
    expect(TKU_ZEN_FORBIDDEN).toContain("年輕男性");
    expect(TKU_ZEN_FORBIDDEN).toContain("黑長直髮");
    expect(TKU_ZEN_SHOTS).toHaveLength(6);
    expect(TKU_ZEN_SHOTS.every((s) => s.dialogue.trim().length > 0)).toBe(true);
    expect(TKU_ZEN_ACTS.map((a) => a.title).join("\n")).not.toMatch(/七幕|走上克難坡|茶會社課擺攤|收尾/);
    expect(TKU_ZEN_SHOTS.map((s) => s.title).join("\n")).not.toMatch(/七幕|走上克難坡|茶會社課擺攤|收尾/);
    expect(TKU_ZEN_ACTS[0]?.title).toContain("校門口");
    expect(TKU_ZEN_ACTS[0]?.location).toBe("gate");
    expect(TKU_ZEN_ACTS[0]?.shots[0]?.location).toBe("gate");
    expect(TKU_ZEN_ACTS[0]?.shots[0]?.prompt).toContain("淡大校門口");
    expect(TKU_ZEN_ACTS[0]?.shots[0]?.prompt).toContain("校名牌");
    expect(TKU_ZEN_ACTS[0]?.shots[0]?.prompt).toContain("暖色光");
    expect(TKU_ZEN_ACTS[0]?.shots[0]?.prompt).not.toContain("克難坡");
    expect(TKU_ZEN_ACTS[1]?.title).toContain("夕陽");
    expect(TKU_ZEN_ACTS.map((a) => `${a.title}\n${a.shots.map((s) => s.prompt).join("\n")}`).join("\n")).not.toContain("克難坡");
  });

  it("keeps seeded fields inside character / script write limits", () => {
    for (const card of TKU_ZEN_CHARACTERS) {
      expect(card.appearance.length, card.name).toBeLessThanOrEqual(CHAR_APPEARANCE_MAX);
      expect(card.notes.length, card.name).toBeLessThanOrEqual(CHAR_NOTES_MAX);
    }
    for (const shot of TKU_ZEN_SHOTS) {
      expect(shot.title.length, shot.title).toBeLessThanOrEqual(SCRIPT_TITLE_MAX);
      expect(shot.prompt.length, shot.title).toBeLessThanOrEqual(SCRIPT_PROMPT_MAX);
      expect(shot.dialogue.length, shot.title).toBeLessThanOrEqual(SCRIPT_DIALOGUE_MAX);
      expect(shot.action.length, shot.title).toBeLessThanOrEqual(SCRIPT_ACTION_MAX);
    }
    expect(TKU_ZEN_LOOKS[0]?.costume.length).toBeGreaterThan(10);
  });

  it("pins the lock-sheet library paths", () => {
    expect(TKU_ZEN_LIBRARY_ROOT).toBe(String.raw`D:\淡大劇本`);
    expect(tkuZenLibraryPath(TKU_ZEN_LIBRARY.scripts.folder, "SHOTLIST.md"))
      .toBe(String.raw`D:\淡大劇本\腳本\SHOTLIST.md`);
    const map = tkuZenLibraryMapContent();
    expect(map).toContain("SHOTLIST.md");
    expect(map).toContain("白帽T");
    expect(map).toContain("第三句");
    expect(map).toContain("六句 SHOTLIST");
    expect(map).toContain("非 lip-sync 幕");
    expect(map).not.toContain("安倢");
    expect(map).not.toContain("慕恩");
    expect(map).not.toContain("A1-S01");
    expect(map).not.toContain("成片稿");
    expect(map).toContain("粉橘短髮女孩");
    expect(map).toContain("pink_bob_girl_threeview_v01.png");
    expect(map).not.toContain("年輕男性");
    expect(map).not.toContain("黑長直髮");
    expect(map).not.toContain("走上克難坡");
    expect(map).toContain("克難坡只在這裡，不是 A 校門口自我介紹");
    expect(map).toContain(String.raw`場景\克難坡`);
    expect(map).not.toContain("七幕");
    expect(map).not.toContain("各幕腳本");
    expect(TKU_ZEN_LIBRARY.scripts.folder).toBe(String.raw`腳本`);
    expect([...TKU_ZEN_LIBRARY.scripts.files]).toEqual(["SHOTLIST.md"]);
    expect([...TKU_ZEN_LIBRARY.boards.files]).toEqual(["SHOTLIST.md"]);
    expect(TKU_ZEN_LIBRARY.boards.files.join("\n")).not.toMatch(/A[1-4]-S/);
    expect(TKU_ZEN_LIBRARY.scripts.files.join("\n")).not.toContain("成片稿");
  });

  it("source lock: 6 spoken A–F only; FORBIDDEN never lists 白帽T; library does not seed 安倢 boards", () => {
    const src = readFileSync(join(process.cwd(), "shared/fixtures/tkuZenPromo.ts"), "utf8");
    const forbidden = src.slice(src.indexOf("export const TKU_ZEN_FORBIDDEN"), src.indexOf("] as const;", src.indexOf("export const TKU_ZEN_FORBIDDEN")));
    const acts = src.slice(src.indexOf("export const TKU_ZEN_ACTS"), src.indexOf("export const TKU_ZEN_SHOTS"));
    const library = src.slice(src.indexOf("export const TKU_ZEN_LIBRARY"), src.indexOf("export function tkuZenLibraryPath"));
    const mapFn = src.slice(src.indexOf("export function tkuZenLibraryMapContent"), src.indexOf("export const TKU_ZEN_WORLDVIEW"));
    expect(forbidden).not.toContain("白帽T");
    expect(forbidden).not.toContain("七幕");
    expect(acts).not.toMatch(/act:\s*7/);
    expect(acts).not.toContain("七幕");
    expect(acts).not.toContain("走上克難坡");
    expect(acts).not.toContain("克難坡");
    expect(acts).not.toContain("茶會社課擺攤");
    expect(mapFn).not.toContain("七幕");
    expect(library).not.toContain("各幕腳本");
    expect(library).not.toContain("成片稿");
    expect(library).not.toMatch(/A[1-4]-S/);
    expect(TKU_ZEN_ACTS).toHaveLength(6);
    expect(TKU_ZEN_SHOTS).toHaveLength(6);
    expect(TKU_ZEN_XIAOHUA_IDENTITY).toContain("白帽T");
    expect(TKU_ZEN_XIAOHUA_IDENTITY).toContain("短髮");
  });
});
