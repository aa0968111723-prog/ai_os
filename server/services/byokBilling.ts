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

/** Resolve personal fal key for a user + model. NIM never uses fal personal key. */
export async function resolveByokFalKey(
  userId: string,
  model: ModelEntry | null | undefined,
  params?: unknown,
): Promise<ByokResolveResult> {
  const metaUsed =
    params != null && splitGenerationSourceMeta(params).meta.usedUserKey === true;
  if (!model || isNimModel(model)) {
    return { userFalKey: null, usedUserKey: metaUsed };
  }
  const userFalKey = await getDecryptedKey(userId, "fal");
  return {
    userFalKey,
    usedUserKey: metaUsed || !!userFalKey,
  };
}

/** Optional apiKey opts for falSubmit/falStatus when personal key is active. */
export function byokFalOpts(userFalKey: string | null, usedUserKey: boolean): { apiKey: string } | undefined {
  return usedUserKey && userFalKey ? { apiKey: userFalKey } : undefined;
}
