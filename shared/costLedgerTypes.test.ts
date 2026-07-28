import { describe, expect, it } from "vitest";
import {
  COST_PHASES,
  COST_PHASE_LABELS,
  costPhaseLabel,
  ledgerDirection,
  ledgerDirectionLabel,
  netConsumedPoints,
  deltaToConsumed,
  generationCostSnapshot,
  snapshotPhasePoints,
  formatCostPhasePoints,
} from "./costLedgerTypes";

describe("costPhaseLabel", () => {
  it("四 phase 有中文標籤", () => {
    expect(COST_PHASES).toEqual(["estimated", "reserved", "actual", "settled"]);
    expect(costPhaseLabel("estimated")).toBe("預估");
    expect(costPhaseLabel("reserved")).toBe("預留");
    expect(costPhaseLabel("actual")).toBe("實際");
    expect(costPhaseLabel("settled")).toBe("結算");
    expect(COST_PHASE_LABELS.reserved).toBe("預留");
  });

  it("未知 phase 原樣回傳", () => {
    expect(costPhaseLabel("storage")).toBe("storage");
  });
});

describe("ledgerDirection（delta 符號＝唯一真相）", () => {
  it("負＝charge、正＝refund、0／NaN＝zero", () => {
    expect(ledgerDirection(-12)).toBe("charge");
    expect(ledgerDirection(12)).toBe("refund");
    expect(ledgerDirection(0)).toBe("zero");
    expect(ledgerDirection(Number.NaN)).toBe("zero");
  });

  it("方向標籤", () => {
    expect(ledgerDirectionLabel("charge")).toContain("扣點");
    expect(ledgerDirectionLabel("refund")).toContain("退點");
  });
});

describe("netConsumedPoints / deltaToConsumed", () => {
  it("單筆扣點：淨消耗為正", () => {
    expect(netConsumedPoints([-30])).toBe(30);
    expect(deltaToConsumed(-30)).toBe(30);
  });

  it("扣後全退：淨消耗 0", () => {
    expect(netConsumedPoints([-30, 30])).toBe(0);
  });

  it("扣 30 只退 10：淨消耗 20", () => {
    expect(netConsumedPoints([-30, 10])).toBe(20);
  });

  it("空列與非 finite 略過", () => {
    expect(netConsumedPoints([])).toBe(0);
    expect(netConsumedPoints([Number.NaN, -5, Number.POSITIVE_INFINITY])).toBe(5);
  });
});

describe("generationCostSnapshot 生命週期", () => {
  it("awaiting_approval：僅 estimated，不預留不結算", () => {
    const s = generationCostSnapshot({
      pointsEst: 31,
      status: "awaiting_approval",
    });
    expect(s).toMatchObject({
      estimated: 31,
      reserved: 0,
      actual: null,
      settled: 0,
      phase: "estimated",
    });
  });

  it("rejected：同待核，settled 0", () => {
    const s = generationCostSnapshot({ pointsEst: 10, status: "rejected" });
    expect(s.settled).toBe(0);
    expect(s.reserved).toBe(0);
    expect(s.phase).toBe("estimated");
  });

  it("queued：預留 est，settled 0", () => {
    const s = generationCostSnapshot({ pointsEst: 12, status: "queued" });
    expect(s.reserved).toBe(12);
    expect(s.settled).toBe(0);
    expect(s.phase).toBe("reserved");
  });

  it("running：可選帳本淨額覆寫 reserved", () => {
    const s = generationCostSnapshot({
      pointsEst: 12,
      status: "running",
      ledgerNetDelta: -8, // 異常/部分；以帳本為準
    });
    expect(s.reserved).toBe(8);
    expect(s.settled).toBe(0);
  });

  it("done：actual 預設 est，settled＝actual", () => {
    const s = generationCostSnapshot({
      pointsEst: 20,
      pointsActual: 20,
      status: "done",
    });
    expect(s.actual).toBe(20);
    expect(s.reserved).toBe(0);
    expect(s.settled).toBe(20);
    expect(s.phase).toBe("settled");
  });

  it("done 缺 pointsActual 時回退 est", () => {
    const s = generationCostSnapshot({ pointsEst: 7, status: "done" });
    expect(s.actual).toBe(7);
    expect(s.settled).toBe(7);
  });

  it("done 以帳本淨額為 settled 真相", () => {
    const s = generationCostSnapshot({
      pointsEst: 20,
      pointsActual: 20,
      status: "done",
      ledgerNetDelta: -18,
    });
    expect(s.settled).toBe(18);
  });

  it("failed 全退：settled 0、refunded＝est", () => {
    const s = generationCostSnapshot({
      pointsEst: 15,
      pointsRefunded: 15,
      status: "failed",
      ledgerNetDelta: 0,
    });
    expect(s.settled).toBe(0);
    expect(s.refunded).toBe(15);
    expect(s.reserved).toBe(0);
    expect(s.phase).toBe("settled");
  });

  it("failed 未填 pointsRefunded 且帳本歸零 → 推斷退 est", () => {
    const s = generationCostSnapshot({
      pointsEst: 9,
      status: "failed",
      ledgerNetDelta: 0,
    });
    expect(s.refunded).toBe(9);
    expect(s.settled).toBe(0);
  });

  it("failed 帳本仍淨扣 → settled 暴露異常", () => {
    const s = generationCostSnapshot({
      pointsEst: 9,
      pointsRefunded: 0,
      status: "failed",
      ledgerNetDelta: -9,
    });
    expect(s.settled).toBe(9);
  });

  it("免費 0 點：各 phase 為 0", () => {
    const s = generationCostSnapshot({ pointsEst: 0, status: "queued" });
    expect(s.reserved).toBe(0);
    expect(s.phase).toBe("estimated");
  });

  it("負估價夾成 0", () => {
    const s = generationCostSnapshot({ pointsEst: -3, status: "done" });
    expect(s.estimated).toBe(0);
    expect(s.settled).toBe(0);
  });
});

describe("snapshotPhasePoints / formatCostPhasePoints", () => {
  it("依 phase 取點數", () => {
    const s = generationCostSnapshot({
      pointsEst: 10,
      pointsActual: 10,
      status: "done",
    });
    expect(snapshotPhasePoints(s, "estimated")).toBe(10);
    expect(snapshotPhasePoints(s, "reserved")).toBe(0);
    expect(snapshotPhasePoints(s, "actual")).toBe(10);
    expect(snapshotPhasePoints(s, "settled")).toBe(10);
  });

  it("格式化短標籤", () => {
    expect(formatCostPhasePoints("reserved", 12)).toBe("預留 12 點");
    expect(formatCostPhasePoints("settled", 0)).toBe("結算 0 點");
  });
});
