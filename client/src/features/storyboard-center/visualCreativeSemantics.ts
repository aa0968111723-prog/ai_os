import {
  MAX_GENERATE_CHARACTERS,
  MAX_GENERATE_PROPS,
  MAX_GENERATE_SCENE_PRESETS,
} from "@shared/cardLimits";

export type ProjectChoiceFamily = "character" | "look" | "scene" | "prop" | "asset";
export type ChoiceOperation = "add" | "remove" | "replace" | "keep";

export interface ProjectChoiceShot {
  characterIds?: string[] | null;
  lookIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
  assetId?: string | null;
}

export interface ProjectChoice {
  family: ProjectChoiceFamily;
  id: string;
  ownerCharacterId?: string;
}

export interface ProjectChoiceChange {
  operation: ChoiceOperation;
  field: "characterIds" | "lookIds" | "scenePresetIds" | "propIds" | "assetId";
  value: string[] | string;
  changed: boolean;
  compatible: boolean;
  reason?: "missing-character" | "limit";
}

const LIMIT: Record<Exclude<ProjectChoiceFamily, "asset" | "look">, number> = {
  character: MAX_GENERATE_CHARACTERS,
  scene: MAX_GENERATE_SCENE_PRESETS,
  prop: MAX_GENERATE_PROPS,
};

function unique(values: readonly string[] | null | undefined): string[] {
  return [...new Set(values ?? [])];
}

/**
 * Natural project-choice semantics. `removeEverywhere` is decided once from the
 * exact writable target snapshot: a mixed batch click unifies a value instead
 * of toggling it off in some shots and on in others.
 */
export function projectChoiceChange(input: {
  shot: ProjectChoiceShot;
  choice: ProjectChoice;
  lookOwnerById?: ReadonlyMap<string, string>;
  removeEverywhere?: boolean;
}): ProjectChoiceChange {
  const { shot, choice } = input;
  if (choice.family === "asset") {
    const changed = shot.assetId !== choice.id;
    return { operation: changed ? "replace" : "keep", field: "assetId", value: choice.id, changed, compatible: true };
  }

  if (choice.family === "scene") {
    const current = unique(shot.scenePresetIds);
    const changed = current.length !== 1 || current[0] !== choice.id;
    return {
      operation: changed ? "replace" : "keep",
      field: "scenePresetIds",
      value: [choice.id],
      changed,
      compatible: true,
    };
  }

  if (choice.family === "look") {
    const current = unique(shot.lookIds);
    const has = current.includes(choice.id);
    if (has && input.removeEverywhere) {
      return { operation: "remove", field: "lookIds", value: current.filter((id) => id !== choice.id), changed: true, compatible: true };
    }
    if (has) return { operation: "keep", field: "lookIds", value: current, changed: false, compatible: true };
    if (choice.ownerCharacterId && !unique(shot.characterIds).includes(choice.ownerCharacterId)) {
      return { operation: "keep", field: "lookIds", value: current, changed: false, compatible: false, reason: "missing-character" };
    }
    const sameOwner = choice.ownerCharacterId
      ? current.filter((id) => input.lookOwnerById?.get(id) === choice.ownerCharacterId)
      : [];
    const next = [
      ...current.filter((id) => !sameOwner.includes(id)),
      choice.id,
    ];
    if (next.length > MAX_GENERATE_CHARACTERS) {
      return { operation: "keep", field: "lookIds", value: current, changed: false, compatible: false, reason: "limit" };
    }
    return {
      operation: sameOwner.length > 0 ? "replace" : "add",
      field: "lookIds",
      value: next,
      changed: true,
      compatible: true,
    };
  }

  const field = choice.family === "character" ? "characterIds" : "propIds";
  const current = unique(shot[field]);
  const has = current.includes(choice.id);
  if (has && input.removeEverywhere) {
    return { operation: "remove", field, value: current.filter((id) => id !== choice.id), changed: true, compatible: true };
  }
  if (has) return { operation: "keep", field, value: current, changed: false, compatible: true };
  if (current.length >= LIMIT[choice.family]) {
    return { operation: "keep", field, value: current, changed: false, compatible: false, reason: "limit" };
  }
  return { operation: "add", field, value: [...current, choice.id], changed: true, compatible: true };
}

export function choicePresent(shot: ProjectChoiceShot, choice: ProjectChoice): boolean {
  if (choice.family === "asset") return shot.assetId === choice.id;
  if (choice.family === "scene") return unique(shot.scenePresetIds).length === 1 && shot.scenePresetIds?.[0] === choice.id;
  const field = choice.family === "character" ? "characterIds" : choice.family === "look" ? "lookIds" : "propIds";
  return unique(shot[field]).includes(choice.id);
}

export const CHOICE_OPERATION_LABEL: Record<ChoiceOperation, string> = {
  add: "加入",
  remove: "移除",
  replace: "替換",
  keep: "保持",
};
