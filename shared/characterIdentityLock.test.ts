import { describe, expect, it } from "vitest";
import {
  applyXiaohuaIdentityLock,
  lockXiaohuaCharacters,
  lockXiaohuaCopyFields,
  lockXiaohuaGenerationPrompt,
  lockXiaohuaPlan,
  rewritePersistedXiaohuaShotCopy,
  rewriteXiaohuaInventedMaleLook,
  rewriteXiaohuaMaleCopy,
  scriptExplicitlyMaleXiaohua,
  withTamkangSophomore,
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

  it("keeps 淡江大二化工 when the ask or look already names 淡江", () => {
    const asked = applyXiaohuaIdentityLock(
      { name: "小華", appearance: "淡江大二化工、年輕男性", costume: "" },
      "新增角色小華 淡江大二化工",
    );
    expect(asked.appearance).toContain("淡江大二化工");
    expect(asked.appearance).toContain("粉橘短髮女孩");
    expect(asked.appearance).toContain("白帽T");
    expect(asked.appearance).not.toContain("年輕男性");
    const keep = applyXiaohuaIdentityLock(
      { name: "小華", appearance: "淡江大二化工、粉橘短髮女孩、白帽T", costume: "白帽T" },
      TKU_ZEN_SHOTLIST_AD_PARSE,
    );
    expect(keep.appearance).toBe("淡江大二化工、粉橘短髮女孩、白帽T");
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

  it("restores 淡江大二化工 when the story names 淡大 but the card already dropped it", () => {
    const dropped = applyXiaohuaIdentityLock(
      { name: "小華", appearance: XIAOHUA_LOCKED_APPEARANCE, costume: "白帽T" },
      "小華站在淡大校門口校名牌前。我是大二化工系的小華。",
    );
    expect(dropped.appearance).toBe("淡江大二化工、粉橘短髮女孩、白帽T");
    expect(withTamkangSophomore(XIAOHUA_LOCKED_APPEARANCE, "淡大校門口")).toContain("淡江大二化工");
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
    const bound = rewritePersistedXiaohuaShotCopy({
      title: "夕陽光照在他身上",
      prompt: "夕陽光照在他身上",
    }, true);
    expect(bound.title).toBe("夕陽光照在她身上");
    expect(bound.prompt).not.toContain("他身上");
  });

  it("moves EXTRACT act 1 off 克難坡 onto 校門口 when the script is 小華 A–F", () => {
    const plan = lockXiaohuaPlan(
      {
        characters: [{ name: "小華", appearance: "粉橘短髮女孩" }],
        locations: [{ name: "克難坡" }, { name: "夕陽" }],
        scenes: [
          {
            title: "走上克難坡",
            summary: "小華走上克難坡",
            locationRef: "克難坡",
            shots: [{ title: "克難坡自我介紹", prompt: "小華站在克難坡", characterRefs: ["小華"] }],
          },
          {
            title: "夕陽",
            locationRef: "夕陽",
            shots: [{ title: "宇宙呀", prompt: "夕陽", characterRefs: ["小華"] }],
          },
        ],
      },
      TKU_ZEN_SHOTLIST_AD_PARSE,
    );
    expect(plan.locations[0]?.name).toBe("校門口");
    expect(plan.scenes[0]?.locationRef).toBe("校門口");
    expect(plan.scenes[0]?.title).not.toContain("克難坡");
    expect(plan.scenes[0]?.shots[0]?.prompt).toContain("淡大校門口");
    expect(plan.scenes[0]?.shots[0]?.prompt).not.toContain("克難坡");
    expect(plan.scenes[1]?.locationRef).toBe("夕陽");
    expect(plan.characters[0]?.appearance).toContain("淡江大二化工");
    expect(plan.characters[0]?.appearance).toContain("粉橘短髮女孩");
  });

  it("locks generateInto prompts so 小華 cannot stay a boy", () => {
    const flipped = lockXiaohuaGenerationPrompt("小華躺在床上，年輕男性看著禪定龜龜，夕陽光照在他身上");
    expect(flipped).toContain("粉橘短髮女孩");
    expect(flipped).not.toMatch(/年輕男性|他身上/);
    expect(flipped).toContain("她身上");
    const unnamed = lockXiaohuaGenerationPrompt("夕陽光照在他身上", ["小華"]);
    expect(unnamed).toContain("她身上");
    expect(unnamed).toMatch(/粉橘短髮女孩|女孩/);
    expect(lockXiaohuaGenerationPrompt("禪定龜龜低頭")).toBe("禪定龜龜低頭");
    const boyTurtle = lockXiaohuaGenerationPrompt("a young boy sitting with a zen turtle", ["小華"]);
    expect(boyTurtle).toContain(XIAOHUA_LOCKED_APPEARANCE);
    const campus = lockXiaohuaGenerationPrompt("年輕男性站在淡大校門口", ["小華"]);
    expect(campus).toContain("粉橘短髮女孩");
    expect(campus).toContain("淡江大二化工");
    expect(campus).not.toContain("年輕男性");
    expect(rewriteXiaohuaInventedMaleLook("小華是年輕男性，黑長直髮")).toBe("小華是粉橘短髮女孩，粉橘短髮");
    const shot9 = lockXiaohuaCopyFields(
      { title: "第9鏡", prompt: "主：粉橘髮女孩、白T（是男性）" },
      "小華站在校門口",
    );
    expect(shot9.prompt).toBe("主：粉橘髮女孩、白T");
    expect(shot9.prompt).not.toMatch(/是男性|（是男性）|\(是男性\)/);
    const gen9 = lockXiaohuaGenerationPrompt("主：粉橘髮女孩、白T（是男性）", ["小華"]);
    expect(gen9).toContain("粉橘短髮女孩");
    expect(gen9).not.toMatch(/是男性|（是男性）/);
    expect(rewriteXiaohuaInventedMaleLook("主：粉橘髮女孩、白T(是男性)")).toBe("主：粉橘髮女孩、白T");
    const imeSave = rewritePersistedXiaohuaShotCopy({
      title: "第9鏡",
      prompt: "主：粉橘髮女孩、白T（是男性）",
    }, true);
    expect(imeSave.prompt).toBe("主：粉橘髮女孩、白T");
    expect(imeSave.prompt).not.toMatch(/是男性|（是男性）/);
  });

  it("locks 拆分鏡 rows when the script names 小華 even if the title omits her", () => {
    const locked = lockXiaohuaCopyFields(
      { title: "夕陽光照在他身上", prompt: "夕陽光照在他身上" },
      TKU_ZEN_SHOTLIST_AD_PARSE,
    );
    expect(locked.title).toBe("夕陽光照在她身上");
    expect(locked.prompt).not.toContain("他身上");
    const maleLook = lockXiaohuaCopyFields(
      { title: "年輕男性站在校門口", prompt: "年輕男性站在淡大校門口，夕陽光照在他身上" },
      TKU_ZEN_SHOTLIST_AD_PARSE,
    );
    expect(maleLook.title).toContain("粉橘短髮女孩");
    expect(maleLook.prompt).toContain("粉橘短髮女孩");
    expect(maleLook.prompt).toContain("她身上");
    expect(maleLook.prompt).not.toMatch(/年輕男性|他身上/);
  });
});
