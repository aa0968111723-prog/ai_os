import type { BoardDoc, Stroke } from "./boardDoc";

/**
 * AI 草圖的逐筆重播：把一份完整的白板文件「演」出來——筆畫一筆一筆長出來，
 * 使用者看著 AI 畫完，再自己決定要不要存成分鏡畫面。
 *
 * 為什麼是重播不是串流：伺服器一次算完整份文件（LLM 一次呼叫），
 * 「畫的過程」是前端合成的演出。這砍掉整條 SSE/WS 基建，觀感幾乎不減——
 * 誠實的代價是節奏是合成的、不是模型「真的一筆一筆想」（它本來就不是）。
 *
 * 排程是純函式（buildReplaySchedule），rAF/timer 只負責照表執行——
 * 節奏曲線要能被測試咬住，不能埋在 setTimeout 回呼裡。
 */

export interface ReplayScheduleEntry {
  /** 第幾筆（doc.strokes 的索引） */
  strokeIndex: number;
  /** 從重播開始起算的落筆時刻（ms） */
  atMs: number;
}

/** 整場重播的目標時長邊界：太短看不清在畫什麼，太長變成等待 */
const MIN_TOTAL_MS = 1200;
const MAX_TOTAL_MS = 6500;
/** 單筆之間的間隔邊界：連續小筆畫（火柴人四肢）要快、大筆畫（構圖框）要慢 */
const MIN_STROKE_MS = 45;
const MAX_STROKE_MS = 550;

/**
 * 依每筆的點數分配時間：點多的筆畫（長線）畫得久，點少的（短撇）畫得快。
 * 總長 clamp 在 [1.2s, 6.5s]——300 筆的畫也不該讓人等超過 6.5 秒。
 */
export function buildReplaySchedule(strokes: ReadonlyArray<Pick<Stroke, "points">>): ReplayScheduleEntry[] {
  if (strokes.length === 0) return [];
  const weights = strokes.map((s) => Math.max(4, s.points.length));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const totalMs = Math.min(MAX_TOTAL_MS, Math.max(MIN_TOTAL_MS, totalWeight * 2));

  const entries: ReplayScheduleEntry[] = [];
  let clock = 0;
  for (let i = 0; i < strokes.length; i += 1) {
    entries.push({ strokeIndex: i, atMs: Math.round(clock) });
    const slice = (weights[i]! / totalWeight) * totalMs;
    clock += Math.min(MAX_STROKE_MS, Math.max(MIN_STROKE_MS, slice));
  }
  return entries;
}

export interface ReplayHandle {
  /** 中止重播：已畫上去的筆畫保留（使用者可 undo），未畫的不再落 */
  cancel: () => void;
}

/**
 * 照排程把筆畫逐筆餵給 pushStroke。
 *
 * reducedMotion 時一次全部落完——動畫是演出不是資訊，關掉動畫的使用者
 * 拿到的結果必須一樣完整。
 *
 * 用 setTimeout 鏈而不是 rAF 迴圈：重播間隔以十毫秒計，rAF 的 16ms 粒度
 * 沒有幫助，而背景分頁時 rAF 完全停擺會讓重播「卡住」，timer 只是變慢。
 */
export function replaySketch(
  doc: BoardDoc,
  pushStroke: (stroke: Stroke) => void,
  options: { reducedMotion?: boolean; onDone?: () => void } = {},
): ReplayHandle {
  if (options.reducedMotion) {
    for (const stroke of doc.strokes) pushStroke(stroke);
    options.onDone?.();
    return { cancel: () => {} };
  }

  const schedule = buildReplaySchedule(doc.strokes);
  const timers: number[] = [];
  let cancelled = false;
  let landed = 0;

  for (const entry of schedule) {
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const stroke = doc.strokes[entry.strokeIndex];
      if (stroke) pushStroke(stroke);
      landed += 1;
      if (landed === schedule.length) options.onDone?.();
    }, entry.atMs);
    timers.push(timer);
  }

  return {
    cancel: () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    },
  };
}
