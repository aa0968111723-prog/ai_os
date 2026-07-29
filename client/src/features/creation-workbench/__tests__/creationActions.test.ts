import { describe, expect, it, vi } from "vitest";
import {
  applyCreationAction,
  generateBringInAction,
  planBringInAction,
  type CreationAction,
  type CreationActionResult,
} from "../creationActions";
import { emptyDraft, type CreationDraft, type DraftPatch } from "../creationDraft";

function makeCtx(initial: CreationDraft = emptyDraft("ask")) {
  let draft = { ...initial };
  const patches: DraftPatch[] = [];
  const setAskInput = vi.fn();
  const onAfterApply = vi.fn();
  const setDraft = (patch: DraftPatch) => {
    patches.push(patch);
    draft = {
      ...draft,
      ...patch,
      sourceAssetIds: patch.sourceAssetIds ?? draft.sourceAssetIds,
      characterIds: patch.characterIds ?? draft.characterIds,
      scenePresetIds: patch.scenePresetIds ?? draft.scenePresetIds,
    };
  };
  return {
    get draft() {
      return draft;
    },
    patches,
    setAskInput,
    onAfterApply,
    ctx: {
      get draft() {
        return draft;
      },
      setDraft,
      setAskInput,
      onAfterApply,
    },
  };
}

function assertNoCharge(result: CreationActionResult) {
  expect(result.submitted).toBe(false);
  expect(result.charged).toBe(false);
}

describe("applyCreationAction", () => {
  it("ask: switches mode and fills goal/ask input without submit", () => {
    const harness = makeCtx();
    const result = applyCreationAction({ type: "ask", message: "給我 3 個分鏡 idea" }, harness.ctx);
    assertNoCharge(result);
    expect(result.mode).toBe("ask");
    expect(result.askMessage).toBe("給我 3 個分鏡 idea");
    expect(harness.draft.mode).toBe("ask");
    expect(harness.draft.goal).toBe("給我 3 個分鏡 idea");
    expect(harness.setAskInput).toHaveBeenCalledWith("給我 3 個分鏡 idea");
    expect(harness.onAfterApply).toHaveBeenCalledWith(result);
  });

  it("generate: fills prompt + model, switches to generate, does not wipe char/scene", () => {
    const harness = makeCtx({
      ...emptyDraft("ask"),
      characterIds: ["c1"],
      scenePresetIds: ["s1"],
      goal: "keep-me",
    });
    const action = generateBringInAction({
      prompt: "禪堂清晨薄霧",
      modelId: "fal-ai/flux/schnell",
    });
    const result = applyCreationAction(action, harness.ctx);
    assertNoCharge(result);
    expect(result.mode).toBe("generate");
    expect(harness.draft.mode).toBe("generate");
    expect(harness.draft.prompt).toBe("禪堂清晨薄霧");
    expect(harness.draft.modelId).toBe("fal-ai/flux/schnell");
    expect(harness.draft.characterIds).toEqual(["c1"]);
    expect(harness.draft.scenePresetIds).toEqual(["s1"]);
    expect(harness.draft.goal).toBe("keep-me");
  });

  it("generate: can still apply non-empty characterIds from full draft", () => {
    const harness = makeCtx(emptyDraft("ask"));
    const result = applyCreationAction(
      {
        type: "generate",
        draft: {
          ...emptyDraft("generate"),
          prompt: "x",
          characterIds: ["a", "b"],
          scenePresetIds: ["s"],
        },
      },
      harness.ctx,
    );
    assertNoCharge(result);
    expect(harness.draft.characterIds).toEqual(["a", "b"]);
    expect(harness.draft.scenePresetIds).toEqual(["s"]);
  });

  it("create_plan: sets goal + mode plan without auto-running agent", () => {
    const harness = makeCtx({
      ...emptyDraft("generate"),
      prompt: "existing prompt",
      modelId: "m1",
    });
    const result = applyCreationAction(
      planBringInAction("拆分鏡並出圖", { prompt: "existing prompt", modelId: "m1" }),
      harness.ctx,
    );
    assertNoCharge(result);
    expect(result.mode).toBe("plan");
    expect(harness.draft.mode).toBe("plan");
    expect(harness.draft.goal).toBe("拆分鏡並出圖");
    expect(harness.draft.prompt).toBe("existing prompt");
    expect(harness.draft.modelId).toBe("m1");
  });

  it("run_template: sets templateId + goal + mode template without starting workflow", () => {
    const harness = makeCtx();
    const result = applyCreationAction(
      { type: "run_template", templateId: "preset-open", goal: "片頭 15 秒" },
      harness.ctx,
    );
    assertNoCharge(result);
    expect(result.mode).toBe("template");
    expect(harness.draft.templateId).toBe("preset-open");
    expect(harness.draft.goal).toBe("片頭 15 秒");
  });

  it("apply_prompt: tracks promptSourceId and switches targetMode", () => {
    const harness = makeCtx(emptyDraft("ask"));
    const result = applyCreationAction(
      {
        type: "apply_prompt",
        promptId: "prompt-uuid-1",
        targetMode: "generate",
        promptText: "庫內存的咒語",
        modelId: "model-x",
        characterIds: ["c9"],
        scenePresetIds: [],
      },
      harness.ctx,
    );
    assertNoCharge(result);
    expect(result.mode).toBe("generate");
    expect(harness.draft.promptSourceId).toBe("prompt-uuid-1");
    expect(harness.draft.prompt).toBe("庫內存的咒語");
    expect(harness.draft.modelId).toBe("model-x");
    expect(harness.draft.characterIds).toEqual(["c9"]);
    expect(harness.draft.scenePresetIds).toEqual([]);
  });

  it("apply_prompt to plan: also sets goal from prompt text", () => {
    const harness = makeCtx();
    const result = applyCreationAction(
      {
        type: "apply_prompt",
        promptId: "p2",
        targetMode: "plan",
        promptText: "多步出片",
      },
      harness.ctx,
    );
    assertNoCharge(result);
    expect(harness.draft.mode).toBe("plan");
    expect(harness.draft.goal).toBe("多步出片");
    expect(harness.draft.promptSourceId).toBe("p2");
  });

  it("every action type reports charged=false and submitted=false", () => {
    const actions: CreationAction[] = [
      { type: "ask", message: "hi" },
      generateBringInAction({ prompt: "p" }),
      { type: "run_template", templateId: "t", goal: "g" },
      planBringInAction("goal"),
      { type: "apply_prompt", promptId: "id", targetMode: "template", promptText: "t" },
    ];
    for (const action of actions) {
      const harness = makeCtx();
      assertNoCharge(applyCreationAction(action, harness.ctx));
    }
  });
});

