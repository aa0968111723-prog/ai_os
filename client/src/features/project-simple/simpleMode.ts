/**
 * 簡易模式（QA 體檢 2026-08-01）的純邏輯層。
 *
 * 為什麼要有簡易模式：專案頁一頁 3 章、20+ 區塊、80+ 可互動元素，但實測「從零到第一支可交付的片」
 * 真正必要的只有四個動作——講一句故事 → 拆分鏡 → 逐格出圖 → 送審打包。其餘（協作視角、訊息主軸、
 * 進階敘事欄位、四個創作模式分頁）對新手都是路障。簡易模式把這四步攤成一條線，專業模式原樣保留。
 *
 * 這個檔只放**不碰 React/DOM 的判斷**，讓「預設給誰簡易模式」「進度算到第幾步」這些會影響
 * 使用者第一印象的規則能被單元測試釘住。UI 在 SimpleProjectMode.tsx。
 */

export type ProjectMode = "simple" | "pro";

const LS_PREFIX = "aios.projectMode.";

/** localStorage 讀寫都包 try：無痕模式／關閉儲存時只是失去偏好，不能讓專案頁整頁掛掉。 */
export function loadProjectMode(projectId: string): ProjectMode | null {
  try {
    const v = localStorage.getItem(LS_PREFIX + projectId);
    return v === "simple" || v === "pro" ? v : null;
  } catch {
    return null;
  }
}

export function saveProjectMode(projectId: string, mode: ProjectMode): void {
  try {
    localStorage.setItem(LS_PREFIX + projectId, mode);
  } catch {
    /* 偏好存不了就算了 */
  }
}

/**
 * 沒存過偏好時要給哪一種模式。
 *
 * 規則：**只有還沒開始做的專案才預設簡易**。已經有分鏡或已經生成過東西的專案，代表使用者
 * 已經在用完整版工作（可能正排到一半），把他丟進簡易模式等於藏起他正在用的東西。
 */
export function defaultProjectMode(input: { sceneCount: number; generationCount: number }): ProjectMode {
  return input.sceneCount === 0 && input.generationCount === 0 ? "simple" : "pro";
}

export function resolveProjectMode(
  projectId: string,
  counts: { sceneCount: number; generationCount: number },
): ProjectMode {
  return loadProjectMode(projectId) ?? defaultProjectMode(counts);
}

/** 簡易模式看得懂的最小分鏡投影（欄位對齊 scenes.listByProject，不從 server 型別推導：ADR 009）。 */
export type SimpleScene = {
  id: string;
  title: string;
  status: string;
  assetUrl: string | null;
  prompt: string | null;
  pendingGenStatus?: string | null;
};

export type SimpleStepId = "story" | "storyboard" | "visuals" | "deliver";

export type SimpleStepState = {
  id: SimpleStepId;
  label: string;
  /** 這步做完了沒 */
  done: boolean;
  /** 一句話說明現在該做什麼 */
  hint: string;
};

/**
 * 四步進度。**全部由伺服器資料推導**（世界觀、分鏡列、審核狀態），不存前端 state——
 * 這正是「重新整理後仍看得到進度」的關鍵：重整後查詢一回來，進度就回到原位。
 */
export function computeSimpleSteps(input: {
  worldviewReady: boolean;
  scenes: SimpleScene[];
}): SimpleStepState[] {
  const { worldviewReady, scenes } = input;
  const withVisual = scenes.filter((s) => !!s.assetUrl).length;
  const approved = scenes.filter((s) => s.status === "approved").length;
  return [
    {
      id: "story",
      label: "講一句故事",
      done: worldviewReady,
      hint: "一句話說這支片在講什麼，再挑一個調性",
    },
    {
      id: "storyboard",
      label: "拆成分鏡",
      done: scenes.length > 0,
      hint: "貼腳本或寫下想法，AI 免費幫你拆成一格一格",
    },
    {
      id: "visuals",
      label: "生成畫面",
      done: scenes.length > 0 && withVisual === scenes.length,
      hint: scenes.length > 0 ? `已完成 ${withVisual}／${scenes.length} 格` : "先拆分鏡，再一鍵出圖",
    },
    {
      id: "deliver",
      label: "送審・打包",
      done: scenes.length > 0 && approved === scenes.length,
      hint: scenes.length > 0 ? `已通過 ${approved}／${scenes.length} 格` : "畫面齊了就能送審打包",
    },
  ];
}

/** 目前停在第幾步（0-based）；全部完成回 steps.length。 */
export function currentSimpleStepIndex(steps: SimpleStepState[]): number {
  const i = steps.findIndex((s) => !s.done);
  return i === -1 ? steps.length : i;
}

/**
 * 一鍵生成畫面時要送哪幾格：沒有畫面、也沒有正在跑的生成。
 *
 * 排除 pendingGenStatus 是實測踩到的坑——重複按會對同一格再送一次，白扣點又互相覆蓋。
 */
export function scenesNeedingVisual(scenes: SimpleScene[]): SimpleScene[] {
  return scenes.filter((s) => !s.assetUrl && !s.pendingGenStatus);
}

/** 送審對象：有畫面、還在草稿（todo/draft）的格子。已送審／已通過的不重送。 */
export function scenesReadyToSubmit(scenes: SimpleScene[]): SimpleScene[] {
  return scenes.filter((s) => !!s.assetUrl && s.status !== "pending" && s.status !== "approved");
}

/** 進行中任務數（生成中的格子）——頂部常駐條用，重整後照樣算得出來。 */
export function runningVisualCount(scenes: SimpleScene[]): number {
  return scenes.filter((s) => !!s.pendingGenStatus).length;
}

/**
 * 拆分鏡的輸入夠不夠。後端 split_script 要求 20–8000 字；少於 20 字時給「再多寫幾句」而不是
 * 讓使用者按了才吃一個 zod 錯誤（實測：多步開拍就是這樣連續失敗兩次才給提示）。
 */
export const SPLIT_MIN_CHARS = 20;
export const SPLIT_MAX_CHARS = 8000;

export function splitScriptReadiness(text: string): { ok: boolean; reason?: string } {
  const t = text.trim();
  if (t.length === 0) return { ok: false, reason: "先貼上腳本，或寫下你想拍什麼" };
  if (t.length < SPLIT_MIN_CHARS) return { ok: false, reason: `再多寫幾句（至少 ${SPLIT_MIN_CHARS} 字，現在 ${t.length} 字）` };
  if (t.length > SPLIT_MAX_CHARS) return { ok: false, reason: `太長了（上限 ${SPLIT_MAX_CHARS} 字，現在 ${t.length} 字）——請分段拆` };
  return { ok: true };
}
