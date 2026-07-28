/**
 * ANIM-02 角色／風格聖經版本化契約測試（純函式）。
 * 鎖定：過期偵測、引用可解析、生成 snapshot 穩定、角色卡 draft adapter、空 refs。
 */
import { describe, expect, it } from "vitest";
import {
  assertCharacterRefsResolvable,
  buildCharacterCurrentVersionMap,
  buildGenerationContinuitySnapshot,
  buildShotCharacterRefsFromCharacters,
  characterToDraftBibleVersion,
  charactersToDraftBibleVersions,
  draftCharacterBibleVersionId,
  draftStyleBibleVersionId,
  formatStaleContinuityHint,
  hasStaleContinuity,
  isBibleVersionStale,
  styleDraftToBibleVersion,
  type CharacterBibleVersion,
  type CharacterRowLike,
  type ShotCharacterRef,
  type StaleContinuityRef,
} from "./animationContinuity";

const charA: CharacterRowLike = {
  id: "char-a",
  name: "安倢",
  appearance: "紅傘、米白外套、短髮",
  notes: "溫柔沉穩",
  referenceAssetId: "asset-ref-1",
  projectId: "proj-1",
};

const charB: CharacterRowLike = {
  id: "char-b",
  name: "行者",
  appearance: "灰袍、木念珠",
  notes: null,
  referenceAssetId: null,
};

describe("ANIM-02 draft bible adapter from Character", () => {
  it("maps name/appearance/notes/reference into draft bible shape", () => {
    const bible = characterToDraftBibleVersion(charA);
    expect(bible.characterId).toBe("char-a");
    expect(bible.version).toBe(1);
    expect(bible.id).toBe(draftCharacterBibleVersionId("char-a", 1));
    expect(bible.status).toBe("draft");
    expect(bible.appearance).toEqual({
      name: "安倢",
      summary: "紅傘、米白外套、短髮",
    });
    expect(bible.costume).toEqual({});
    expect(bible.personality).toBe("溫柔沉穩");
    expect(bible.referenceAssetIds).toEqual(["asset-ref-1"]);
    expect(bible.approvedAt).toBeUndefined();
  });

  it("omits personality and reference when empty; supports version override", () => {
    const bible = characterToDraftBibleVersion(charB, { version: 3 });
    expect(bible.id).toBe("char-b:bible:v3");
    expect(bible.version).toBe(3);
    expect(bible.personality).toBeUndefined();
    expect(bible.referenceAssetIds).toEqual([]);
  });

  it("charactersToDraftBibleVersions preserves order", () => {
    const list = charactersToDraftBibleVersions([charA, charB]);
    expect(list.map((b) => b.characterId)).toEqual(["char-a", "char-b"]);
  });

  it("styleDraftToBibleVersion packs styles/tones/taboos", () => {
    const style = styleDraftToBibleVersion({
      productionId: "proj-1",
      styles: ["水墨禪意"],
      tones: ["莊嚴"],
      taboos: ["不得使用療效宣稱"],
      palette: "暖米白",
      lighting: "柔側光",
    });
    expect(style.id).toBe(draftStyleBibleVersionId("proj-1", 1));
    expect(style.productionId).toBe("proj-1");
    expect(style.visualLanguage).toEqual({
      styles: ["水墨禪意"],
      tones: ["莊嚴"],
    });
    expect(style.colorScript).toEqual({ palette: "暖米白" });
    expect(style.lightingRules).toEqual(["柔側光"]);
    expect(style.negativeRules).toEqual(["不得使用療效宣稱"]);
    expect(style.status).toBe("draft");
  });
});

describe("ANIM-02 isBibleVersionStale", () => {
  const refs: ShotCharacterRef[] = [
    { characterId: "char-a", characterBibleVersionId: "char-a:bible:v1" },
    { characterId: "char-b", characterBibleVersionId: "char-b:bible:v1" },
  ];

  it("returns empty when all match current (including empty refs)", () => {
    expect(
      isBibleVersionStale(
        { characterRefs: [] },
        { characters: {} },
      ),
    ).toEqual([]);

    expect(
      isBibleVersionStale(
        { characterRefs: refs, styleBibleVersionId: "proj-1:style-bible:v1" },
        {
          characters: {
            "char-a": "char-a:bible:v1",
            "char-b": "char-b:bible:v1",
          },
          styleBibleVersionId: "proj-1:style-bible:v1",
        },
      ),
    ).toEqual([]);
  });

  it("flags outdated character and style refs", () => {
    const stale = isBibleVersionStale(
      { characterRefs: refs, styleBibleVersionId: "proj-1:style-bible:v1" },
      {
        characters: {
          "char-a": "char-a:bible:v2",
          "char-b": "char-b:bible:v1",
        },
        styleBibleVersionId: "proj-1:style-bible:v2",
      },
    );

    expect(stale).toEqual<StaleContinuityRef[]>([
      {
        kind: "character",
        characterId: "char-a",
        lockedVersionId: "char-a:bible:v1",
        currentVersionId: "char-a:bible:v2",
      },
      {
        kind: "style",
        lockedVersionId: "proj-1:style-bible:v1",
        currentVersionId: "proj-1:style-bible:v2",
      },
    ]);
    expect(hasStaleContinuity(
      { characterRefs: refs, styleBibleVersionId: "proj-1:style-bible:v1" },
      {
        characters: { "char-a": "char-a:bible:v2", "char-b": "char-b:bible:v1" },
        styleBibleVersionId: "proj-1:style-bible:v2",
      },
    )).toBe(true);
  });

  it("ignores characters with no current entry (deleted / unknown)", () => {
    const stale = isBibleVersionStale(
      { characterRefs: refs },
      { characters: { "char-a": "char-a:bible:v1" } },
    );
    expect(stale).toEqual([]);
  });

  it("accepts Map for character current versions", () => {
    const map = new Map([
      ["char-a", "char-a:bible:v9"],
    ]);
    const stale = isBibleVersionStale(
      {
        characterRefs: [
          { characterId: "char-a", characterBibleVersionId: "char-a:bible:v1" },
        ],
      },
      { characters: map },
    );
    expect(stale).toHaveLength(1);
    expect(stale[0]!.currentVersionId).toBe("char-a:bible:v9");
  });
});

