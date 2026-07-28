/**
 * ANIM-00 動畫產線基線契約測試（純函式）。
 * 鎖定：時間真相、軟刪過濾、分鏡順序、現用版本、匯出冪等。
 */
import { describe, expect, it } from "vitest";
import {
  ANIMATION_GENERATION_SOURCES,
  applySelectAssetVersion,
  assertSelectedUniqueness,
  assignContiguousOrderIndices,
  computeSceneReorder,
  durationFromFrames,
  durationFromSec,
  excludeSoftDeleted,
  exportAssetSelectionKey,
  exportContentIdentity,
  exportIdentitiesMatch,
  findDuplicateSelectedVersions,
  findReusableExportJob,
  framesToSec,
  isNotSoftDeleted,
  legacySceneDurationSec,
  listActiveOrderedScenes,
  nextOrderIndex,
  orderIndicesAreUnique,
  reconcileSelectionStatus,
  secToFrames,
  selectionPatchForAssetKind,
  sumDurationFrames,
  sumLegacyDurationSec,
  swapAdjacentOrder,
  type AssetVersionLike,
} from "./animationContracts";

describe("ANIM-00 durationFrames is truth", () => {
  it("sec ↔ frames round-trip at 30fps", () => {
    expect(secToFrames(1, 30)).toBe(30);
    expect(secToFrames(1.5, 30)).toBe(45);
    expect(framesToSec(30, 30)).toBe(1);
    expect(framesToSec(45, 30)).toBe(1.5);
  });

  it("durationFromFrames derives durationSec; does not invent frames from bad input", () => {
    const d = durationFromFrames(90, 30);
    expect(d.durationFrames).toBe(90);
    expect(d.durationSec).toBe(3);
    expect(durationFromFrames(-1).durationFrames).toBe(0);
    expect(durationFromFrames(NaN).durationFrames).toBe(0);
  });

  it("durationFromSec normalizes via frames (single truth path)", () => {
    const d = durationFromSec(1.5, 30);
    expect(d.durationFrames).toBe(45);
    expect(d.durationSec).toBe(1.5);
    // 浮點秒先 round 成 frames，再衍生 sec——避免雙重真相
    const d2 = durationFromSec(0.333, 30);
    expect(d2.durationFrames).toBe(secToFrames(0.333, 30));
    expect(d2.durationSec).toBe(framesToSec(d2.durationFrames, 30));
  });

  it("sumDurationFrames is frame-based total (rough-cut contract)", () => {
    expect(
      sumDurationFrames([
        { durationFrames: 30 },
        { durationFrames: 45 },
        { durationFrames: 0 },
        { durationFrames: -5 },
      ]),
    ).toBe(75);
  });

  it("legacy sceneDur minimum 3s for current exporter parity", () => {
    expect(legacySceneDurationSec(5)).toBe(5);
    expect(legacySceneDurationSec(0)).toBe(3);
    expect(legacySceneDurationSec(-1)).toBe(3);
    expect(sumLegacyDurationSec([{ durationSec: 5 }, { durationSec: 0 }, { durationSec: 1.5 }])).toBe(
      5 + 3 + 1.5,
    );
  });
});

describe("ANIM-00 soft-deleted scenes excluded from lists", () => {
  const rows = [
    { id: "a", orderIndex: 2, deletedAt: null },
    { id: "b", orderIndex: 0, deletedAt: new Date("2026-01-01") },
    { id: "c", orderIndex: 1, deletedAt: null },
    { id: "d", orderIndex: 3, deletedAt: undefined },
  ];

  it("isNotSoftDeleted / excludeSoftDeleted", () => {
    expect(isNotSoftDeleted({ deletedAt: null })).toBe(true);
    expect(isNotSoftDeleted({ deletedAt: undefined })).toBe(true);
    expect(isNotSoftDeleted({ deletedAt: "2026-01-01" })).toBe(false);
    expect(excludeSoftDeleted(rows).map((r) => r.id)).toEqual(["a", "c", "d"]);
  });

  it("listActiveOrderedScenes sorts by orderIndex and drops soft-deleted", () => {
    expect(listActiveOrderedScenes(rows).map((r) => r.id)).toEqual(["c", "a", "d"]);
  });
});

