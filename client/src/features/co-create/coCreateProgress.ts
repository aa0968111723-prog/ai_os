/**
 * G1：共創完成條件與作品摘要（#404）。
 *
 * 與 SimpleProjectMode 對齊（勿兩套「做完」定義）：
 * - theme    ≈ 世界觀就緒 isWorldviewReady／logline 達標
 * - structure ≈ scenes.length >= 1（建議 >= 3，完成門檻用 1）
 * - visuals   ≈ 至少一格有畫面／旁白素材
 * - wrap      ≈ 至少一格已通過送審（approved）；無送審流程時可不視為強制
 *
 * session 可覆寫 phase；進度條「已完成」標記只讀伺服器資料。
 */

import type { CoCreatePhaseId } from "./coCreatePhases";
import { CO_CREATE_PHASES, coCreatePhaseIndex } from "./coCreatePhases";

export type CoCreateProgressInput = {
  /** 與 ProjectPage / isWorldviewReady 同源 */
  wvReady: boolean;
  logline?: string | null;
  tones?: readonly string[] | null;
  styles?: readonly string[] | null;
  /** 分鏡列數 */
  sceneCount: number;
  /** 有主畫面或旁白素材的格數 */
  scenesWithMedia: number;
  /** 已通過審核的格數 */
  approvedCount: number;
};

export function isThemeComplete(p: CoCreateProgressInput): boolean {
  if (p.wvReady) return true;
  return Boolean(p.logline?.trim());
}

export function isStructureComplete(p: CoCreateProgressInput): boolean {
  return p.sceneCount >= 1;
}

export function isVisualsComplete(p: CoCreateProgressInput): boolean {
  return p.scenesWithMedia >= 1;
}

export function isWrapComplete(p: CoCreateProgressInput): boolean {
  return p.approvedCount >= 1;
}

export function isPhaseComplete(id: CoCreatePhaseId, p: CoCreateProgressInput): boolean {
  switch (id) {
    case "theme":
      return isThemeComplete(p);
    case "structure":
      return isStructureComplete(p);
    case "visuals":
      return isVisualsComplete(p);
    case "wrap":
      return isWrapComplete(p);
    default:
      return false;
  }
}

/**
 * 建議當前 phase：第一個未完成的步驟；全完成 → wrap。
 * 使用者手動跳步可覆寫 session；此函式給「自動建議」與摘要用。
 */
export function deriveSuggestedPhase(p: CoCreateProgressInput): CoCreatePhaseId {
  for (const phase of CO_CREATE_PHASES) {
    if (!isPhaseComplete(phase.id, p)) return phase.id;
  }
  return "wrap";
}

/**
 * 進度條狀態：伺服器已完成 → done；目前 session phase → current；其餘 upcoming。
 * 若 session phase 已落後於建議（例如資料已滿足更後面），仍尊重 session 當下 current。
 */
export function coCreateJourneyStatesWithProgress(
  current: CoCreatePhaseId,
  p: CoCreateProgressInput,
): Array<"done" | "current" | "upcoming"> {
  const cur = coCreatePhaseIndex(current);
  return CO_CREATE_PHASES.map((phase, i) => {
    if (i === cur) return "current";
    if (isPhaseComplete(phase.id, p)) return "done";
    if (i < cur) return "done"; // 使用者已跳過／走過
    return "upcoming";
  });
}

/** 作品摘要一行（G1.2） */
export function formatCoCreateWorkSummary(p: CoCreateProgressInput): string {
  const bits: string[] = [];
  if (p.wvReady || p.logline?.trim()) {
    const line = p.logline?.trim();
    bits.push(line ? `設定：「${line.length > 28 ? `${line.slice(0, 28)}…` : line}」` : "設定✓");
  } else {
    bits.push("設定（待）");
  }
  if (p.tones && p.tones.length > 0) {
    bits.push(`調性 ${p.tones.slice(0, 2).join("、")}`);
  }
  bits.push(`分鏡 ${p.sceneCount}`);
  const missing = Math.max(0, p.sceneCount - p.scenesWithMedia);
  if (p.sceneCount === 0) {
    bits.push("畫面 0");
  } else if (missing === 0) {
    bits.push(`畫面 ${p.scenesWithMedia}/${p.sceneCount}`);
  } else {
    bits.push(`畫面 ${p.scenesWithMedia}/${p.sceneCount}（缺 ${missing}）`);
  }
  if (p.approvedCount > 0) bits.push(`已過審 ${p.approvedCount}`);
  return bits.join(" · ");
}

export function countScenesWithMedia(
  scenes: ReadonlyArray<{ assetId?: string | null; narrationAssetId?: string | null }>,
): number {
  return scenes.filter((s) => Boolean(s.assetId || s.narrationAssetId)).length;
}

export function countApprovedScenes(
  scenes: ReadonlyArray<{ status?: string | null }>,
): number {
  return scenes.filter((s) => s.status === "approved").length;
}
