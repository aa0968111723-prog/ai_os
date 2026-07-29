import {
  emptyDraft,
  type CreationDraft,
  type CreationMode,
  type DraftPatch,
} from "./creationDraft";

/**
 * Unified frontend action contract (proposal §7).
 * Bring-in only: fill draft / switch mode — never auto-submit generation or charge points.
 */
export type CreationAction =
  | { type: "ask"; message: string }
  | { type: "generate"; draft: CreationDraft }
  | { type: "run_template"; templateId: string; goal: string }
  | { type: "create_plan"; goal: string; draft?: CreationDraft }
  | {
      type: "apply_prompt";
      promptId: string;
      targetMode: CreationMode;
      /** Resolved library text when caller already has it (optional extension). */
      promptText?: string;
      modelId?: string | null;
      characterIds?: string[] | null;
      scenePresetIds?: string[] | null;
    };

/** Result of applyCreationAction — always no-charge / no-submit for bring-in. */
export type CreationActionResult = {
  patch: DraftPatch;
  mode: CreationMode;
  /** Always false: bring-in never submits generation. */
  submitted: false;
  /** Always false: bring-in never charges points. */
  charged: false;
  /** For ask: message to place in Ask AI input without sending. */
  askMessage?: string;
};

export type CreationActionContext = {
  draft: CreationDraft;
  /** Patch draft (workbench setDraft / updateDraft). */
  setDraft: (patch: DraftPatch) => void;
  /** Optional: put text into Ask AI input without sending. */
  setAskInput?: (message: string) => void;
  /** Optional: after draft/mode update (focus / expand) — still no submit. */
  onAfterApply?: (result: CreationActionResult) => void;
};

/** Fields that may be carried across modes when merging a partial draft. */
function pickBringInFields(source: CreationDraft): DraftPatch {
  const patch: DraftPatch = {};
  if (source.goal !== undefined) patch.goal = source.goal;
  if (source.category !== undefined) patch.category = source.category;
  if (source.modelId !== undefined) patch.modelId = source.modelId;
  if (source.prompt !== undefined) patch.prompt = source.prompt;
  if (source.sourceAssetIds !== undefined) patch.sourceAssetIds = source.sourceAssetIds;
  if (source.characterIds !== undefined) patch.characterIds = source.characterIds;
  if (source.scenePresetIds !== undefined) patch.scenePresetIds = source.scenePresetIds;
  if (source.worldviewEnabled !== undefined) patch.worldviewEnabled = source.worldviewEnabled;
  if (source.templateId !== undefined) patch.templateId = source.templateId;
  if (source.promptSourceId !== undefined) patch.promptSourceId = source.promptSourceId;
  return patch;
}

/**
 * Apply a CreationAction: update draft and/or switch mode only.
 * Does NOT call generation.submit, agents.plan, or any charge path.
 */
