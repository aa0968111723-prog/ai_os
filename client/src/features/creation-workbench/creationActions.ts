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
  | { type: "create_plan"; goal: string; draft?: Partial<CreationDraft> }
  | {
      type: "apply_prompt";
      promptId: string;
      targetMode: CreationMode;
      /** Resolved library text when caller already has it (optional extension). */
      promptText?: string;
      modelId?: string | null;
      characterIds?: string[] | null;
      scenePresetIds?: string[] | null;
      propIds?: string[] | null;
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

/**
 * Optional bring-in fields from a Partial draft.
 * Never copies empty arrays (would wipe existing char/scene/source picks).
 * Only sets worldviewEnabled when the key is explicitly present on the partial.
 */
function pickOptionalBringInFields(source: Partial<CreationDraft>): DraftPatch {
  const patch: DraftPatch = {};
  if (typeof source.goal === "string" && source.goal) patch.goal = source.goal;
  if (typeof source.category === "string") patch.category = source.category;
  if (typeof source.modelId === "string") patch.modelId = source.modelId;
  if (typeof source.prompt === "string") patch.prompt = source.prompt;
  if (Array.isArray(source.characterIds) && source.characterIds.length > 0) {
    patch.characterIds = source.characterIds;
  }
  if (Array.isArray(source.scenePresetIds) && source.scenePresetIds.length > 0) {
    patch.scenePresetIds = source.scenePresetIds;
  }
  if (Array.isArray(source.propIds) && source.propIds.length > 0) {
    patch.propIds = source.propIds;
  }
  if (Array.isArray(source.sourceAssetIds) && source.sourceAssetIds.length > 0) {
    patch.sourceAssetIds = source.sourceAssetIds;
  }
  // Explicit only — never force true via emptyDraft defaults.
  if (
    Object.prototype.hasOwnProperty.call(source, "worldviewEnabled") &&
    typeof source.worldviewEnabled === "boolean"
  ) {
    patch.worldviewEnabled = source.worldviewEnabled;
  }
  if (typeof source.templateId === "string") patch.templateId = source.templateId;
  if (typeof source.promptSourceId === "string") patch.promptSourceId = source.promptSourceId;
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
      if (Array.isArray(d.propIds) && d.propIds.length > 0) {
        patch.propIds = d.propIds;
      }
      if (Array.isArray(d.sourceAssetIds) && d.sourceAssetIds.length > 0) {
        patch.sourceAssetIds = d.sourceAssetIds;
      }
      ctx.setDraft(patch);
      result = { patch, mode: "generate", submitted: false, charged: false };
      break;
    }

    case "run_template": {
      // templateId + goal on draft; TemplateMode wires pickRequest + idea box (no auto-start).
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
      // Only goal + mode plan required. Optional draft fields are merge-in only;
      // empty arrays / emptyDraft defaults must never wipe existing picks (§4.2).
      const fromDraft = action.draft ? pickOptionalBringInFields(action.draft) : {};
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
      // Align with generate: only apply non-empty char/scene lists so omitted/empty
      // library rows do not wipe existing workbench picks. Full-replace-with-[] is not
      // the bring-in default (PromptLibrary page path can still clear via apply channel).
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
      if (action.modelId != null && action.modelId !== "") patch.modelId = action.modelId;
      if (Array.isArray(action.characterIds) && action.characterIds.length > 0) {
        patch.characterIds = action.characterIds;
      }
      if (Array.isArray(action.scenePresetIds) && action.scenePresetIds.length > 0) {
        patch.scenePresetIds = action.scenePresetIds;
      }
      if (Array.isArray(action.propIds) && action.propIds.length > 0) {
        patch.propIds = action.propIds;
      }
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
  propIds?: string[];
  sourceAssetIds?: string[];
  goal?: string;
}): CreationAction {
  const draft = emptyDraft("generate");
  draft.prompt = opts.prompt;
  if (opts.modelId) draft.modelId = opts.modelId;
  if (opts.goal) draft.goal = opts.goal;
  if (opts.characterIds?.length) draft.characterIds = opts.characterIds;
  if (opts.scenePresetIds?.length) draft.scenePresetIds = opts.scenePresetIds;
  if (opts.propIds?.length) draft.propIds = opts.propIds;
  if (opts.sourceAssetIds?.length) draft.sourceAssetIds = opts.sourceAssetIds;
  return { type: "generate", draft };
}

/**
 * Build a create_plan bring-in (fills goal + mode plan; does not call agents.plan).
 * `draft` is a true Partial — never spreads emptyDraft() defaults (would wipe picks).
 */
export function planBringInAction(goal: string, draft?: Partial<CreationDraft>): CreationAction {
  return {
    type: "create_plan",
    goal,
    draft: draft ? { ...draft, goal, mode: "plan" } : undefined,
  };
}
