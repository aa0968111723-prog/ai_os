import { describe, expect, it } from "vitest";
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
  TKU_ZEN_SHOTLIST_LINES,
  TKU_ZEN_SHOTS,
  TKU_ZEN_XIAOHUA_APPEARANCE,
  TKU_ZEN_XIAOHUA_COSTUME,
  TKU_ZEN_XIAOHUA_SHEETS,
  tkuZenDialogueLines,
  tkuZenHasForbidden,
  tkuZenLibraryMapContent,
  tkuZenLibraryPath,
  tkuZenTurtleFirstAct,
} from "./tkuZenPromo";

describe("淡江禪學社 小華 SHOTLIST fixture", () => {
  it("keeps 7 acts, only 小華 + 禪定龜龜, and the six SHOTLIST lines", () => {
    expect(TKU_ZEN_ACTS).toHaveLength(7);
    expect(TKU_ZEN_CHARACTERS.map((c) => c.name)).toEqual(["小華", "禪定龜龜"]);
    expect(tkuZenDialogueLines(TKU_ZEN_SHOTS)).toEqual([...TKU_ZEN_SHOTLIST_LINES]);
    expect(TKU_ZEN_SHOTS.reduce((sum, shot) => sum + shot.durationSec, 0)).toBe(TKU_ZEN_FALLBACK_DURATION_SEC);
    expect(TKU_ZEN_PROMO_SCRIPT).toContain(TKU_ZEN_SHOTLIST_LINES[0]);
  });

  it("locks 小華 to the pink-bob cardigan sheets and keeps one unchanging look", () => {
    const xiaohua = TKU_ZEN_CHARACTERS.find((c) => c.key === "xiaohua");
    expect(xiaohua?.appearance).toBe(TKU_ZEN_XIAOHUA_APPEARANCE);
    expect(xiaohua?.appearance).toContain("大二化工");
    expect(xiaohua?.appearance).toContain("針織外套");
    expect(xiaohua?.appearance).toContain("百褶裙");
    expect(xiaohua?.appearance).toContain(TKU_ZEN_XIAOHUA_SHEETS.threeview.file);
    expect(xiaohua?.appearance).not.toContain("白帽T");
    expect(TKU_ZEN_LOOKS.filter((look) => look.character === "xiaohua")).toHaveLength(1);
    expect(TKU_ZEN_LOOKS.find((look) => look.character === "xiaohua")?.costume).toBe(TKU_ZEN_XIAOHUA_COSTUME);
    expect(TKU_ZEN_LOCATIONS.find((loc) => loc.key === "slope")?.name).toBe("克難坡");
  });

  it("keeps 龜龜 off until act 4 and drops the invented 媽媽 beats", () => {
    expect(tkuZenTurtleFirstAct()).toBe(4);
    expect(TKU_ZEN_SHOTS.filter((s) => s.act < 4).every((s) => !s.characters.includes("turtle"))).toBe(true);
    const blob = [
      TKU_ZEN_PROMO_SCRIPT,
      ...TKU_ZEN_CHARACTERS.map((c) => `${c.name}\n${c.appearance}\n${c.notes}`),
      ...TKU_ZEN_SHOTS.map((s) => `${s.title}\n${s.prompt}\n${s.dialogue}\n${s.action}`),
    ].join("\n");
    expect(tkuZenHasForbidden(blob)).toEqual([]);
    expect(TKU_ZEN_FORBIDDEN).toContain("白帽T");
  });

  it("pins the lock-sheet library paths", () => {
    expect(TKU_ZEN_LIBRARY_ROOT).toBe(String.raw`D:\淡大劇本`);
    expect(tkuZenLibraryPath(TKU_ZEN_LIBRARY.xiaohua.folder, TKU_ZEN_XIAOHUA_SHEETS.threeview.file))
      .toBe(String.raw`D:\淡大劇本\角色圖\粉橘短髮女孩\pink_bob_girl_threeview_v01.png`);
    const map = tkuZenLibraryMapContent();
    expect(map).toContain(TKU_ZEN_XIAOHUA_SHEETS.expression.file);
    expect(map).toContain(TKU_ZEN_XIAOHUA_SHEETS.action.file);
    expect(map).toContain("第四幕");
    expect(map).toContain("七幕");
  });
});
