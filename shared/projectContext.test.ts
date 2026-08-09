import { describe, expect, it } from "vitest";
import {
  CONTEXT_ROLES,
  contextPriorityRank,
  contextRoleOrderFor,
  contextScopeRank,
  contextSourceRank,
  isConfirmedContextSource,
  isSingleValuedRole,
  orderContextForIntent,
  primaryReferenceFor,
  rankResolvedContext,
  resolveContextInheritance,
  type ContextBindingLike,
  type ContextPriority,
  type ContextRole,
  type ContextScopeType,
  type ContextSource,
} from "./projectContext";

/**
 * Context 繼承與優先序的行為契約。
 *
 * 這裡釘死的是「AI 到底會拿到哪幾份、誰排前面」——錯了不會噴錯，
 * 只會讓生成結果莫名其妙（例如 Shot 明明指定了 Style，卻仍套用專案的舊風格）。
 */

let seq = 0;
function binding(over: Partial<ContextBindingLike> = {}): ContextBindingLike {
  seq += 1;
  return {
    id: `binding-${seq}`,
    scopeType: "project" as ContextScopeType,
    scopeId: "project-1",
    role: "CHARACTER_REFERENCE" as ContextRole,
    priority: "SECONDARY" as ContextPriority,
    source: "USER_CONFIRMED" as ContextSource,
    confidence: null,
    confirmedByUser: true,
    intelligenceId: null,
    resourceKind: "asset",
    resourceId: `asset-${seq}`,
    ...over,
  };
}

describe("resolveContextInheritance", () => {
  it("★ 單值角色：Shot 指定了 Style，就整組取代 Scene 與 Project 的 Style", () => {
    const projectStyle = binding({ role: "STYLE_REFERENCE", scopeType: "project", resourceId: "style-project" });
    const shotStyle = binding({ role: "STYLE_REFERENCE", scopeType: "shot", scopeId: "shot-1", resourceId: "style-shot" });
    const resolved = resolveContextInheritance([projectStyle, shotStyle]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.binding.resourceId).toBe("style-shot");
  });

  it("★ 單值角色：Shot 沒指定就繼承 Scene；Scene 沒指定才用 Project", () => {
    const projectStyle = binding({ role: "STYLE_REFERENCE", scopeType: "project", resourceId: "style-project" });
    const sceneStyle = binding({ role: "STYLE_REFERENCE", scopeType: "scene", scopeId: "scene-1", resourceId: "style-scene" });
    const withScene = resolveContextInheritance([projectStyle, sceneStyle]);
    expect(withScene.map((entry) => entry.binding.resourceId)).toEqual(["style-scene"]);

    const onlyProject = resolveContextInheritance([projectStyle]);
    expect(onlyProject.map((entry) => entry.binding.resourceId)).toEqual(["style-project"]);
  });

  it("多值角色：各層聯集，外層的標成 INHERITED", () => {
    const projectRef = binding({ scopeType: "project", resourceId: "photo-a" });
    const shotRef = binding({ scopeType: "shot", scopeId: "shot-1", resourceId: "photo-b" });
    const resolved = resolveContextInheritance([projectRef, shotRef]);
    expect(resolved).toHaveLength(2);
    const byResource = new Map(resolved.map((entry) => [entry.binding.resourceId, entry]));
    expect(byResource.get("photo-b")!.effectiveSource).toBe("USER_CONFIRMED");
    expect(byResource.get("photo-a")!.effectiveSource).toBe("INHERITED");
  });

  it("★ 本鏡 override：同一份資源只留最靠近 Shot 的那筆（Shot 可以把它提成 PRIMARY）", () => {
    const projectRef = binding({ scopeType: "project", resourceId: "photo-a", priority: "SECONDARY" });
    const shotRef = binding({ scopeType: "shot", scopeId: "shot-1", resourceId: "photo-a", priority: "PRIMARY" });
    const resolved = resolveContextInheritance([projectRef, shotRef]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.binding.priority).toBe("PRIMARY");
    expect(resolved[0]!.fromScope).toBe("shot");
  });

  it("解析結果依 Shot > Scene > Project 排序", () => {
    const resolved = resolveContextInheritance([
      binding({ scopeType: "project", resourceId: "p" }),
      binding({ scopeType: "shot", scopeId: "shot-1", resourceId: "s" }),
      binding({ scopeType: "scene", scopeId: "scene-1", resourceId: "c" }),
    ]);
    expect(resolved.map((entry) => entry.fromScope)).toEqual(["shot", "scene", "project"]);
  });
});

