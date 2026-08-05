/**
 * 素材維護執行器：提高 2C/8G 控制面「有意義」的 CPU 使用率。
 * - 預設每 15 秒一輪；有佇列才做重活
 * - env：BG_ASSET_MAINT=0 關閉；BG_LAND_BATCH / BG_HASH_BATCH / BG_THUMB_BATCH
 * - 過載閘門（runnerMetrics.shouldSkipHeavyBackgroundWork）保護 API headroom
 * - 與 generationRunner 的 6s tick 錯開，避免同秒齊發
 */
import {
  assetMaintenanceEnabled,
  runAssetMaintenanceCycle,
} from "./assetMaintenance";
import {
  markRunnerStarted,
  reportRunnerTick,
  shouldSkipHeavyBackgroundWork,
} from "./runnerMetrics";
import {
  isShuttingDown,
  onShutdown,
  trackBackgroundTask,
} from "./shutdown";

const TICK_MS = 15_000;

let started = false;
let cycleRunning = false;
let lastTickAt: number | null = null;

export function assetMaintenanceHeartbeat(): {
  started: boolean;
  lastTickAt: number | null;
} {
  return { started, lastTickAt };
}

export function startAssetMaintenanceRunner(): void {
  if (started || isShuttingDown()) return;
  if (!assetMaintenanceEnabled()) {
    console.log("[asset-maint] 已停用（BG_ASSET_MAINT=0）");
    return;
  }
  started = true;
  markRunnerStarted("assetMaintenance");
  const interval = setInterval(() => {
    if (cycleRunning || isShuttingDown()) return;
    cycleRunning = true;
    void trackBackgroundTask(
      (async () => {
        try {
          await tick();
        } catch (err) {
          console.warn(
            "[asset-maint] tick 失敗（下輪再試）：",
            err instanceof Error ? err.message : err,
          );
        } finally {
          cycleRunning = false;
        }
      })(),
    );
  }, TICK_MS);
  onShutdown(() => clearInterval(interval));
  console.log(`[asset-maint] 素材維護執行器已啟動（每 ${TICK_MS / 1000} 秒一輪）`);
}

async function tick(): Promise<void> {
  const gate = shouldSkipHeavyBackgroundWork();
  const work = await runAssetMaintenanceCycle({ skipHeavy: gate.skip });
  lastTickAt = Date.now();
  const queueDepth = work.queue.unlanded + work.queue.missingSha + work.queue.missingThumb;
  reportRunnerTick("assetMaintenance", {
    started: true,
    lastTickAt,
    inflight: 0,
    queueDepth,
    lastWork: {
      landed: work.landed,
      hashed: work.hashed,
      thumbs: work.thumbs,
      unlandedQ: work.queue.unlanded,
      missingShaQ: work.queue.missingSha,
      missingThumbQ: work.queue.missingThumb,
    },
    lastSkippedReason: gate.skip ? gate.reason : work.skipped,
  });
  if (work.landed || work.hashed || work.thumbs) {
    console.log(
      `[asset-maint] 本輪 landed=${work.landed} hashed=${work.hashed} thumbs=${work.thumbs}` +
        (gate.skip ? `（skip=${gate.reason}）` : ""),
    );
  }
}