describe("cross-mode draft survival (pure)", () => {
  it("goal, prompt, modelId, characterIds, scenePresetIds survive mode-only patches", () => {
    let draft: CreationDraft = {
      ...emptyDraft("ask"),
      goal: "出開場三鏡",
      prompt: "禪堂晨光",
      modelId: "fal-ai/flux/schnell",
      characterIds: ["char-1"],
      scenePresetIds: ["scene-1"],
    };
    const setDraft = (patch: DraftPatch) => {
      draft = {
        ...draft,
        ...patch,
        sourceAssetIds: patch.sourceAssetIds ?? draft.sourceAssetIds,
        characterIds: patch.characterIds ?? draft.characterIds,
        scenePresetIds: patch.scenePresetIds ?? draft.scenePresetIds,
      };
    };

    // Simulate tab switches (mode only)
    for (const mode of ["generate", "template", "plan", "ask"] as const) {
      setDraft({ mode });
      expect(draft.goal).toBe("出開場三鏡");
      expect(draft.prompt).toBe("禪堂晨光");
      expect(draft.modelId).toBe("fal-ai/flux/schnell");
      expect(draft.characterIds).toEqual(["char-1"]);
      expect(draft.scenePresetIds).toEqual(["scene-1"]);
    }

    // Bring-in generate still preserves picks
    applyCreationAction(generateBringInAction({ prompt: "新提示" }), {
      draft,
      setDraft,
    });
    expect(draft.prompt).toBe("新提示");
    expect(draft.mode).toBe("generate");
    expect(draft.characterIds).toEqual(["char-1"]);
    expect(draft.goal).toBe("出開場三鏡");
  });
});
