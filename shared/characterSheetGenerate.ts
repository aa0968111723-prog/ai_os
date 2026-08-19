import { getModel } from "./models";
import { lockXiaohuaGenerationPrompt } from "./characterIdentityLock";

/** Cheap text-to-image only. Never Veo / video. */
export const CHARACTER_SHEET_MODEL_ID = "fal-ai/flux/schnell";

export function isAllowedCharacterSheetModel(modelId: string): boolean {
  if (/veo/i.test(modelId)) return false;
  const model = getModel(modelId);
  if (!model || model.kind !== "image") return false;
  if (model.category.includes("video")) return false;
  return model.tier === "budget" || model.tier === "economy";
}

/** Text-lock sheet prompt. 0 own refs stay text-only — no stray 1/50. */
export function characterSheetPrompt(name: string, appearance: string): string {
  const raw = `${name} 定裝參考圖，全身、白底、清楚五官。外觀：${appearance}`;
  return lockXiaohuaGenerationPrompt(raw, [name]);
}