describe("優先序", () => {
  it("PRIMARY 排在 SECONDARY 前面——300 張照片不會同權", () => {
    const ranked = rankResolvedContext([
      { binding: binding({ priority: "SUPPORTING", resourceId: "c" }), effectiveSource: "USER_CONFIRMED", fromScope: "project" },
      { binding: binding({ priority: "PRIMARY", resourceId: "a" }), effectiveSource: "USER_CONFIRMED", fromScope: "project" },
      { binding: binding({ priority: "SECONDARY", resourceId: "b" }), effectiveSource: "USER_CONFIRMED", fromScope: "project" },
    ]);
    expect(ranked.map((entry) => entry.binding.resourceId)).toEqual(["a", "b", "c"]);
  });

  it("同優先度時，使用者確認的排在 AI 建議前面", () => {
    expect(contextSourceRank("USER_CONFIRMED")).toBeGreaterThan(contextSourceRank("AI_SUGGESTED"));
    expect(contextSourceRank("PROJECT_CONFIRMED")).toBeGreaterThan(contextSourceRank("GLOBAL_RETRIEVAL"));
    expect(contextPriorityRank("PRIMARY")).toBeGreaterThan(contextPriorityRank("SUPPORTING"));
    expect(contextScopeRank("shot")).toBeGreaterThan(contextScopeRank("project"));
  });

  it("primaryReferenceFor 只看該角色", () => {
    const entries = [
      { binding: binding({ role: "STYLE_REFERENCE", priority: "PRIMARY", resourceId: "style" }), effectiveSource: "USER_CONFIRMED" as ContextSource, fromScope: "project" as ContextScopeType },
      { binding: binding({ role: "CHARACTER_REFERENCE", priority: "PRIMARY", resourceId: "安倢定裝正面" }), effectiveSource: "USER_CONFIRMED" as ContextSource, fromScope: "project" as ContextScopeType },
    ];
    expect(primaryReferenceFor(entries, "CHARACTER_REFERENCE")!.binding.resourceId).toBe("安倢定裝正面");
  });
});

describe("★ AI 建議永遠不會自己變成使用者確認", () => {
  it("只有 USER_CONFIRMED 與 PROJECT_CONFIRMED 算「人確認過」", () => {
    expect(isConfirmedContextSource("USER_CONFIRMED")).toBe(true);
    expect(isConfirmedContextSource("PROJECT_CONFIRMED")).toBe(true);
    expect(isConfirmedContextSource("AI_SUGGESTED")).toBe(false);
    expect(isConfirmedContextSource("INHERITED")).toBe(false);
    expect(isConfirmedContextSource("GLOBAL_RETRIEVAL")).toBe(false);
  });

  it("繼承不會把 AI 建議升級成確認", () => {
    const suggested = binding({
      scopeType: "project", source: "AI_SUGGESTED", confirmedByUser: false, resourceId: "maybe",
    });
    const resolved = resolveContextInheritance([suggested]);
    expect(resolved[0]!.binding.confirmedByUser).toBe(false);
    expect(isConfirmedContextSource(resolved[0]!.effectiveSource)).toBe(false);
  });
});

describe("intent 角色順序", () => {
  it("每種 intent 都涵蓋全部角色（不漏、不重）", () => {
    const order = contextRoleOrderFor("image");
    expect(new Set(order).size).toBe(CONTEXT_ROLES.length);
    expect(order.slice(0, 3)).toEqual(["CHARACTER_REFERENCE", "LOCATION_REFERENCE", "STYLE_REFERENCE"]);
  });

  it("生圖時人物參考排在研究資料前面", () => {
    const ordered = orderContextForIntent([
      { binding: binding({ role: "RESEARCH", resourceId: "doc" }), effectiveSource: "USER_CONFIRMED", fromScope: "project" },
      { binding: binding({ role: "CHARACTER_REFERENCE", resourceId: "安倢" }), effectiveSource: "USER_CONFIRMED", fromScope: "project" },
    ], "image");
    expect(ordered[0]!.binding.resourceId).toBe("安倢");
  });

  it("風格／腳本／世界觀是單值角色，人物與場景參考不是", () => {
    expect(isSingleValuedRole("STYLE_REFERENCE")).toBe(true);
    expect(isSingleValuedRole("SCRIPT_SOURCE")).toBe(true);
    expect(isSingleValuedRole("WORLD_BUILDING")).toBe(true);
    expect(isSingleValuedRole("CHARACTER_REFERENCE")).toBe(false);
    expect(isSingleValuedRole("VISUAL_REFERENCE")).toBe(false);
  });
});
