import { CHAR_NAME_MAX } from "./cardLimits";
import { classifyAssistantRequest } from "./assistantExecution";
import { isXiaohuaName, XIAOHUA_LOCKED_APPEARANCE } from "./characterIdentityLock";

/** Name-only create: confirm card still writes; appearance can be filled later. */
export const PENDING_CHARACTER_APPEARANCE = "待補外觀描述";

export type ProposedAddCharacter = {
  type: "add_character";
  name: string;
  appearance: string;
};

/**
 * When the user lists names ("幫我新增角色 小華、媽媽、禪定龜龜") the model
 * often replies「無法直接建立角色」with actions=[]. Propose confirm cards
 * instead — same path as create_project, but confirm-only (not direct).
 */
export function proposeAddCharacterActions(message: string): ProposedAddCharacter[] {
  if (classifyAssistantRequest(message).capabilityId !== "add_character") return [];
  return extractCharacterNames(message).slice(0, 6).map((name) => ({
    type: "add_character" as const,
    name,
    appearance: isXiaohuaName(name) ? XIAOHUA_LOCKED_APPEARANCE : PENDING_CHARACTER_APPEARANCE,
  }));
}

export function extractCharacterNames(message: string): string[] {
  const matched = message.match(/(?:新增|建立|加)\s*(?:角色|定裝)(?:卡)?[：:\s]*(.+)$/u);
  const rest = (matched?.[1] ?? "").replace(/[。．.！!？?]+$/u, "").trim();
  if (!rest) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of rest.split(/[,，、]/)) {
    const name = raw.trim();
    if (!name || name.length > CHAR_NAME_MAX) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
