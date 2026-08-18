import { describe, expect, it } from "vitest";
import {
  applyXiaohuaIdentityLock,
  lockXiaohuaCharacters,
  lockXiaohuaPlan,
  rewritePersistedXiaohuaShotCopy,
  rewriteXiaohuaMaleCopy,
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

  it("rewrites live A–D 他 titles to 她 and never turns 其他 into 其她", () => {
    expect(rewriteXiaohuaMaleCopy("小華站在校門口，夕陽光照在他身上")).toBe(
      "小華站在校門口，夕陽光照在她身上",
    );
    expect(rewriteXiaohuaMaleCopy("小華站在夕陽下，夕陽光照在他身上")).toBe(
      "小華站在夕陽下，夕陽光照在她身上",
    );
    expect(rewriteXiaohuaMaleCopy("小華和其他同學站在校門口")).toBe("小華和其他同學站在校門口");
    expect(rewriteXiaohuaMaleCopy("小華看著他們")).toBe("小華看著他們");
    expect(rewriteXiaohuaMaleCopy("禪定龜龜站在小華面前")).toBe("禪定龜龜站在小華面前");
    expect(rewriteXiaohuaMaleCopy("夕陽光照在他身上")).toBe("夕陽光照在他身上");
    expect(rewriteXiaohuaMaleCopy("夕陽光照在他身上", true)).toBe("夕陽光照在她身上");
  });

  it("locks EXTRACT shot copy when characterRefs or text name 小華", () => {
    const plan = lockXiaohuaPlan(
      {
        characters: [
          { name: "小華", appearance: "年輕男性", costume: "黑長直髮" },
          { name: "禪定龜龜", appearance: "吉祥物龜龜", costume: "圓殼" },
        ],
        scenes: [
          {
            title: "校門口",
            summary: "小華站在校門口",
            excerpt: "夕陽光照在他身上",
            shots: [
              {
                title: "小華站在校門口，夕陽光照在他身上",
                prompt: "小華站在校門口，夕陽光照在他身上",
                characterRefs: ["小華"],
              },
              {
                title: "禪定龜龜站在小華面前",
                prompt: "禪定龜龜站在小華面前",
                characterRefs: ["禪定龜龜", "小華"],
              },
              {
                title: "夕陽光照在他身上",
                prompt: "夕陽光照在他身上",
                characterRefs: ["小華"],
              },
            ],
          },
        ],
      },
      TKU_ZEN_SHOTLIST_AD_PARSE,
    );
    expect(plan.characters[0]?.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
    expect(plan.scenes[0]?.shots[0]?.title).toBe("小華站在校門口，夕陽光照在她身上");
    expect(plan.scenes[0]?.shots[0]?.prompt).toContain("她身上");
    expect(plan.scenes[0]?.shots[0]?.prompt).not.toContain("他身上");
    expect(plan.scenes[0]?.shots[1]?.title).toBe("禪定龜龜站在小華面前");
    expect(plan.scenes[0]?.shots[2]?.title).toBe("夕陽光照在她身上");
    expect(plan.scenes[0]?.excerpt).toBe("夕陽光照在她身上");
  });

  it("rewrites persisted shot rows without deleting them", () => {
    const row = rewritePersistedXiaohuaShotCopy({
      title: "小華站在夕陽下，夕陽光照在他身上",
      prompt: "小華站在夕陽下，夕陽光照在他身上",
      action: null,
      dialogue: null,
      voiceover: "他輕聲說宇宙呀",
    });
    expect(row.title).toContain("她身上");
    expect(row.prompt).not.toMatch(/他身上/);
    expect(row.voiceover).toBe("她輕聲說宇宙呀");
    const turtle = rewritePersistedXiaohuaShotCopy({
      title: "禪定龜龜低頭",
      prompt: "禪定龜龜站在校門口",
    });
    expect(turtle.title).toBe("禪定龜龜低頭");
  });
});
