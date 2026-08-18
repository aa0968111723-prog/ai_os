import { describe, expect, it } from "vitest";
import { shouldApplySceneWriteAck } from "./sceneWriteAck";

describe("shouldApplySceneWriteAck", () => {
  it("applies list + follow when insertAfter ACK lands on the same origin shot", () => {
    expect(
      shouldApplySceneWriteAck({
        mountedProjectId: "proj-a",
        writeProjectId: "proj-a",
        mountedShotId: "shot-a",
        originShotId: "shot-a",
        followSelection: true,
      }),
    ).toEqual({ applyInvalidate: true, followCreated: true, applyFieldAck: true });
  });

  it("keeps the list refresh but does not steal selection after A→B shot switch", () => {
    expect(
      shouldApplySceneWriteAck({
        mountedProjectId: "proj-a",
        writeProjectId: "proj-a",
        mountedShotId: "shot-b",
        originShotId: "shot-a",
        followSelection: true,
      }),
    ).toEqual({ applyInvalidate: true, followCreated: false, applyFieldAck: true });
  });

  it("drops a late project-A ACK after switching to project B", () => {
    expect(
      shouldApplySceneWriteAck({
        mountedProjectId: "proj-b",
        writeProjectId: "proj-a",
        mountedShotId: "shot-b",
        originShotId: "shot-a",
        writeShotId: "shot-a-new",
        followSelection: true,
      }),
    ).toEqual({ applyInvalidate: false, followCreated: false, applyFieldAck: false });
  });

  it("does not ACK B's field gate with A's update row", () => {
    expect(
      shouldApplySceneWriteAck({
        mountedProjectId: "proj-a",
        writeProjectId: "proj-a",
        mountedShotId: "shot-b",
        writeShotId: "shot-a",
      }),
    ).toEqual({ applyInvalidate: true, followCreated: false, applyFieldAck: false });
  });

  it("fails closed when the write has no project id", () => {
    expect(
      shouldApplySceneWriteAck({
        mountedProjectId: "proj-b",
        writeProjectId: undefined,
        followSelection: true,
      }),
    ).toEqual({ applyInvalidate: false, followCreated: false, applyFieldAck: false });
  });
});
