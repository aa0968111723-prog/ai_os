import { describe, expect, it } from "vitest";
import { parseTaipeiScheduleTime, scheduleTitleFromMessage } from "./assistantScheduleTime";

describe("parseTaipeiScheduleTime", () => {
  const now = new Date("2026-08-12T01:00:00.000Z"); // 09:00 in Taipei on Aug 12

  it("Q13: 安排明天下午三點 is tomorrow 15:00 +08:00, not a dropped string", () => {
    expect(parseTaipeiScheduleTime("幫我安排明天下午三點的會議", now)).toBe("2026-08-13T15:00:00+08:00");
    expect(scheduleTitleFromMessage("幫我安排明天下午三點的會議")).toBe("會議");
  });

  it("understands 今天/後天 and 點半", () => {
    expect(parseTaipeiScheduleTime("今天下午三點半", now)).toBe("2026-08-12T15:30:00+08:00");
    expect(parseTaipeiScheduleTime("後天早上九點", now)).toBe("2026-08-14T09:00:00+08:00");
  });

  it("does not invent a clock when the user only said 明天開會", () => {
    expect(parseTaipeiScheduleTime("幫我安排明天開會", now)).toBeUndefined();
  });
});
