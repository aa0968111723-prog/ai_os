import { describe, expect, it } from "vitest";
import {
  IDEMPOTENT_FAILED_GENERATION_RETRY,
  shouldReplayIdempotentGeneration,
  shouldRotateGenerateIntoRequestId,
} from "./generationIdempotency";

describe("generateInto idempotent replay must not no-op a failed first send", () => {
  it("replays in-flight and landed receipts only", () => {
    expect(shouldReplayIdempotentGeneration("queued")).toBe(true);
    expect(shouldReplayIdempotentGeneration("running")).toBe(true);
    expect(shouldReplayIdempotentGeneration("awaiting_approval")).toBe(true);
    expect(shouldReplayIdempotentGeneration("done")).toBe(true);
  });

  it("refuses failed / rejected so retry is not a silent no-op", () => {
    expect(shouldReplayIdempotentGeneration("failed")).toBe(false);
    expect(shouldReplayIdempotentGeneration("rejected")).toBe(false);
  });

  it("rotates the clientRequestId after a failed first send", () => {
    expect(shouldRotateGenerateIntoRequestId(IDEMPOTENT_FAILED_GENERATION_RETRY)).toBe(true);
    expect(shouldRotateGenerateIntoRequestId("生成送出失敗，點數已退回，請重試")).toBe(true);
    expect(shouldRotateGenerateIntoRequestId("The operation was aborted due to timeout")).toBe(false);
    expect(shouldRotateGenerateIntoRequestId("這一格正在生成或待核准中，請稍候再生成")).toBe(false);
  });
});