export function applyCreationAction(
  action: CreationAction,
  ctx: CreationActionContext,
): CreationActionResult {
  let result: CreationActionResult;

  switch (action.type) {
    case "ask": {
      const patch: DraftPatch = { mode: "ask" };
      // Surface the ask intent in goal so cross-mode still sees what was requested.
      if (action.message.trim()) patch.goal = action.message.trim();
      ctx.setDraft(patch);
      ctx.setAskInput?.(action.message);
      result = {
        patch,
        mode: "ask",
        submitted: false,
        charged: false,
        askMessage: action.message,
      };
      break;
    }

    case "generate": {
      // Fill prompt/model and switch to generate. Do not wipe existing char/scene/source
      // picks unless the action draft carries non-empty lists (AI suggestion only knows text).
      const d = action.draft;
      const patch: DraftPatch = { mode: "generate" };
      if (typeof d.prompt === "string") patch.prompt = d.prompt;
      if (typeof d.modelId === "string") patch.modelId = d.modelId;
      if (typeof d.goal === "string" && d.goal) patch.goal = d.goal;
      if (typeof d.category === "string") patch.category = d.category;
      if (typeof d.promptSourceId === "string") patch.promptSourceId = d.promptSourceId;
      if (typeof d.templateId === "string") patch.templateId = d.templateId;
      if (Array.isArray(d.characterIds) && d.characterIds.length > 0) {
        patch.characterIds = d.characterIds;
      }
      if (Array.isArray(d.scenePresetIds) && d.scenePresetIds.length > 0) {
        patch.scenePresetIds = d.scenePresetIds;
      }
      if (Array.isArray(d.sourceAssetIds) && d.sourceAssetIds.length > 0) {
        patch.sourceAssetIds = d.sourceAssetIds;
      }
      ctx.setDraft(patch);
      result = { patch, mode: "generate", submitted: false, charged: false };
      break;
    }

    case "run_template": {
      const patch: DraftPatch = {
        mode: "template",
        templateId: action.templateId,
        goal: action.goal,
      };
      ctx.setDraft(patch);
      result = { patch, mode: "template", submitted: false, charged: false };
      break;
    }

    case "create_plan": {
      const fromDraft = action.draft ? pickBringInFields(action.draft) : {};
      const patch: DraftPatch = {
        ...fromDraft,
        goal: action.goal,
        mode: "plan",
      };
      ctx.setDraft(patch);
      result = { patch, mode: "plan", submitted: false, charged: false };
      break;
    }

    case "apply_prompt": {
      const patch: DraftPatch = {
        mode: action.targetMode,
        promptSourceId: action.promptId,
      };
      if (action.promptText != null) {
        patch.prompt = action.promptText;
        // Plan / template / ask surface the library text as the shared goal.
        if (
          action.targetMode === "plan" ||
          action.targetMode === "template" ||
          action.targetMode === "ask"
        ) {
          patch.goal = action.promptText;
        }
      }
      if (action.modelId != null) patch.modelId = action.modelId;
      if (action.characterIds != null) patch.characterIds = action.characterIds;
      if (action.scenePresetIds != null) patch.scenePresetIds = action.scenePresetIds;
      ctx.setDraft(patch);
      if (action.targetMode === "ask" && action.promptText) {
        ctx.setAskInput?.(action.promptText);
      }
      result = {
        patch,
        mode: action.targetMode,
        submitted: false,
        charged: false,
        askMessage: action.targetMode === "ask" ? action.promptText : undefined,
      };
      break;
    }

    default: {
      // Exhaustiveness: unknown action types leave draft untouched.
      const _never: never = action;
      void _never;
      result = {
        patch: {},
        mode: ctx.draft.mode,
        submitted: false,
        charged: false,
      };
    }
  }

  ctx.onAfterApply?.(result);
  return result;
}

/** Build a generate bring-in action from free text (assistant suggestion / reuse). */
export function generateBringInAction(opts: {
  prompt: string;
  modelId?: string;
  characterIds?: string[];
  scenePresetIds?: string[];
  sourceAssetIds?: string[];
  goal?: string;
}): CreationAction {
  const draft = emptyDraft("generate");
  draft.prompt = opts.prompt;
  if (opts.modelId) draft.modelId = opts.modelId;
  if (opts.goal) draft.goal = opts.goal;
  if (opts.characterIds?.length) draft.characterIds = opts.characterIds;
  if (opts.scenePresetIds?.length) draft.scenePresetIds = opts.scenePresetIds;
  if (opts.sourceAssetIds?.length) draft.sourceAssetIds = opts.sourceAssetIds;
  return { type: "generate", draft };
}

/** Build a create_plan bring-in (fills goal + mode plan; does not call agents.plan). */
export function planBringInAction(goal: string, draft?: Partial<CreationDraft>): CreationAction {
  return {
    type: "create_plan",
    goal,
    draft: draft
      ? { ...emptyDraft("plan"), ...draft, goal, mode: "plan" }
      : undefined,
  };
}
