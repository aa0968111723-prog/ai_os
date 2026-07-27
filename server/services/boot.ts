/**
 * 開機就緒旗標：migration/schema 驗證、目錄與種子同步完成前，API 回「初始化中」
 * （獨立小模組，避免 index.ts ↔ trpc.ts 循環引用）。
 */
export interface BootState {
  isReady(): boolean;
  markReady(): void;
  markDraining(): void;
}

export function createBootState(): BootState {
  let phase: "initializing" | "ready" | "draining" = "initializing";
  return {
    isReady: () => phase === "ready",
    markReady: () => {
      // A slow bootstrap is allowed to finish while shutdown is draining, but
      // it must never turn readiness green again.
      if (phase !== "draining") phase = "ready";
    },
    markDraining: () => {
      phase = "draining";
    },
  };
}

const bootState = createBootState();

export function markBootReady(): void {
  bootState.markReady();
}

export function markBootDraining(): void {
  bootState.markDraining();
}

export function isBootReady(): boolean {
  return bootState.isReady();
}
