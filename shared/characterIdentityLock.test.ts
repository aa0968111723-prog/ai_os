import { describe, expect, it } from "vitest";
import {
  applyXiaohuaIdentityLock,
  lockXiaohuaCharacters,
  scriptExplicitlyMaleXiaohua,
  XIAOHUA_LOCKED_APPEARANCE,
} from "./characterIdentityLock";
import { TKU_ZEN_SHOTLIST_AD_PARSE, TKU_ZEN_SHOTLIST_FIRST_PARSE } from "./fixtures/tkuZenPromo";

describe("小華 identity lock", () => {
  it("rewrites 年輕男性 when the A–D script names 小華 as a 短髮女孩", () => {
    expect(scriptExplicitlyMaleXiaohua(TKU_ZEN_SHOTLIST_AD_PARSE)).toBe(false);
    const locked = applyXiaohuaIdentityLock(
      { name: "小華", appearance: "年輕男性", costume: "休閒" },
      TKU_ZEN_SHOTLIST_AD_PARSE,
    );
    expect(locked.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
    expect(locked.appearance).toContain("粉橘短髮女孩");
    expect(locked.appearance).not.toContain("年輕男性");
    expect(locked.costume).toContain("白帽T");
  });

  it("fills a missing female look on an empty 小華 card", () => {
    const locked = applyXiaohuaIdentityLock({ name: "小華", appearance: "", costume: "" }, TKU_ZEN_SHOTLIST_FIRST_PARSE);
    expect(locked.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
  });

  it("does not rewrite 禪定龜龜 or a non-小華 male extra", () => {
    const turtle = applyXiaohuaIdentityLock(
      { name: "禪定龜龜", appearance: "吉祥物龜龜", costume: "圓殼" },
      TKU_ZEN_SHOTLIST_AD_PARSE,
    );
    expect(turtle.appearance).toBe("吉祥物龜龜");
    const extra = applyXiaohuaIdentityLock(
      { name: "學長", appearance: "年輕男性", costume: "制服" },
      "學長是年輕男性。",
    );
    expect(extra.appearance).toBe("年輕男性");
  });

  it("keeps an already-female 小華 look", () => {
    const keep = "大二化工、粉橘短髮女孩、白帽T、微笑";
    const locked = applyXiaohuaIdentityLock({ name: "小華", appearance: keep, costume: "白帽T" }, TKU_ZEN_SHOTLIST_AD_PARSE);
    expect(locked.appearance).toBe(keep);
  });

  it("honors an explicit male clause only when the script has no female cues", () => {
    const maleScript = "小華是男生，大二機械。";
    expect(scriptExplicitlyMaleXiaohua(maleScript)).toBe(true);
    const locked = applyXiaohuaIdentityLock({ name: "小華", appearance: "年輕男性" }, maleScript);
    expect(locked.appearance).toBe("年輕男性");
  });

  it("locks a whole EXTRACT plan so 年輕男性 never reaches SAVE", () => {
    const chars = lockXiaohuaCharacters(
      [
        { name: "小華", appearance: "年輕男性", costume: "黑長直髮" },
        { name: "禪定龜龜", appearance: "吉祥物龜龜", costume: "圓殼" },
      ],
      TKU_ZEN_SHOTLIST_AD_PARSE,
    );
    expect(chars[0]?.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
    expect(chars[0]?.appearance).not.toMatch(/年輕男性|黑長直髮/);
    expect(chars[1]?.appearance).toBe("吉祥物龜龜");
  });
});
