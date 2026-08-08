/**
 * 每一鏡的完成度（重構需求 §15）與整部片的缺漏清單（§12）。
 *
 * 為什麼是純推導、而不是在 scenes 上再加一堆布林欄：
 *   「這一鏡有沒有畫面」的真相已經是 `scenes.assetId`（＋ assets.kind 分圖/影），
 *   「有沒有配音」是 narrationAssetId、「有沒有環境音」是 ambienceAssetId——
 *   全部都是既有的指標欄。再存一份 hasImage/hasVideo 只會多出一份要對帳的真相，
 *   而且一定會跟指標欄漂移（改了指標忘了改旗標＝完成度說謊）。
 *   唯一存不出來的是「人有沒有看過並通過」，所以只有 review 是真欄位。
 *
 * 這份檔是 client 與 server 的共同語言：分鏡卡的狀態點、製作頁的前後鏡導航、
 * 成片頁的完成度與缺漏清單，全部從這裡算，不會各算各的。
 */

/** 一鏡的五個面向。順序即製作順序，UI 依此排列。 */
export const COMPLETION_TRACKS = ["image", "video", "voice", "audio", "review"] as const;
export type CompletionTrack = (typeof COMPLETION_TRACKS)[number];

export const TRACK_LABEL: Record<CompletionTrack, string> = {
  image: "畫面",
  video: "影片",
  voice: "配音",
  audio: "音效",
  review: "審核",
};

/** 單一軌的狀態：done＝有成品、running＝生成中、missing＝還沒有 */
export type TrackState = "done" | "running" | "missing";

