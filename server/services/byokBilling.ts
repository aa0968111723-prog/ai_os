/**
 * BYOK Phase 2 helpers — dual-billing resolution for fal personal keys.
 * Used by generationCore + generation.decideCost.
 */
import { getDecryptedKey } from "./userAiKeys";
import type { ModelEntry } from "../../shared/models";
import { isNimModel } from "../../shared/models";
import { splitGenerationSourceMeta } from "../../shared/generationSourceMeta";

export type ByokResolveResult = {
  userFalKey: string | null;
  usedUserKey: boolean;
};

/**
 * Resolve personal fal key for a user + model.
 * - NIM never uses fal personal key.
 * - New submit（無 params）：有 active+prefer 的 fal key → usedUserKey.
 * - Advance／decideCost（有 params）：以 meta.usedUserKey 為準；仍需解出 key 才能查 status。
 */
export async function resolveByokFalKey(
  userId: string,
  model: ModelEntry | null | undefined,
  params?: unknown,
): Promise<ByokResolveResult> {
  if (!model || isNimModel(model)) {
    return { userFalKey: null, usedUserKey: false };
  }
  const metaUsed =
    params != null && splitGenerationSourceMeta(params).meta.usedUserKey === true;
  const userFalKey = await getDecryptedKey(userId, "fal");
  if (metaUsed) {
    // 在途 job：即使 key 已刪，仍標 usedUserKey 讓呼叫端 fail／不扣點
    return { userFalKey, usedUserKey: true };
  }
  return {
    userFalKey,
    usedUserKey: !!userFalKey,
  };
}

/** Optional apiKey opts for falSubmit/falStatus when personal key is active. */
export function byokFalOpts(userFalKey: string | null, usedUserKey: boolean): { apiKey: string } | undefined {
  return usedUserKey && userFalKey ? { apiKey: userFalKey } : undefined;
}
