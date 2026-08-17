/**
 * Character Slots（master plan §8）：多角色鏡的結構化表達。
 *
 * 不把 N 張圖無差別餵 provider——每個角色一個 slot，明確講：
 * 這個人是誰（canonical id／version）、穿哪套造型、identity／look 參考各是哪張、
 * 拿著哪些道具。slot 是 packet 的一部分（凍結、可指紋），
 * mixer 依 slot 排參考優先序，evaluation 依 slot 驗 face/clothes/prop swap。
 */
import type { ShotReferenceBinding } from "./shotContextPacket";

export interface CharacterSlot {
  characterId: string;
  characterRev: number | null;
  characterName: string | null;
  /** Team Canon pin（若有）：跨專案追溯與 adapter 來源 */
  canonId: string | null;
  canonVersionId: string | null;
  /** 這一鏡此角色採用的造型；null＝沿用 Identity 基準外觀 */
  lookId: string | null;
  lookRev: number | null;
  identityReferenceAssetId: string | null;
  lookReferenceAssetId: string | null;
  /** 此角色持有／隨身的道具（owner 是他才算，避免 wrong_prop_owner） */
  ownedPropIds: string[];
  /** 參考優先序（1 為主角色——排前面的角色參考先進 mixer 預算） */
  priority: number;
  /**
   * 角色聲線（closure §5）：durable voice identity。
   * 可選欄位——舊 packet 的 slots 沒有這些欄位時指紋不變。
   */
  voiceCanonId?: string | null;
  voiceVersionId?: string | null;
  voiceModelId?: string | null;
  voiceId?: string | null;
}

export interface CharacterSlotIssue {
  code: "duplicate_look_binding" | "look_without_character" | "wrong_prop_owner";
  message: string;
  characterId?: string;
  lookId?: string;
  propId?: string;
}

/**
 * 由 packet 的輸入面（角色／造型／道具／參考綁定）組 slots。
 * 造型歸屬：look.characterId 指向誰就進誰的 slot；掛不到任何在場角色的造型回報 issue。
 * 道具歸屬：ownerKind='character' 且 owner 在場才進 slot；owner 不在場回報 wrong_prop_owner。
 */
export function buildCharacterSlots(input: {
  characters: Array<{ id: string; rev: number | null; name?: string | null; referenceAssetId?: string | null }>;
  looks: Array<{ id: string; rev: number | null; characterId: string | null; referenceAssetId?: string | null }>;
  props: Array<{ id: string; ownerKind?: string | null; ownerId?: string | null }>;
  references?: readonly ShotReferenceBinding[];
  canonPins?: Array<{ localEntityId: string; canonId: string; pinnedVersionId: string }>;
}): { slots: CharacterSlot[]; issues: CharacterSlotIssue[] } {
  const issues: CharacterSlotIssue[] = [];
  const pinByEntity = new Map((input.canonPins ?? []).map((pin) => [pin.localEntityId, pin]));
  const refByOwner = new Map<string, ShotReferenceBinding[]>();
  for (const ref of input.references ?? []) {
    if (!ref.ownerId) continue;
    const list = refByOwner.get(ref.ownerId) ?? [];
    list.push(ref);
    refByOwner.set(ref.ownerId, list);
  }

  const charIds = new Set(input.characters.map((row) => row.id));
  const lookByCharacter = new Map<string, { id: string; rev: number | null; referenceAssetId?: string | null }>();
  for (const look of input.looks) {
    if (!look.characterId || !charIds.has(look.characterId)) {
      issues.push({
        code: "look_without_character",
        message: "這套造型的角色不在這一鏡，造型錨點不會生效",
        lookId: look.id,
        characterId: look.characterId ?? undefined,
      });
      continue;
    }
    if (lookByCharacter.has(look.characterId)) {
      issues.push({
        code: "duplicate_look_binding",
        message: "同一位角色綁了兩套造型，請保留一套",
        characterId: look.characterId,
        lookId: look.id,
      });
      continue;
    }
    lookByCharacter.set(look.characterId, look);
  }

  const ownedProps = new Map<string, string[]>();
  for (const prop of input.props) {
    if (prop.ownerKind !== "character" || !prop.ownerId) continue;
    if (!charIds.has(prop.ownerId)) {
      issues.push({
        code: "wrong_prop_owner",
        message: "道具的主人不在這一鏡——確認是否換了持有者，或把主人加進這一鏡",
        propId: prop.id,
        characterId: prop.ownerId,
      });
      continue;
    }
    const list = ownedProps.get(prop.ownerId) ?? [];
    list.push(prop.id);
    ownedProps.set(prop.ownerId, list);
  }

  const slots = input.characters.map((character, index) => {
    const look = lookByCharacter.get(character.id) ?? null;
    const pin = pinByEntity.get(character.id) ?? null;
    const ownRefs = refByOwner.get(character.id) ?? [];
    const identityRef = ownRefs.find((ref) => ref.role === "identity")?.assetId
      ?? character.referenceAssetId ?? null;
    const lookRef = (look ? refByOwner.get(look.id) ?? [] : []).find((ref) => ref.role === "look")?.assetId
      ?? look?.referenceAssetId ?? null;
    return {
      characterId: character.id,
      characterRev: character.rev,
      characterName: character.name ?? null,
      canonId: pin?.canonId ?? null,
      canonVersionId: pin?.pinnedVersionId ?? null,
      lookId: look?.id ?? null,
      lookRev: look?.rev ?? null,
      identityReferenceAssetId: identityRef,
      lookReferenceAssetId: lookRef,
      ownedPropIds: [...(ownedProps.get(character.id) ?? [])].sort(),
      priority: index + 1,
    } satisfies CharacterSlot;
  });

  return { slots, issues };
}