describe("ANIM-02 buildCharacterCurrentVersionMap", () => {
  it("picks highest version per character", () => {
    const versions: CharacterBibleVersion[] = [
      characterToDraftBibleVersion(charA, { version: 1 }),
      characterToDraftBibleVersion(charA, { version: 2 }),
      characterToDraftBibleVersion(charB, { version: 1 }),
    ];
    const map = buildCharacterCurrentVersionMap(versions);
    expect(map.get("char-a")).toBe("char-a:bible:v2");
    expect(map.get("char-b")).toBe("char-b:bible:v1");
  });
});

describe("ANIM-02 assertCharacterRefsResolvable", () => {
  const versions = charactersToDraftBibleVersions([charA, charB]);

  it("ok for empty refs", () => {
    expect(assertCharacterRefsResolvable([], versions)).toEqual({ ok: true });
  });

  it("ok when all refs resolve and match characterId", () => {
    const refs = buildShotCharacterRefsFromCharacters([charA, charB]);
    expect(assertCharacterRefsResolvable(refs, versions)).toEqual({ ok: true });
  });

  it("version_not_found when bible id missing", () => {
    const result = assertCharacterRefsResolvable(
      [{ characterId: "char-a", characterBibleVersionId: "missing-v" }],
      versions,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe("version_not_found");
    }
  });

  it("character_mismatch when version belongs to another character", () => {
    const result = assertCharacterRefsResolvable(
      [{ characterId: "char-a", characterBibleVersionId: draftCharacterBibleVersionId("char-b", 1) }],
      versions,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe("character_mismatch");
    }
  });

  it("duplicate_character when same character appears twice", () => {
    const id = draftCharacterBibleVersionId("char-a", 1);
    const result = assertCharacterRefsResolvable(
      [
        { characterId: "char-a", characterBibleVersionId: id },
        { characterId: "char-a", characterBibleVersionId: id },
      ],
      versions,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe("duplicate_character");
    }
  });
});

describe("ANIM-02 buildGenerationContinuitySnapshot stability", () => {
  it("empty refs → empty ids; no style key", () => {
    const snap = buildGenerationContinuitySnapshot({ characterRefs: [] });
    expect(snap).toEqual({
      characterRefs: [],
      characterBibleVersionIds: [],
    });
    expect(snap.styleBibleVersionId).toBeUndefined();
  });

  it("sorts characterRefs by characterId and dedupes version ids", () => {
    const snap = buildGenerationContinuitySnapshot({
      characterRefs: [
        { characterId: "char-b", characterBibleVersionId: "bv-b" },
        { characterId: "char-a", characterBibleVersionId: "bv-a" },
        { characterId: "char-c", characterBibleVersionId: "bv-a" },
      ],
      styleBibleVersionId: "style-v1",
    });

    expect(snap.characterRefs.map((r) => r.characterId)).toEqual([
      "char-a",
      "char-b",
      "char-c",
    ]);
    expect(snap.characterBibleVersionIds).toEqual(["bv-a", "bv-b"]);
    expect(snap.styleBibleVersionId).toBe("style-v1");
  });

  it("is stable across call order (same multiset → same snapshot)", () => {
    const a = buildGenerationContinuitySnapshot({
      characterRefs: [
        { characterId: "z", characterBibleVersionId: "v-z" },
        { characterId: "a", characterBibleVersionId: "v-a" },
      ],
      styleBibleVersionId: "s1",
    });
    const b = buildGenerationContinuitySnapshot({
      characterRefs: [
        { characterId: "a", characterBibleVersionId: "v-a" },
        { characterId: "z", characterBibleVersionId: "v-z" },
      ],
      styleBibleVersionId: "s1",
    });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("ignores empty styleBibleVersionId", () => {
    const snap = buildGenerationContinuitySnapshot({
      characterRefs: [],
      styleBibleVersionId: "",
    });
    expect(snap.styleBibleVersionId).toBeUndefined();
  });
});

describe("ANIM-02 formatStaleContinuityHint (zh)", () => {
  it("empty stale → empty string", () => {
    expect(formatStaleContinuityHint([])).toBe("");
  });

  it("builds Chinese message for character + style stale", () => {
    const msg = formatStaleContinuityHint([
      {
        kind: "character",
        characterId: "char-a",
        lockedVersionId: "char-a:bible:v1",
        currentVersionId: "char-a:bible:v2",
      },
      {
        kind: "style",
        lockedVersionId: "proj:style-bible:v1",
        currentVersionId: "proj:style-bible:v2",
      },
    ]);
    expect(msg).toContain("過期");
    expect(msg).toContain("角色");
    expect(msg).toContain("風格");
    expect(msg).toContain("重新生成");
    expect(msg).toContain("2 處");
  });
});
