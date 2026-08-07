import type { BoardDoc, Stroke } from "./boardDoc";

/**
 * AI 草圖的逐筆重播：把一份完整的白板文件「演」出來——每一筆從落筆處
 * **逐點長出來**（不是整筆瞬間出現），使用者看著 AI 一筆一筆畫完，
 * 再自己決定要不要存成分鏡畫面。
 *
 * 為什麼是重播不是串流：伺服器一次算完整份文件（LLM 一次呼叫），
 * 「畫的過程」是前端合成的演出。這砍掉整條 SSE/WS 基建，觀感幾乎不減——
 * 誠實的代價是節奏是合成的、不是模型「真的一筆一筆想」（它本來就不是）。
 *
 * 兩條輸出通道，職責刻意分開：
 * - `onPreview`：正在畫的那一筆的「可見前綴」（畫到第幾點），畫在 live 層，
 *   不進文件——所以不污染 undo 歷史，也不觸發自動存檔。
 * - `pushStroke`：一筆畫完才提交進文件，與手繪放手走同一條路。
 *   中途按停，已提交的筆畫保留（可 undo），畫到一半的那筆直接消失。
 *
 * 排程是純函式（buildReplaySchedule／visiblePointCount），timer 只負責照表執行——
 * 節奏曲線要能被測試咬住，不能埋在 setTimeout 回呼裡。
 */

export interface ReplayScheduleEntry {
  /** 第幾筆（doc.strokes 的索引） */
  strokeIndex: number;
  /** 從重播開始起算的落筆時刻（ms） */
  atMs: number;
  /** 這一筆從落筆到畫完的時長（ms）；下一筆的 atMs ＝ 本筆 atMs + durationMs */
  durationMs: number;
}

/** 整場重播的目標時長邊界：太短看不清在畫什麼，太長變成等待 */
const MIN_TOTAL_MS = 1200;
const MAX_TOTAL_MS = 6500;
/** 單筆時長邊界：連續小筆畫（火柴人四肢）要快、大筆畫（構圖框）要慢 */
const MIN_STROKE_MS = 45;
const MAX_STROKE_MS = 550;
/** 逐點動畫的影格間隔（約 30fps）：再密的話 setTimeout 粒度撐不住，只是白燒電 */
export const REPLAY_FRAME_MS = 33;

/**
 * 依每筆的點數分配時間：點多的筆畫（長線）畫得久，點少的（短撇）畫得快。
 * 總長 clamp 在 [1.2s, 6.5s]——300 筆的畫也不該讓人等超過 6.5 秒。
 */
export function buildReplaySchedule(strokes: ReadonlyArray<Pick<Stroke, "points">>): ReplayScheduleEntry[] {
  if (strokes.length === 0) return [];
  const weights = strokes.map((s) => Math.max(4, s.points.length));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const totalMs = Math.min(MAX_TOTAL_MS, Math.max(MIN_TOTAL_MS, totalWeight * 2));

  // 單筆下限不得凌駕總長上限：300 筆 × 45ms 下限＝13.5 秒，「不超過 6.5 秒」就成了謊言。
  // 筆數多到塞不下時，下限跟著縮——快歸快，總長承諾優先。
  const effectiveMin = Math.min(MIN_STROKE_MS, totalMs / strokes.length);
  const durations = weights.map((w) =>
    Math.min(MAX_STROKE_MS, Math.max(effectiveMin, (w / totalWeight) * totalMs)),
  );
  // clamp 可能讓總和溢出 totalMs（一堆短撇被抬到下限、長線又被壓到上限）——
  // 等比縮回來，「最後一筆畫完 ≤ 6.5 秒」是對使用者的承諾，不是近似值。
  const actualTotal = durations.reduce((sum, d) => sum + d, 0);
  const scale = actualTotal > totalMs ? totalMs / actualTotal : 1;

  const entries: ReplayScheduleEntry[] = [];
  let clock = 0;
  for (let i = 0; i < strokes.length; i += 1) {
    const durationMs = Math.max(1, Math.round(durations[i]! * scale));
    entries.push({ strokeIndex: i, atMs: Math.round(clock), durationMs });
    clock += durations[i]! * scale;
  }
  return entries;
}

