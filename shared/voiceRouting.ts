/**
 * Voice identity routing（closure master plan §5）。
 *
 * 聲線是 durable canonical dependency：Character Canon／專案旁白預設指向
 * {modelId, voiceId, language}，生成時由這裡把 voiceId 真正寫進 provider 參數。
 *
 * 誠實原則：只有「參數真的存在於該模型 input schema」的模型才在支援表上；
 * 不支援的模型不假裝套用——回報 structured downgrade，讓呼叫端記 warning。
 */

/** 每個支援模型的 voice 參數形狀（依 shared/models.ts 各 input 閉包實際輸出核對） */
export type VoiceParamShape =
  | { kind: "voice" }                    // { voice: "<id>" }
  | { kind: "voice_language" }           // { voice, language }
  | { kind: "speakers_preset" }          // { speakers: [{ preset }] }
  | { kind: "dialogue_inputs" };         // { inputs: [{ text, voice }] }

export const VOICE_CAPABLE_TTS_MODELS: Record<string, VoiceParamShape> = {
  "fal-ai/kokoro/mandarin-chinese": { kind: "voice" },
  "fal-ai/qwen-3-tts/text-to-speech/1.7b": { kind: "voice_language" },
  "fal-ai/qwen-3-tts/text-to-speech/0.6b": { kind: "voice_language" },
  "fal-ai/vibevoice": { kind: "speakers_preset" },
  "fal-ai/vibevoice/7b": { kind: "speakers_preset" },
  "fal-ai/elevenlabs/text-to-dialogue/eleven-v3": { kind: "dialogue_inputs" },
};

export function voiceIdentitySupported(modelId: string): boolean {
  return Boolean(VOICE_CAPABLE_TTS_MODELS[modelId]);
}

export interface VoiceIdentity {
  canonId: string;
  versionId: string;
  modelId: string;
  voiceId: string;
  language: string | null;
}

/**
 * 把 voice identity 套進 provider 參數。回傳是否真的套用了——
 * false＝模型不支援或參數形狀對不上，呼叫端必須記 downgrade，不得宣稱已鎖定聲線。
 * 就地修改 providerInput（與 generationCore 其他參數注入同模式）。
 */
export function applyVoiceIdentity(
  modelId: string,
  providerInput: Record<string, unknown>,
  voice: Pick<VoiceIdentity, "voiceId" | "language">,
): boolean {
  const shape = VOICE_CAPABLE_TTS_MODELS[modelId];
  if (!shape) return false;
  switch (shape.kind) {
    case "voice":
      providerInput.voice = voice.voiceId;
      return true;
    case "voice_language":
      providerInput.voice = voice.voiceId;
      if (voice.language) providerInput.language = voice.language;
      return true;
    case "speakers_preset":
      providerInput.speakers = [{ preset: voice.voiceId }];
      return true;
    case "dialogue_inputs": {
      const inputs = providerInput.inputs;
      if (!Array.isArray(inputs)) return false;
      for (const row of inputs) {
        if (row && typeof row === "object") (row as Record<string, unknown>).voice = voice.voiceId;
      }
      return true;
    }
  }
}

/**
 * 為一段 speech 選 voice（bounded routing）：
 * - 全部是旁白 → 旁白預設
 * - 恰好一位說話者且他有綁定聲線 → 該角色聲線
 * - 其他（多說話者混合）→ 旁白預設＋回報未路由的說話者（呼叫端記 warning，不假裝多聲道）
 */
export function routeSpeechVoice(input: {
  speakers: readonly string[];            // 非旁白說話者（顯示名）
  characterVoiceByName: ReadonlyMap<string, VoiceIdentity>;
  narrationVoice: VoiceIdentity | null;
}): { voice: VoiceIdentity | null; unrouted: string[] } {
  if (input.speakers.length === 1) {
    const match = input.characterVoiceByName.get(input.speakers[0]!);
    if (match) return { voice: match, unrouted: [] };
    return { voice: input.narrationVoice, unrouted: [...input.speakers] };
  }
  const unrouted = input.speakers.filter((name) => !input.characterVoiceByName.has(name));
  if (input.speakers.length === 0) return { voice: input.narrationVoice, unrouted: [] };
  // 多說話者：單一 TTS 呼叫無法各說各話——旁白預設＋全員列為未路由（誠實降級）
  return { voice: input.narrationVoice, unrouted: unrouted.length ? unrouted : [...input.speakers] };
}
