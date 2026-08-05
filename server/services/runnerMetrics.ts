/**
 * 背景執行器可觀測性（server utilization）：
 * 各 runner 在 tick 結束時回報心跳與佇列深度；/api/ready 與 admin.runnerStatus 讀取。
 * 純記憶體、零 DB 成本；多實例各自回報本進程狀態（不跨進程聚合）。
 */
import os from "node:os";

export type RunnerName =
  | "generation"
  | "agent"
  | "workflow"
  | "export"
  | "groupCampaign"
  | "assetMaintenance";

export interface RunnerSnapshot {
  name: RunnerName;
  started: boolean;
  lastTickAt: number | null;
  /** 本進程 inflight 數量（正在推進中） */
  inflight: number;
  /** 最近一次 tick 看到的待辦佇列深度；null＝尚未量測 */
  queueDepth: number | null;
  /** 可選：本輪處理統計（landed / hashed / thumbs 等） */
  lastWork: Record<string, number> | null;
  /** 最近一次因資源過載而跳過重工作 */
  lastSkippedReason: string | null;
}

type SnapshotPatch = Partial<Omit<RunnerSnapshot, "name">>;

const snapshots = new Map<RunnerName, RunnerSnapshot>();

function empty(name: RunnerName): RunnerSnapshot {
  return {
    name,
    started: false,
    lastTickAt: null,
    inflight: 0,
    queueDepth: null,
    lastWork: null,
    lastSkippedReason: null,
  };
}

/** runner 啟動時呼叫一次 */
export function markRunnerStarted(name: RunnerName): void {
  const cur = snapshots.get(name) ?? empty(name);
  snapshots.set(name, { ...cur, started: true });
}

/** 每輪 tick 結束時回報（可部分更新） */
export function reportRunnerTick(name: RunnerName, patch: SnapshotPatch = {}): void {
  const cur = snapshots.get(name) ?? empty(name);
  snapshots.set(name, {
    ...cur,
    started: patch.started ?? cur.started ?? true,
    lastTickAt: patch.lastTickAt ?? Date.now(),
    inflight: patch.inflight ?? cur.inflight,
    queueDepth: patch.queueDepth !== undefined ? patch.queueDepth : cur.queueDepth,
    lastWork: patch.lastWork !== undefined ? patch.lastWork : cur.lastWork,
    lastSkippedReason:
      patch.lastSkippedReason !== undefined ? patch.lastSkippedReason : cur.lastSkippedReason,
  });
}

export function getRunnerSnapshot(name: RunnerName): RunnerSnapshot {
  return snapshots.get(name) ?? empty(name);
}

export function listRunnerSnapshots(): RunnerSnapshot[] {
  const order: RunnerName[] = [
    "generation",
    "agent",
    "workflow",
    "export",
    "groupCampaign",
    "assetMaintenance",
  ];
  return order.map((name) => getRunnerSnapshot(name));
}

/** 與 generationRunner.runnerHeartbeat 相容的精簡形狀 */
export function generationHeartbeatFromMetrics(): { started: boolean; lastTickAt: number | null } {
  const s = getRunnerSnapshot("generation");
  return { started: s.started, lastTickAt: s.lastTickAt };
}

export interface ProcessResourceSnapshot {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  /** 1 分鐘 load average（Linux）；非 Linux 為 null */
  load1: number | null;
  freememMb: number | null;
  totalmemMb: number | null;
  cpus: number;
}

export function processResourceSnapshot(): ProcessResourceSnapshot {
  const mem = process.memoryUsage();
  let load1: number | null = null;
  let freememMb: number | null = null;
  let totalmemMb: number | null = null;
  let cpus = 0;
  try {
    const loads = os.loadavg();
    load1 = typeof loads[0] === "number" ? loads[0] : null;
    freememMb = Math.round(os.freemem() / (1024 * 1024));
    totalmemMb = Math.round(os.totalmem() / (1024 * 1024));
    cpus = os.cpus()?.length ?? 0;
  } catch {
    /* restricted */
  }
  return {
    rssMb: Math.round(mem.rss / (1024 * 1024)),
    heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    externalMb: Math.round(mem.external / (1024 * 1024)),
    load1,
    freememMb,
    totalmemMb,
    cpus,
  };
}

/**
 * 背景重工作的過載閘門：2C/8G 上保護 API headroom。
 * - RSS > 6GB 或 freemem < 400MB → skip
 * - load1 > 0.9 * cpuCount（約 90% of cores）→ skip
 */
export function shouldSkipHeavyBackgroundWork(): { skip: boolean; reason: string | null } {
  const r = processResourceSnapshot();
  if (r.rssMb >= 6_000) {
    return { skip: true, reason: `rss_high:${r.rssMb}MB` };
  }
  if (r.freememMb != null && r.freememMb < 400) {
    return { skip: true, reason: `freemem_low:${r.freememMb}MB` };
  }
  const cores = Math.max(1, r.cpus || 2);
  const loadCap = cores * 0.9;
  if (r.load1 != null && r.load1 > loadCap) {
    return { skip: true, reason: `load1_high:${r.load1.toFixed(2)}` };
  }
  return { skip: false, reason: null };
}

/** 測試用：清空快照 */
export function resetRunnerMetricsForTests(): void {
  snapshots.clear();
}