/** 審核狀態（唯一需要真欄位的軌；預設 draft） */
export const REVIEW_STATES = ["draft", "in_progress", "ready", "changes", "approved"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_LABEL: Record<ReviewState, string> = {
  draft: "草稿",
  in_progress: "製作中",
  ready: "待審核",
  changes: "需要修改",
  approved: "已通過",
};

/**
 * 算完成度需要的最小輸入——刻意只吃 `scenes.listByProject` 已經回傳的欄位，
 * 不新增查詢。欄位名與該 query 一致，呼叫端直接把列傳進來即可。
 */
export interface ShotCompletionInput {
  id: string;
  title: string;
  orderIndex: number;
  /** 現用畫面素材（圖或影）；null＝還沒有畫面 */
  assetId: string | null;
  /** 現用畫面是圖片還是影片——影片同時滿足「有畫面」與「有動態」 */
  assetKind: string | null;
  /** 已生成且未軟刪的旁白音檔網址 */
  narrationUrl: string | null;
  /** 已生成且未軟刪的環境音網址 */
  ambienceUrl: string | null;
  /** 該格進行中的畫面生成（queued/running） */
  pendingGenStatus?: string | null;
  pendingNarrationStatus?: string | null;
  pendingAmbienceStatus?: string | null;
  reviewStatus?: ReviewState | null;
}

export interface ShotCompletion {
  shotId: string;
  title: string;
  orderIndex: number;
  tracks: Record<CompletionTrack, TrackState>;
  /** 已完成的軌數 / 5 */
  doneCount: number;
  percent: number;
  /** 這一鏡整體：done＝五軌齊、running＝有東西在生、blocked＝被要求修改、todo＝其他 */
  state: "done" | "running" | "blocked" | "todo";
}

const isRunning = (s: string | null | undefined) => s === "queued" || s === "running";

/**
 * 一鏡的完成度。
 *
 * 影片軌的判定刻意寬鬆：現用畫面本身就是影片（assetKind==='video'）即算有動態——
 * 使用者若直接生成影片填進這一格，不該因為「沒有另外一支影片素材」被判為缺件。
 */
export function computeShotCompletion(shot: ShotCompletionInput): ShotCompletion {
  const hasVisual = Boolean(shot.assetId);
  const isVideo = shot.assetKind === "video";

  const image: TrackState = hasVisual ? "done" : isRunning(shot.pendingGenStatus) ? "running" : "missing";
  const video: TrackState = isVideo ? "done" : isRunning(shot.pendingGenStatus) ? "running" : "missing";
  const voice: TrackState = shot.narrationUrl
    ? "done"
    : isRunning(shot.pendingNarrationStatus)
      ? "running"
      : "missing";
  const audio: TrackState = shot.ambienceUrl
    ? "done"
    : isRunning(shot.pendingAmbienceStatus)
      ? "running"
      : "missing";
  const review: TrackState = shot.reviewStatus === "approved" ? "done" : "missing";

  const tracks: Record<CompletionTrack, TrackState> = { image, video, voice, audio, review };
  const doneCount = COMPLETION_TRACKS.filter((t) => tracks[t] === "done").length;
  const anyRunning = COMPLETION_TRACKS.some((t) => tracks[t] === "running");

  const state: ShotCompletion["state"] =
    shot.reviewStatus === "changes"
      ? "blocked" // 有人要求修改＝這一鏡有問題，優先於「還在生成」
      : doneCount === COMPLETION_TRACKS.length
        ? "done"
        : anyRunning
          ? "running"
          : "todo";

  return {
    shotId: shot.id,
    title: shot.title,
    orderIndex: shot.orderIndex,
    tracks,
    doneCount,
    percent: Math.round((doneCount / COMPLETION_TRACKS.length) * 100),
    state,
  };
}

/* ── 專案層彙總（§12 Delivery Room 第一屏） ─────────────── */

export interface ProjectCompletion {
  shots: number;
  /** 逐軌完成數：畫面 12/12、影片 10/12… */
  perTrack: Record<CompletionTrack, number>;
  /** 整體百分比＝所有軌加總的完成比例（不是「全滿的鏡數」——那樣進度會長期卡在 0%） */
  percent: number;
  /** 五軌齊全的鏡數 */
  completeShots: number;
}

export function computeProjectCompletion(list: ShotCompletion[]): ProjectCompletion {
  const perTrack = Object.fromEntries(COMPLETION_TRACKS.map((t) => [t, 0])) as Record<CompletionTrack, number>;
  for (const s of list) {
    for (const t of COMPLETION_TRACKS) if (s.tracks[t] === "done") perTrack[t] += 1;
  }
  const totalCells = list.length * COMPLETION_TRACKS.length;
  const doneCells = list.reduce((n, s) => n + s.doneCount, 0);
  return {
    shots: list.length,
    perTrack,
    percent: totalCells ? Math.round((doneCells / totalCells) * 100) : 0,
    completeShots: list.filter((s) => s.doneCount === COMPLETION_TRACKS.length).length,
  };
}

/* ── 缺漏清單（§12：「目前有 4 個問題」，每個都能點進去處理） ─────────────── */

export interface DeliveryIssue {
  shotId: string;
  shotTitle: string;
  orderIndex: number;
  track: CompletionTrack;
  /** 人話：「缺少影片」「尚未審核」 */
  label: string;
}

/**
 * 把缺漏攤成可點的清單。
 *
 * 排序＝製作順序（鏡次），不是嚴重度——使用者是照鏡次補件的，
 * 依嚴重度排會讓他在清單裡跳來跳去。
 *
 * 「生成中」不算問題：它正在解決，列進去只會讓問題數字上下跳。
 */
export function listDeliveryIssues(list: ShotCompletion[]): DeliveryIssue[] {
  const out: DeliveryIssue[] = [];
  for (const s of [...list].sort((a, b) => a.orderIndex - b.orderIndex)) {
    for (const track of COMPLETION_TRACKS) {
      if (s.tracks[track] !== "missing") continue;
      out.push({
        shotId: s.shotId,
        shotTitle: s.title,
        orderIndex: s.orderIndex,
        track,
        label: track === "review" ? "尚未審核" : `缺少${TRACK_LABEL[track]}`,
      });
    }
  }
  return out;
}