describe("ANIM-00 scene order uniqueness / reorder", () => {
  const active = [
    { id: "s1", orderIndex: 0 },
    { id: "s2", orderIndex: 1 },
    { id: "s3", orderIndex: 2 },
  ];

  it("rejects duplicate orderedIds", () => {
    const r = computeSceneReorder(active, ["s1", "s1", "s2"]);
    expect(r).toEqual({ ok: false, reason: "duplicate_ids" });
  });

  it("reorders and assigns contiguous unique indices", () => {
    const r = computeSceneReorder(active, ["s3", "s1", "s2"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderedIds).toEqual(["s3", "s1", "s2"]);
    const map = assignContiguousOrderIndices(r.orderedIds);
    expect([...map.values()]).toEqual([0, 1, 2]);
    expect(orderIndicesAreUnique([...map.entries()].map(([, orderIndex]) => ({ orderIndex })))).toBe(
      true,
    );
  });

  it("appends missing active scenes at end in original relative order (QA-020)", () => {
    const r = computeSceneReorder(active, ["s2"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // s2 first; s1 then s3 by original orderIndex
    expect(r.orderedIds).toEqual(["s2", "s1", "s3"]);
  });

  it("ignores foreign ids not in active set", () => {
    const r = computeSceneReorder(active, ["foreign", "s1", "s3"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderedIds).toEqual(["s1", "s3", "s2"]);
  });

  it("nextOrderIndex skips soft-deleted conceptually (caller passes active only)", () => {
    expect(nextOrderIndex([])).toBe(0);
    expect(nextOrderIndex([{ orderIndex: 0 }, { orderIndex: 4 }])).toBe(5);
  });

  it("swapAdjacentOrder only swaps within active list", () => {
    const up = swapAdjacentOrder(active, "s2", "up");
    expect(up.map((s) => s.id)).toEqual(["s2", "s1", "s3"]);
    const atTop = swapAdjacentOrder(active, "s1", "up");
    expect(atTop.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
});

describe("ANIM-00 asset version selection single source of truth", () => {
  const baseVersions = (): AssetVersionLike[] => [
    {
      id: "v1",
      shotId: "shot-a",
      role: "visual",
      status: "selected",
      projectId: "p1",
    },
    {
      id: "v2",
      shotId: "shot-a",
      role: "visual",
      status: "candidate",
      projectId: "p1",
    },
    {
      id: "n1",
      shotId: "shot-a",
      role: "narration",
      status: "selected",
      projectId: "p1",
    },
  ];

  it("allows one selected per (shotId, role)", () => {
    expect(findDuplicateSelectedVersions(baseVersions())).toEqual([]);
    assertSelectedUniqueness(baseVersions());
  });

  it("detects duplicate selected on same (shotId, role)", () => {
    const bad = baseVersions();
    bad.push({
      id: "v3",
      shotId: "shot-a",
      role: "visual",
      status: "selected",
      projectId: "p1",
    });
    const dups = findDuplicateSelectedVersions(bad);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.role).toBe("visual");
    expect(dups[0]!.versionIds.sort()).toEqual(["v1", "v3"]);
    expect(() => assertSelectedUniqueness(bad)).toThrow(/不唯一/);
  });

  it("applySelectAssetVersion supersedes old and sets shot pointer", () => {
    const shot = {
      id: "shot-a",
      projectId: "p1",
      selectedVisualVersionId: "v1",
      selectedNarrationVersionId: "n1",
    };
    const { versions, shot: nextShot, error } = applySelectAssetVersion(baseVersions(), shot, {
      versionId: "v2",
      role: "visual",
    });
    expect(error).toBeUndefined();
    expect(nextShot.selectedVisualVersionId).toBe("v2");
    expect(nextShot.selectedNarrationVersionId).toBe("n1"); // narration untouched
    expect(versions.find((v) => v.id === "v1")!.status).toBe("superseded");
    expect(versions.find((v) => v.id === "v2")!.status).toBe("selected");
    assertSelectedUniqueness(versions);
  });

  it("rejects version from other shot / role / project", () => {
    const shot = { id: "shot-a", projectId: "p1", selectedVisualVersionId: "v1" };
    expect(
      applySelectAssetVersion(baseVersions(), shot, { versionId: "missing", role: "visual" }).error,
    ).toBe("version_not_found");

    const otherShot: AssetVersionLike = {
      id: "vx",
      shotId: "shot-b",
      role: "visual",
      status: "candidate",
      projectId: "p1",
    };
    expect(
      applySelectAssetVersion([...baseVersions(), otherShot], shot, {
        versionId: "vx",
        role: "visual",
      }).error,
    ).toBe("version_shot_mismatch");

    expect(
      applySelectAssetVersion(baseVersions(), shot, { versionId: "n1", role: "visual" }).error,
    ).toBe("version_role_mismatch");

    const cross: AssetVersionLike = {
      id: "vy",
      shotId: "shot-a",
      role: "visual",
      status: "candidate",
      projectId: "p-other",
    };
    expect(
      applySelectAssetVersion([...baseVersions(), cross], shot, {
        versionId: "vy",
        role: "visual",
      }).error,
    ).toBe("version_project_mismatch");
  });

  it("shot pointer is selection truth (status is projection)", () => {
    const shot = {
      id: "shot-a",
      selectedVisualVersionId: "v2",
      selectedNarrationVersionId: "n1",
    };
    const r = reconcileSelectionStatus(baseVersions(), shot);
    expect(r.pointerIsTruth).toBe(true);
    expect(r.visualSelectedId).toBe("v2");
    expect(r.narrationSelectedId).toBe("n1");
  });

  it("audio updates narration only; image/video update visual only", () => {
    expect(selectionPatchForAssetKind("audio", "a1")).toEqual({
      narrationAssetId: "a1",
      role: "narration",
    });
    expect(selectionPatchForAssetKind("image", "i1")).toEqual({
      assetId: "i1",
      role: "visual",
    });
    expect(selectionPatchForAssetKind("video", "vid")).toEqual({
      assetId: "vid",
      role: "visual",
    });
  });
});

describe("ANIM-00 export idempotency key behavior", () => {
  it("normalizes asset selection key (sorted unique; empty = full pack)", () => {
    expect(exportAssetSelectionKey(null)).toBe("");
    expect(exportAssetSelectionKey([])).toBe("");
    expect(exportAssetSelectionKey(["b", "a", "b"])).toBe("a,b");
  });

  it("reuses pending job with same project + asset key", () => {
    const pending = [
      {
        id: "job-1",
        projectId: "p1",
        status: "running",
        assetIds: ["b", "a"],
      },
      {
        id: "job-2",
        projectId: "p1",
        status: "queued",
        assetIds: null,
      },
    ];
    expect(findReusableExportJob(pending, "p1", ["a", "b"])?.id).toBe("job-1");
    expect(findReusableExportJob(pending, "p1", undefined)?.id).toBe("job-2");
    expect(findReusableExportJob(pending, "p1", ["c"])).toBeNull();
    expect(findReusableExportJob(pending, "p2", ["a", "b"])).toBeNull();
  });

  it("does not reuse done/failed jobs (new create allowed)", () => {
    const done = [{ id: "old", projectId: "p1", status: "done", assetIds: null as string[] | null }];
    expect(findReusableExportJob(done, "p1", null)).toBeNull();
  });

  it("same content identity matches; different selection does not", () => {
    const a = exportContentIdentity({
      projectId: "p1",
      timelineVersion: 2,
      selectedAssetVersionIds: ["v2", "v1"],
      preset: "fcpxml",
    });
    const b = exportContentIdentity({
      projectId: "p1",
      timelineVersion: 2,
      selectedAssetVersionIds: ["v1", "v2"],
      preset: "fcpxml",
    });
    const c = exportContentIdentity({
      projectId: "p1",
      timelineVersion: 2,
      selectedAssetVersionIds: ["v1", "v3"],
      preset: "fcpxml",
    });
    expect(exportIdentitiesMatch(a, b)).toBe(true);
    expect(exportIdentitiesMatch(a, c)).toBe(false);
  });
});

describe("ANIM-00 generation sources matrix labels", () => {
  it("documents all entry sources that must share policy for shot generation", () => {
    expect([...ANIMATION_GENERATION_SOURCES].sort()).toEqual(
      ["agent", "mcp", "rest", "system", "web", "workflow"].sort(),
    );
  });
});
