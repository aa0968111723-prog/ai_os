/**
 * 開機就緒旗標：建表/目錄/種子完成前，API 用它回「初始化中」的友善訊息
 * （獨立小模組，避免 index.ts ↔ trpc.ts 循環引用）。
 */
let ready = false;

export function markBootReady(): void {
  ready = true;
}

export function isBootReady(): boolean {
  return ready;
}
