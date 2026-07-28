/**
 * ANIM-01 Production／Sequence／Shot adapter 測試。
 * 鎖定：Project→Production、Scene→Shot、預設 Sequence、軟刪過濾、duration 真相。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRAME_RATE,
  durationFromSec,
  secToFrames,
  sumDurationFrames,
} from "./animationContracts";
import {
  DEFAULT_PRODUCTION_FORMAT,
  DEFAULT_SEQUENCE_TITLE,
  buildProductionBundle,
  defaultSequenceFor,
  defaultSequenceId,
  findDurationInconsistencies,
  normalizeProductionFormat,
  projectStatusToProductionState,
  projectToProduction,
  sceneStatusToShotState,
  sceneToShot,
  scenesToShots,
  type ProjectRowLike,
  type SceneRowLike,
} from "./animationDomain";

const project: ProjectRowLike = {
  id: "proj-1",
  title: "禪修日常短片",
  format: "16:9",
  status: "active",
};

function scene(partial: Partial<SceneRowLike> & Pick<SceneRowLike, "id" | "orderIndex">): SceneRowLike {
  return {
    projectId: "proj-1",
    title: partial.title ?? `鏡 ${partial.orderIndex}`,
    durationSec: partial.durationSec ?? 5,
    status: partial.status ?? "todo",
    deletedAt: partial.deletedAt ?? null,
    assetId: partial.assetId ?? null,
    narrationAssetId: partial.narrationAssetId ?? null,
    prompt: partial.prompt ?? null,
    voiceover: partial.voiceover ?? null,
    ...partial,
    id: partial.id,
    orderIndex: partial.orderIndex,
  };
}

describe("ANIM-01 projectToProduction", () => {
  it("1:1 maps id === projectId by default", () => {
    const p = projectToProduction(project);
    expect(p.id).toBe("proj-1");
    expect(p.projectId).toBe("proj-1");
    expect(p.title).toBe("禪修日常短片");
    expect(p.format).toBe("16:9");
    expect(p.frameRate).toBe(DEFAULT_FRAME_RATE);
    expect(p.state).toBe("production");
  });

  it("allows override productionId and frameRate", () => {
    const p = projectToProduction(project, { productionId: "prod-x", frameRate: 24 });
    expect(p.id).toBe("prod-x");
    expect(p.projectId).toBe("proj-1");
    expect(p.frameRate).toBe(24);
  });

  it("defaults format to 16:9 when missing; custom when unknown", () => {
    expect(projectToProduction({ id: "a", title: "t" }).format).toBe(DEFAULT_PRODUCTION_FORMAT);
    expect(projectToProduction({ id: "a", title: "t", format: "9:16" }).format).toBe("9:16");
    expect(projectToProduction({ id: "a", title: "t", format: "2.39:1" }).format).toBe("custom");
  });

  it("maps archived / paused status", () => {
    expect(projectToProduction({ ...project, status: "archived" }).state).toBe("archived");
    expect(projectToProduction({ ...project, status: "paused" }).state).toBe("review");
  });
});

describe("ANIM-01 normalize helpers", () => {
  it("normalizeProductionFormat", () => {
    expect(normalizeProductionFormat(null)).toBe("16:9");
    expect(normalizeProductionFormat("1:1")).toBe("1:1");
    expect(normalizeProductionFormat("weird")).toBe("custom");
  });

  it("projectStatusToProductionState / sceneStatusToShotState", () => {
    expect(projectStatusToProductionState("active")).toBe("production");
    expect(projectStatusToProductionState(undefined)).toBe("production");
    expect(sceneStatusToShotState("todo")).toBe("draft");
    expect(sceneStatusToShotState("pending")).toBe("review");
    expect(sceneStatusToShotState("approved")).toBe("approved");
    expect(sceneStatusToShotState("needs_work")).toBe("blocked");
    expect(sceneStatusToShotState("review")).toBe("draft");
  });
});

describe("ANIM-01 defaultSequenceFor", () => {
  it("creates single sequence orderIndex 0 with stable derived id", () => {
    const production = projectToProduction(project);
    const seq = defaultSequenceFor(production);
    expect(seq.productionId).toBe(production.id);
    expect(seq.orderIndex).toBe(0);
    expect(seq.title).toBe(DEFAULT_SEQUENCE_TITLE);
    expect(seq.id).toBe(defaultSequenceId(production.id));
    expect(seq.id).toBe("proj-1:sequence:0");
  });

  it("allows custom title (e.g. project name)", () => {
    const production = projectToProduction(project);
    expect(defaultSequenceFor(production, { title: production.title }).title).toBe(project.title);
  });
});

describe("ANIM-01 sceneToShot", () => {
  it("maps fields and durationSec → durationFrames via animationContracts", () => {
    const s = scene({
      id: "sc-1",
      orderIndex: 2,
      durationSec: 1.5,
      title: "開場",
      prompt: "暖光走廊",
      voiceover: "今日靜心",
      assetId: "asset-v",
      narrationAssetId: "asset-n",
      status: "approved",
    });
    const shot = sceneToShot(s, { productionId: "proj-1", sequenceId: "proj-1:sequence:0" });
    const expected = durationFromSec(1.5, DEFAULT_FRAME_RATE);

    expect(shot.id).toBe("sc-1");
    expect(shot.productionId).toBe("proj-1");
    expect(shot.sequenceId).toBe("proj-1:sequence:0");
    expect(shot.orderIndex).toBe(2);
    expect(shot.title).toBe("開場");
    expect(shot.durationFrames).toBe(expected.durationFrames);
    expect(shot.durationFrames).toBe(secToFrames(1.5, 30));
    expect(shot.durationSec).toBe(expected.durationSec);
    expect(shot.visualPrompt).toBe("暖光走廊");
    expect(shot.narration).toBe("今日靜心");
    expect(shot.selectedVisualVersionId).toBe("asset-v");
    expect(shot.selectedNarrationVersionId).toBe("asset-n");
    expect(shot.state).toBe("approved");
    expect(shot.characterRefs).toEqual([]);
  });

  it("omits empty optional strings and null asset pointers", () => {
    const shot = sceneToShot(scene({ id: "sc-2", orderIndex: 0, prompt: "", voiceover: "" }), {
      productionId: "proj-1",
    });
    expect(shot.visualPrompt).toBeUndefined();
    expect(shot.narration).toBeUndefined();
    expect(shot.selectedVisualVersionId).toBeUndefined();
    expect(shot.selectedNarrationVersionId).toBeUndefined();
    expect(shot.sequenceId).toBeUndefined();
  });

  it("respects custom frameRate for duration conversion", () => {
    const shot = sceneToShot(scene({ id: "sc-3", orderIndex: 0, durationSec: 1 }), {
      productionId: "p",
      frameRate: 24,
    });
    expect(shot.durationFrames).toBe(24);
    expect(shot.durationSec).toBe(1);
  });
});

describe("ANIM-01 scenesToShots soft-delete + order", () => {
  const rows: SceneRowLike[] = [
    scene({ id: "a", orderIndex: 2, durationSec: 3 }),
    scene({ id: "b", orderIndex: 0, durationSec: 4, deletedAt: new Date("2026-01-01") }),
    scene({ id: "c", orderIndex: 1, durationSec: 5 }),
  ];

  it("filters soft-deleted and sorts by orderIndex (isNotSoftDeleted path)", () => {
    const shots = scenesToShots(rows, { productionId: "proj-1" });
    expect(shots.map((s) => s.id)).toEqual(["c", "a"]);
    expect(shots.every((s) => s.deletedAt == null || s.deletedAt === undefined)).toBe(true);
  });

  it("can keep deleted when excludeDeleted=false", () => {
    const shots = scenesToShots(rows, { productionId: "proj-1", excludeDeleted: false });
    expect(shots.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });
});

describe("ANIM-01 buildProductionBundle", () => {
  it("assembles production + default sequence + ordered active shots", () => {
    const scenes: SceneRowLike[] = [
      scene({
        id: "s1",
        orderIndex: 1,
        durationSec: 2,
        title: "中段",
        prompt: "p1",
        voiceover: "n1",
        assetId: "av1",
      }),
      scene({ id: "s0", orderIndex: 0, durationSec: 3, title: "開頭", status: "pending" }),
      scene({ id: "gone", orderIndex: 9, durationSec: 10, deletedAt: "2026-02-01" }),
    ];

    const bundle = buildProductionBundle(project, scenes);

    expect(bundle.production.id).toBe("proj-1");
    expect(bundle.production.projectId).toBe("proj-1");
    expect(bundle.sequences).toHaveLength(1);
    expect(bundle.sequences[0]!.id).toBe("proj-1:sequence:0");
    expect(bundle.sequences[0]!.title).toBe("主線");
    expect(bundle.shots.map((s) => s.id)).toEqual(["s0", "s1"]);
    expect(bundle.shots.every((s) => s.sequenceId === "proj-1:sequence:0")).toBe(true);
    expect(bundle.shots[0]!.state).toBe("review");
    expect(bundle.shots[1]!.selectedVisualVersionId).toBe("av1");
    expect(bundle.shots[1]!.narration).toBe("n1");
    expect(bundle.shots[1]!.visualPrompt).toBe("p1");

    // frame sum of active shots only
    expect(sumDurationFrames(bundle.shots)).toBe(
      secToFrames(3) + secToFrames(2),
    );
  });

  it("custom sequence title and productionId", () => {
    const bundle = buildProductionBundle(project, [], {
      sequenceTitle: project.title,
      productionId: "prod-override",
    });
    expect(bundle.production.id).toBe("prod-override");
    expect(bundle.production.projectId).toBe("proj-1");
    expect(bundle.sequences[0]!.id).toBe("prod-override:sequence:0");
    expect(bundle.sequences[0]!.title).toBe("禪修日常短片");
    expect(bundle.shots).toEqual([]);
  });
});

describe("ANIM-01 durationFrames/durationSec round-trip safety", () => {
  it("shots from adapter are consistent with durationFromFrames", () => {
    const scenes = [
      scene({ id: "d1", orderIndex: 0, durationSec: 5 }),
      scene({ id: "d2", orderIndex: 1, durationSec: 1.5 }),
      scene({ id: "d3", orderIndex: 2, durationSec: 0.333 }),
    ];
    const shots = scenesToShots(scenes, { productionId: "proj-1", frameRate: 30 });
    expect(findDurationInconsistencies(shots, 30)).toEqual([]);

    for (const shot of shots) {
      const via = durationFromSec(
        // 模擬「只知 sec」再正規化——與 adapter 同一條路徑
        scenes.find((s) => s.id === shot.id)!.durationSec,
        30,
      );
      expect(shot.durationFrames).toBe(via.durationFrames);
      expect(shot.durationSec).toBe(via.durationSec);
    }
  });

  it("detects hand-broken duration pairs", () => {
    expect(
      findDurationInconsistencies(
        [{ id: "bad", durationFrames: 30, durationSec: 99 }],
        30,
      ),
    ).toEqual(["bad"]);
  });
});
