import { describe, expect, it } from "vitest";
import {
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
  tkuZenDialogueLines,
  tkuZenHasForbidden,
  tkuZenLibraryMapContent,
  tkuZenLibraryPath,
} from "./tkuZenPromo";

describe("淡江禪學社 小華 SHOTLIST fixture", () => {
  it("keeps only 小華 + 禪定龜龜 and the six SHOTLIST lines", () => {
    expect(TKU_ZEN_CHARACTERS.map((c) => c.name)).toEqual(["小華", "禪定龜龜"]);
    expect(TKU_ZEN_SHOTS).toHaveLength(6);
    expect(tkuZenDialogueLines(TKU_ZEN_SHOTS)).toEqual([...TKU_ZEN_SHOTLIST_LINES]);
    expect(TKU_ZEN_SHOTS.reduce((sum, shot) => sum + shot.durationSec, 0)).toBe(TKU_ZEN_FALLBACK_DURATION_SEC);
    expect(TKU_ZEN_PROMO_SCRIPT).toContain(TKU_ZEN_SHOTLIST_LINES[0]);
    expect(TKU_ZEN_PROMO_SCRIPT).toContain(TKU_ZEN_SHOTLIST_LINES[5]);
  });

  it("locks 小華 to 大二化工、白帽T、短髮 and 龜龜 to 吉祥物龜龜", () => {
    const xiaohua = TKU_ZEN_CHARACTERS.find((c) => c.key === "xiaohua");
    const turtle = TKU_ZEN_CHARACTERS.find((c) => c.key === "turtle");
    expect(xiaohua?.appearance).toContain("大二化工");
    expect(xiaohua?.appearance).toContain("白帽T");
    expect(xiaohua?.appearance).toContain("短髮");
    expect(xiaohua?.appearance).toContain("粉橘短髮");
    expect(xiaohua?.libraryFolder).toBe(TKU_ZEN_LIBRARY.xiaohua.folder);
    expect(turtle?.appearance).toContain("吉祥物龜龜");
    expect(TKU_ZEN_LOCATIONS.find((loc) => loc.key === "slope")?.name).toBe("克難坡");
    expect(TKU_ZEN_LOOKS.map((look) => look.notes).join("\n")).toContain("pink_bob_girl_threeview_v01.png");
  });

  it("does not keep 媽媽, the 11 old beats, 黑長直髮, or a third-character template", () => {
    const blob = [
      TKU_ZEN_PROMO_SCRIPT,
      ...TKU_ZEN_CHARACTERS.map((c) => `${c.name}\n${c.appearance}\n${c.notes}`),
      ...TKU_ZEN_SHOTS.map((s) => `${s.title}\n${s.prompt}\n${s.dialogue}\n${s.action}`),
    ].join("\n");
    expect(tkuZenHasForbidden(blob)).toEqual([]);
    expect(TKU_ZEN_FORBIDDEN).toContain("媽媽");
    expect(TKU_ZEN_FORBIDDEN).toContain("大一新生");
    expect(TKU_ZEN_FORBIDDEN).toContain("黑長直髮");
  });

  it("pins the local library paths without turning 素材 boards into the story", () => {
    expect(TKU_ZEN_LIBRARY_ROOT).toBe(String.raw`D:\淡大劇本`);
    expect(tkuZenLibraryPath(TKU_ZEN_LIBRARY.xiaohua.folder, "pink_bob_girl_threeview_v01.png"))
      .toBe(String.raw`D:\淡大劇本\角色圖\粉橘短髮女孩\pink_bob_girl_threeview_v01.png`);
    const map = tkuZenLibraryMapContent();
    expect(map).toContain("pink_bob_girl_expression_sheet_v01.png");
    expect(map).toContain("pink_bob_girl_action_sheet_v01.png");
    expect(map).toContain("master_cast_v02.png");
    expect(map).toContain(String.raw`角色圖\吉祥物龜龜`);
    expect(map).toContain(String.raw`場景\克難坡`);
    expect(map).toContain("第一幕 成片稿");
    expect(map).toContain("不是七幕結構");
  });
});
