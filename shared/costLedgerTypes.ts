/**
 * TD-09 成本帳本 phase 詞彙與純 helper（無 DB／HTTP 依賴）。
 *
 * 對齊：
 * - docs/architecture/cost-ledger-model.md
 * - server/services/points.ts（delta 符號、淨消耗、reserve／refund）
 * - server/db/schema/generation.ts（cost_ledger、generations.points_*）
 *
 * 本模組不改寫入路徑；僅提供標籤、方向判定與 generation 成本快照，
 * 供報表／UI／測試共用，避免 estimated／reserved／actual／settled 混用。
 */

// ─── Phase ──────────────────────────────────────────────────────────────────

/** 成本生命週期四階段（契約詞彙；非 DB enum） */
export type CostPhase = "estimated" | "reserved" | "actual" | "settled";

/** 報表／文件建議順序 */
export const COST_PHASES: readonly CostPhase[] = [
  "estimated",
  "reserved",
  "actual",
  "settled",
] as const;

export const COST_PHASE_LABELS: Record<CostPhase, string> = {
  estimated: "預估",
  reserved: "預留",
  actual: "實際",
  settled: "結算",
};

/** phase → 中文標籤；未知字串原樣回傳（防新 phase 壞畫面） */
export function costPhaseLabel(phase: string): string {
  if (phase in COST_PHASE_LABELS) return COST_PHASE_LABELS[phase as CostPhase];
  return phase;
}

// ─── Ledger direction（由 delta 符號推導；唯一真相）────────────────────────

/**
 * 帳本列方向。與 points.ts / 維運手冊一致：
 * - delta < 0 → 扣點／預留（charge）
 * - delta > 0 → 退點／補點（refund）
 * - delta === 0 → 不應出現在正式路徑（免費不寫列）
 */
export type CostLedgerDirection = "charge" | "refund" | "zero";

export const COST_LEDGER_DIRECTION_LABELS: Record<CostLedgerDirection, string> = {
  charge: "扣點／預留",
  refund: "退點／補點",
  zero: "零變動",
};

export function ledgerDirection(delta: number): CostLedgerDirection {
  if (!Number.isFinite(delta) || delta === 0) return "zero";
  return delta < 0 ? "charge" : "refund";
}

export function ledgerDirectionLabel(direction: CostLedgerDirection): string {
  return COST_LEDGER_DIRECTION_LABELS[direction];
}

/**
 * 淨消耗（點）：-SUM(delta)。
 * 與 usedTotal / usedByGroup / reserveQuota 聚合口徑一致。
 * 非 finite 的元素略過（防髒資料灌 NaN）。
 */
export function netConsumedPoints(deltas: readonly number[]): number {
  let sum = 0;
  for (const d of deltas) {
    if (Number.isFinite(d)) sum += d;
  }
  // 避免 -0（Object.is(-0, 0) === false）；淨消耗語意上不區分符號零
  const net = -sum;
  return net === 0 ? 0 : net;
}

/** 單列對淨消耗的貢獻：-delta（charge 為正消耗、refund 為負消耗） */
export function deltaToConsumed(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  return -delta;
}

// ─── Generation cost snapshot ───────────────────────────────────────────────

/** 可推導快照的最小 generation 欄位（與 schema 對齊，不依賴 drizzle 型別） */
export type GenerationCostFields = {
  pointsEst: number;
  pointsActual?: number | null;
  pointsRefunded?: number | null;
  /**
   * generations.status：
   * awaiting_approval | rejected | queued | running | done | failed
   */
  status: string;
  /**
   * 可選：該 generation 在 cost_ledger 的 SUM(delta)。
   * 有則 settled／在途 reserved 以帳本為準；無則依 status 推導。
   */
  ledgerNetDelta?: number | null;
};

/**
 * 單一生成在四 phase 上的可顯示快照（整數點數；負值夾成 0）。
 * - estimated：永遠來自 points_est
 * - reserved：在途（queued/running 且已扣）占用；終局為 0
 * - actual：完成時 points_actual，否則 null
 * - settled：最終歸使用者的淨消耗（在途為 0）
 * - phase：UI 徽章用的「目前主語意」
 */
