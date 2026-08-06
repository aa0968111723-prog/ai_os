/**
 * G2：共創引導 × runAction 接線（#404）。
 * 純函式：phase 主 CTA、快捷句、成功後建議下一 phase。
 * 寫入／扣點仍走 ProjectAssistant ConfirmButton → assistant.runAction。
 */

import {
  coCreatePhaseById,
  type CoCreatePhaseId,
} from "./coCreatePhases";

/** 各 phase 建議的 runAction 類型（UI 標「這一步建議」；Confirm 後才執行） */
export function primaryActionTypesForPhase(
  phase: CoCreatePhaseId,
): readonly string[] {
  switch (phase) {
    case "theme":
      return ["apply_worldview_chips"];
    case "structure":
      return ["split_script", "create_scene"];
    case "visuals":
      return ["generate"];
    case "wrap":
      return [];
    default:
      return [];
  }
}

/**
 * 共創模式下 ProjectAssistant 冷啟動快捷句（階段相關；#408 短、多、可丟）。
 * 預設沿用 phase chips；theme 可加弘法向示例（可配置）。
 */
export function coCreateQuickPrompts(
  phase: CoCreatePhaseId,
  options?: { includeDharmaExample?: boolean },
): readonly string[] {
  const base = [...coCreatePhaseById(phase).chips];
  if (phase === "theme" && options?.includeDharmaExample !== false) {
    // 產品原文示例；插在最前，不取代「先隨便一個」
    if (!base.some((q) => q.includes("弘法"))) {
      base.unshift("給我三個適合弘法短片的主題方向");
    }
  }
  // 最多 4 顆，避免冷啟動過載
  return base.slice(0, 4);
}

/**
 * runAction 成功後建議進入的下一 phase（null＝不自動推進）。
 * 僅依「本步主產物」動作；不依伺服器資料（進度條仍只讀 API）。
 */
export function suggestedPhaseAfterAction(
  actionType: string,
  current: CoCreatePhaseId,
): CoCreatePhaseId | null {
  if (current === "theme" && actionType === "apply_worldview_chips") {
    return "structure";
  }
  if (
    current === "structure" &&
    (actionType === "split_script" || actionType === "create_scene")
  ) {
    return "visuals";
  }
  if (current === "visuals" && actionType === "generate") {
    return "wrap";
  }
  // wrap 是最後一步：導航打包不靠 phase 切換
  return null;
}

/** 下一 phase 的人話標籤（side notice／按鈕） */
export function phaseAdvanceNotice(
  from: CoCreatePhaseId,
  to: CoCreatePhaseId,
): string {
  const fromLabel = coCreatePhaseById(from).label;
  const toLabel = coCreatePhaseById(to).label;
  return `「${fromLabel}」這步已有成果，建議下一步：${toLabel}`;
}

/** wrap 階段只提示、不新 API */
export function wrapNextStepHint(input: {
  sceneCount: number;
  scenesWithMedia: number;
}): string {
  if (input.sceneCount === 0) {
    return "還沒有分鏡。可回到「分鏡」拆鏡頭，或退出共創用完整版。";
  }
  const missing = Math.max(0, input.sceneCount - input.scenesWithMedia);
  if (missing > 0) {
    return `還有 ${missing} 格缺畫面；可回「畫面」生成。交付／打包請用工作台完整版匯出。`;
  }
  return "畫面已齊。可退出共創，到完整版打包／匯出交付。";
}
