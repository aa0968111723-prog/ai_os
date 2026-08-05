/**
 * 「陪你做完」G0–G1 共創 phase 定義（#404）。
 * 純函式，便於單元測試；完成條件由 G1 接 projects/scenes query，G0 只做可點進度條。
 */

export type CoCreatePhaseId = "theme" | "structure" | "visuals" | "wrap";

export type CoCreatePhase = {
  id: CoCreatePhaseId;
  /** 進度條短標 */
  label: string;
  /** 本步只做什麼（#408 D2） */
  focus: string;
  /** 冷啟動 chip（#408 D1：短、多、可丟） */
  chips: readonly string[];
};

export const CO_CREATE_PHASES: readonly CoCreatePhase[] = [
  {
    id: "theme",
    label: "定調",
    focus: "本步只定一句話故事與調性（不寫完整腳本）",
    chips: [
      "給我三個適合短片的主題方向",
      "先隨便一個方向，之後再改",
      "幫我把一句話故事寫得更清楚",
    ],
  },
  {
    id: "structure",
    label: "分鏡",
    focus: "本步只拆鏡頭／分鏡（先不生成畫面）",
    chips: ["把故事拆成 4～6 個鏡頭", "先給最簡 3 鏡骨架", "幫我補轉場與節奏"],
  },
  {
    id: "visuals",
    label: "畫面",
    focus: "本步只出圖／影（扣點前會再確認）",
    chips: ["幫我挑一鏡先出圖", "依分鏡批次建議提示詞", "先出主視覺一張就好"],
  },
  {
    id: "wrap",
    label: "收斂",
    focus: "本步只檢查完成度與交付（送審／打包）",
    chips: ["檢查還缺什麼才能交付", "幫我寫送審一句話", "列出可打包的鏡頭"],
  },
] as const;

export function isCoCreatePhaseId(value: unknown): value is CoCreatePhaseId {
  return value === "theme" || value === "structure" || value === "visuals" || value === "wrap";
}

export function coCreatePhaseIndex(id: CoCreatePhaseId): number {
  return CO_CREATE_PHASES.findIndex((p) => p.id === id);
}

export function coCreatePhaseById(id: CoCreatePhaseId): CoCreatePhase {
  return CO_CREATE_PHASES[coCreatePhaseIndex(id)] ?? CO_CREATE_PHASES[0]!;
}

/** 進度條用：目前 phase 之前 = done，當下 = current，之後 = upcoming。G0 不做完成推導。 */
export function coCreateJourneyStates(
  current: CoCreatePhaseId,
): Array<"done" | "current" | "upcoming"> {
  const cur = coCreatePhaseIndex(current);
  return CO_CREATE_PHASES.map((_, i) => {
    if (i < cur) return "done";
    if (i === cur) return "current";
    return "upcoming";
  });
}