export type GenerationCostSnapshot = {
  estimated: number;
  reserved: number;
  actual: number | null;
  settled: number;
  refunded: number;
  phase: CostPhase;
};

function nonNegInt(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * 由 generation 欄位（與可選帳本淨額）推導成本快照。
 * 不讀 DB；守門與扣點仍必須走 points.ts。
 */
export function generationCostSnapshot(input: GenerationCostFields): GenerationCostSnapshot {
  const estimated = nonNegInt(input.pointsEst);
  const refunded = nonNegInt(input.pointsRefunded);
  const status = (input.status ?? "").trim();
  const hasActual = input.pointsActual != null && Number.isFinite(input.pointsActual);
  const actual: number | null = hasActual ? nonNegInt(input.pointsActual) : null;

  const ledgerProvided =
    input.ledgerNetDelta != null && Number.isFinite(input.ledgerNetDelta);
  /** 帳本淨消耗（正＝使用者仍被扣著） */
  const ledgerConsumed = ledgerProvided ? Math.max(0, -Number(input.ledgerNetDelta)) : null;

  // 待核／駁回：核准前不扣點
  if (status === "awaiting_approval") {
    return {
      estimated,
      reserved: 0,
      actual: null,
      settled: 0,
      refunded: 0,
      phase: "estimated",
    };
  }
  if (status === "rejected") {
    return {
      estimated,
      reserved: 0,
      actual: null,
      settled: 0,
      refunded,
      phase: "estimated",
    };
  }

  // 在途：queued / running → reserved（帳本已扣則占用額度）
  if (status === "queued" || status === "running") {
    const reserved = ledgerConsumed != null ? ledgerConsumed : estimated;
    return {
      estimated,
      reserved,
      actual: null,
      settled: 0,
      refunded: 0,
      phase: reserved > 0 ? "reserved" : "estimated",
    };
  }

  // 完成：settled = actual ?? est（或帳本淨額）
  if (status === "done") {
    const settled =
      ledgerConsumed != null ? ledgerConsumed : actual != null ? actual : estimated;
    return {
      estimated,
      reserved: 0,
      actual: actual ?? estimated,
      settled,
      refunded,
      phase: "settled",
    };
  }

  // 失敗：全額退回後 settled 0；若帳本仍有淨扣則以帳本為準（對帳異常可見）
  if (status === "failed") {
    const settled = ledgerConsumed != null ? ledgerConsumed : 0;
    // points_refunded 未填時：帳本已歸零且有估價 → 推斷已退 est（與現況 CAS 退點一致）
    const inferredRefund =
      refunded > 0 ? refunded : settled === 0 && estimated > 0 ? estimated : refunded;
    return {
      estimated,
      reserved: 0,
      actual: null,
      settled,
      refunded: inferredRefund,
      phase: "settled",
    };
  }

  // 未知狀態：保守只暴露 estimated，避免誤報 settled
  return {
    estimated,
    reserved: 0,
    actual,
    settled: ledgerConsumed != null ? ledgerConsumed : 0,
    refunded,
    phase: "estimated",
  };
}

/**
 * 快照上某個 phase 的點數（actual 為 null 時回 0，方便加總）。
 * settled／reserved／estimated 直接取欄位。
 */
export function snapshotPhasePoints(
  snapshot: GenerationCostSnapshot,
  phase: CostPhase,
): number {
  switch (phase) {
    case "estimated":
      return snapshot.estimated;
    case "reserved":
      return snapshot.reserved;
    case "actual":
      return snapshot.actual ?? 0;
    case "settled":
      return snapshot.settled;
    default:
      return 0;
  }
}

/** 將 phase 點數格式成「預估 12 點」這類短標籤 */
export function formatCostPhasePoints(phase: CostPhase, points: number): string {
  const n = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  return `${costPhaseLabel(phase)} ${n} 點`;
}
