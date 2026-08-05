/**
 * 共創殼 session：tab 內記住是否開啟 + 目前 phase。
 * 資料寫入（worldview／scenes）仍走既有 API；退出只關殼不刪資料（G0.4）。
 */
import { isCoCreatePhaseId, type CoCreatePhaseId } from "./coCreatePhases";

const OPEN_PREFIX = "aios.coCreate.open.";
const PHASE_PREFIX = "aios.coCreate.phase.";

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function removeStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

export function loadCoCreateOpen(projectId: string): boolean {
  return readStorage(OPEN_PREFIX + projectId) === "1";
}

export function saveCoCreateOpen(projectId: string, open: boolean): void {
  const key = OPEN_PREFIX + projectId;
  if (open) writeStorage(key, "1");
  else removeStorage(key);
}

export function loadCoCreatePhase(projectId: string): CoCreatePhaseId {
  const raw = readStorage(PHASE_PREFIX + projectId);
  return isCoCreatePhaseId(raw) ? raw : "theme";
}

export function saveCoCreatePhase(projectId: string, phase: CoCreatePhaseId): void {
  writeStorage(PHASE_PREFIX + projectId, phase);
}