/**
 * 一筆畫到一半時該顯示前幾個點。純函式：重播的「筆在走」全靠它，
 * 測試直接斷言數字，不必真的跑 timer。
 * 至少 2 點（單點畫不出線段）、進度走完一定是全部——不能少畫最後一段。
 */
export function visiblePointCount(totalPoints: number, elapsedMs: number, durationMs: number): number {
  if (totalPoints <= 0) return 0;
  if (elapsedMs >= durationMs || durationMs <= 0) return totalPoints;
  const t = Math.max(0, elapsedMs / durationMs);
  return Math.min(totalPoints, Math.max(2, Math.ceil(totalPoints * t)));
}

/** 正在畫的那一筆的可見狀態（live 層據此畫出前綴＋筆尖） */
export interface SketchPreview {
  stroke: Stroke;
  /** 目前可見的點數（stroke.points 的前綴長度） */
  visible: number;
}

export interface ReplayHandle {
  /** 中止重播：已提交的筆畫保留（使用者可 undo），畫一半的預覽清掉，未畫的不再落 */
  cancel: () => void;
}

/**
 * 照排程把筆畫「演」出來：畫的當下逐影格餵 onPreview（live 層），
 * 一筆走完才 pushStroke 提交進文件。
 *
 * reducedMotion 時一次全部落完——動畫是演出不是資訊，關掉動畫的使用者
 * 拿到的結果必須一樣完整。
 *
 * 用 setTimeout 而不是 rAF：影格間隔以十毫秒計，rAF 的 16ms 粒度沒有幫助，
 * 而背景分頁時 rAF 完全停擺會讓重播「卡住」，timer 只是變慢。
 * 影格數有界：總長 ≤ 6.5s ÷ 33ms ≈ 200 個 timer，一次建完不會失控。
 */
export function replaySketch(
  doc: BoardDoc,
  pushStroke: (stroke: Stroke) => void,
  options: {
    reducedMotion?: boolean;
    onDone?: () => void;
    onPreview?: (preview: SketchPreview | null) => void;
  } = {},
): ReplayHandle {
  if (options.reducedMotion) {
    for (const stroke of doc.strokes) pushStroke(stroke);
    options.onPreview?.(null);
    options.onDone?.();
    return { cancel: () => {} };
  }

  const schedule = buildReplaySchedule(doc.strokes);
  const timers: number[] = [];
  let cancelled = false;
  let committed = 0;

  for (const entry of schedule) {
    const stroke = doc.strokes[entry.strokeIndex];
    if (!stroke) continue;

    // 逐影格的預覽：第 0 影格在落筆瞬間（先看到筆尖，再看到線長出來）
    for (let frameMs = 0; frameMs < entry.durationMs; frameMs += REPLAY_FRAME_MS) {
      const elapsed = frameMs;
      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        options.onPreview?.({ stroke, visible: visiblePointCount(stroke.points.length, elapsed, entry.durationMs) });
      }, entry.atMs + frameMs));
    }

    // 畫完提交：進文件（base 層下一次重繪會畫它），下一筆的第 0 影格緊接著換掉預覽
    timers.push(window.setTimeout(() => {
      if (cancelled) return;
      pushStroke(stroke);
      committed += 1;
      if (committed === schedule.length) {
        options.onPreview?.(null);
        options.onDone?.();
      }
    }, entry.atMs + entry.durationMs));
  }

  if (schedule.length === 0) {
    options.onPreview?.(null);
    options.onDone?.();
  }

  return {
    cancel: () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
      // 畫一半的預覽不能留在 live 層上——它不在文件裡，留著就是一筆擦不掉的鬼影
      options.onPreview?.(null);
    },
  };
}
