import { describe, expect, it } from "vitest";
import { applyVoiceIdentity, routeSpeechVoice, voiceIdentitySupported, type VoiceIdentity } from "./voiceRouting";

const voice = (over: Partial<VoiceIdentity> = {}): VoiceIdentity => ({
  canonId: "cv1",
  versionId: "vv1",
  modelId: "fal-ai/kokoro/mandarin-chinese",
  voiceId: "zf_xiaobei",
  language: "Chinese",
  ...over,
});

describe("applyVoiceIdentity", () => {
  it("writes voice into kokoro params", () => {
    const params: Record<string, unknown> = { prompt: "旁白詞", voice: "zf_xiaoxiao" };
    expect(applyVoiceIdentity("fal-ai/kokoro/mandarin-chinese", params, voice())).toBe(true);
    expect(params.voice).toBe("zf_xiaobei");
  });

  it("writes voice+language into qwen params", () => {
    const params: Record<string, unknown> = { text: "詞", voice: "Vivian", language: "Chinese" };
    expect(applyVoiceIdentity("fal-ai/qwen-3-tts/text-to-speech/1.7b", params, voice({ voiceId: "Dylan", language: "Chinese" }))).toBe(true);
    expect(params.voice).toBe("Dylan");
    expect(params.language).toBe("Chinese");
  });

  it("replaces vibevoice speaker presets", () => {
    const params: Record<string, unknown> = { script: "詞", speakers: [{ preset: "Bowen [ZH]" }] };
    expect(applyVoiceIdentity("fal-ai/vibevoice", params, voice({ voiceId: "Xinran [ZH]" }))).toBe(true);
    expect(params.speakers).toEqual([{ preset: "Xinran [ZH]" }]);
  });

  it("rewrites every dialogue input voice", () => {
    const params: Record<string, unknown> = { inputs: [{ text: "a", voice: "Aria" }, { text: "b", voice: "Charlotte" }] };
    expect(applyVoiceIdentity("fal-ai/elevenlabs/text-to-dialogue/eleven-v3", params, voice({ voiceId: "Lily" }))).toBe(true);
    expect((params.inputs as Array<{ voice: string }>).map((row) => row.voice)).toEqual(["Lily", "Lily"]);
  });

  it("refuses unsupported models instead of pretending", () => {
    const params: Record<string, unknown> = { text: "詞" };
    expect(applyVoiceIdentity("fal-ai/elevenlabs/tts/eleven-v3", params, voice())).toBe(false);
    expect(params.voice).toBeUndefined();
    expect(voiceIdentitySupported("fal-ai/elevenlabs/tts/eleven-v3")).toBe(false);
  });
});

describe("routeSpeechVoice", () => {
  const luffy = voice({ canonId: "luffy-voice", voiceId: "zm_yunjian" });
  const narrator = voice({ canonId: "narrator-voice", voiceId: "zf_xiaoxiao" });

  it("uses the character voice for a single bound speaker", () => {
    const routed = routeSpeechVoice({
      speakers: ["魯夫"],
      characterVoiceByName: new Map([["魯夫", luffy]]),
      narrationVoice: narrator,
    });
    expect(routed.voice?.canonId).toBe("luffy-voice");
    expect(routed.unrouted).toEqual([]);
  });

  it("falls back to narration voice and reports the unbound speaker", () => {
    const routed = routeSpeechVoice({
      speakers: ["娜美"],
      characterVoiceByName: new Map([["魯夫", luffy]]),
      narrationVoice: narrator,
    });
    expect(routed.voice?.canonId).toBe("narrator-voice");
    expect(routed.unrouted).toEqual(["娜美"]);
  });

  it("pure narration uses the narration default with no unrouted noise", () => {
    const routed = routeSpeechVoice({
      speakers: [],
      characterVoiceByName: new Map(),
      narrationVoice: narrator,
    });
    expect(routed.voice?.canonId).toBe("narrator-voice");
    expect(routed.unrouted).toEqual([]);
  });

  it("multi-speaker is an honest downgrade: narration voice + everyone reported", () => {
    const routed = routeSpeechVoice({
      speakers: ["魯夫", "娜美"],
      characterVoiceByName: new Map([["魯夫", luffy], ["娜美", voice({ canonId: "nami" })]]),
      narrationVoice: narrator,
    });
    expect(routed.voice?.canonId).toBe("narrator-voice");
    expect(routed.unrouted).toEqual(["魯夫", "娜美"]);
  });

  it("no voices pinned at all → null voice (model default), nothing fabricated", () => {
    const routed = routeSpeechVoice({
      speakers: ["魯夫"],
      characterVoiceByName: new Map(),
      narrationVoice: null,
    });
    expect(routed.voice).toBeNull();
    expect(routed.unrouted).toEqual(["魯夫"]);
  });
});
