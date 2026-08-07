/**
 * 說話序列：旁白與對白同序、可交錯、分得出來。
 *
 * 使用者的需求原話是「可以交錯但要分的出來」——所以這支測試的重點不是「能不能解析」，
 * 而是「交錯之後，每一句仍然知道自己是旁白還是誰的台詞」，以及下游（配音、字幕）
 * 真的據此分流。
 */
import { describe, expect, it } from "vitest";
import {
  NARRATOR_SPEAKER,
  formatSpeechLines,
  parseSpeechLines,
  sceneSpeechLines,
  speakersOf,
  speechForSubtitle,
  speechForTts,
} from "./sceneSpeech";

const BLOCK = [
  "@旁白：那一年，我第一次走進禪堂。",
  "@師父：坐吧。心急的人，茶會燙。",
  "@安倢（小聲）：謝謝師父。",
  "@旁白：後來我才明白，她要我自己走回去。",
].join("\n");

describe("parseSpeechLines（旁白與對白交錯，但分得出來）", () => {
  it("依序解析，旁白與角色台詞交錯排列且各自標記", () => {
    const lines = parseSpeechLines(BLOCK);
    expect(lines.map((l) => [l.speaker, l.isNarration])).toEqual([
      ["旁白", true],
      ["師父", false],
      ["安倢", false],
      ["旁白", true],
    ]);
    // 順序就是使用者寫的順序——這正是「交錯」的意思
    expect(lines[3]!.text).toBe("後來我才明白，她要我自己走回去。");
  });

  it("括號指示解析成獨立欄位，不混進台詞", () => {
    const lines = parseSpeechLines("@安倢（小聲）：謝謝師父。");
    expect(lines[0]).toMatchObject({ speaker: "安倢", parenthetical: "小聲", text: "謝謝師父。" });
  });

  it("全形＠與全形冒號都收（中文輸入法預設打出全形）", () => {
    const lines = parseSpeechLines("＠師父：坐吧。\n@安倢:謝謝。");
    expect(lines.map((l) => l.speaker)).toEqual(["師父", "安倢"]);
  });

  it("一句台詞可以跨行寫，中間的空行也保留", () => {
    const lines = parseSpeechLines("@師父：第一段\n\n第二段\n@安倢：好");
    expect(lines[0]!.text).toBe("第一段\n\n第二段");
    expect(lines[1]!.text).toBe("好");
  });

  it("整段沒標人就是旁白——只寫了一段話的人不該被擋在門外", () => {
    const lines = parseSpeechLines("那一年，我第一次走進禪堂。");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ speaker: NARRATOR_SPEAKER, isNarration: true });
  });

  it("空的與全空白回空陣列", () => {
    expect(parseSpeechLines("")).toEqual([]);
    expect(parseSpeechLines("   \n  ")).toEqual([]);
    expect(parseSpeechLines(null)).toEqual([]);
    expect(parseSpeechLines(undefined)).toEqual([]);
  });

  it("台詞裡有冒號不會被誤切（只有行首的 @ 才是說話者）", () => {
    const lines = parseSpeechLines("@師父：時間到了：該走了");
    expect(lines[0]).toMatchObject({ speaker: "師父", text: "時間到了：該走了" });
  });

  it("角色名含空白也解析得出來", () => {
    expect(parseSpeechLines("@陳 師姐：您好").at(0)).toMatchObject({ speaker: "陳 師姐", text: "您好" });
  });

  it("來回不失真：format(parse(x)) 與原文等值", () => {
    expect(formatSpeechLines(parseSpeechLines(BLOCK))).toBe(BLOCK);
  });
});

describe("下游分流（分得出來要真的有用）", () => {
  it("字幕：角色台詞冠名字，旁白不冠", () => {
    expect(speechForSubtitle(parseSpeechLines(BLOCK))).toBe(
      ["那一年，我第一次走進禪堂。", "師父：坐吧。心急的人，茶會燙。", "安倢：謝謝師父。", "後來我才明白，她要我自己走回去。"].join("\n"),
    );
  });

  it("配音：每句帶自己的音色，括號指示被剝掉（唸出來是廢音檔）", () => {
    const voices: Record<string, string> = { 師父: "voice-master", 安倢: "voice-anjie" };
    const out = speechForTts(parseSpeechLines(BLOCK), (s) => voices[s]);
    expect(out.map((o) => [o.speaker, o.voice])).toEqual([
      ["旁白", undefined],
      ["師父", "voice-master"],
      ["安倢", "voice-anjie"],
      ["旁白", undefined],
    ]);
    // 括號只在 parenthetical 欄，不在要唸的字裡
    expect(out.every((o) => !o.text.includes("小聲"))).toBe(true);
  });

  it("沒給音色表時每句都沒有 voice——呼叫端據此用預設音色", () => {
    expect(speechForTts(parseSpeechLines(BLOCK)).every((o) => o.voice === undefined)).toBe(true);
  });

  it("speakersOf 只回角色、去重、保留出現順序（旁白不算角色）", () => {
    expect(speakersOf(BLOCK)).toEqual(["師父", "安倢"]);
    expect(speakersOf("@師父：一\n@安倢：二\n@師父：三")).toEqual(["師父", "安倢"]);
  });
});

describe("sceneSpeechLines（既有 voiceover 的相容）", () => {
  it("舊資料只有 voiceover：視為排在最前面的旁白，一個位元組都不改", () => {
    const lines = sceneSpeechLines({ voiceover: "那一年…", dialogue: null });
    expect(lines).toEqual([{ speaker: NARRATOR_SPEAKER, isNarration: true, text: "那一年…" }]);
  });

  it("新舊並存：舊旁白排最前，新序列接在後面（過渡期不會掉內容）", () => {
    const lines = sceneSpeechLines({ voiceover: "舊的旁白", dialogue: "@師父：新的台詞" });
    expect(lines.map((l) => l.text)).toEqual(["舊的旁白", "新的台詞"]);
  });

  it("兩個都空回空陣列——呼叫端據此判斷「這鏡沒有聲音」", () => {
    expect(sceneSpeechLines({ voiceover: null, dialogue: null })).toEqual([]);
    expect(sceneSpeechLines({ voiceover: "  ", dialogue: "" })).toEqual([]);
  });
});
