/**
 * Story Workspace 的純規則（可測；不含 React）：
 * autosave 的「該不該收養遠端內容」與存檔狀態機，抽出來讓協作覆蓋行為測得到——
 * 這條規則錯了會默默蓋掉夥伴剛打的字（比 UI 壞掉更難發現）。
 */

/**
 * `conflict`＝伺服器擋下了這次儲存，因為夥伴在同一段期間也改了故事。
 * 它與 `error` 分開是有必要的：`error` 是「再試一次可能就好」，`conflict` 是
 * 「有另一份合法的內容存在，需要人決定」——兩者的出路完全不同，混成一個狀態
 * 就只能顯示同一句沒有用的話。
 */
export type StorySaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

/** autosave 去抖延遲（毫秒）：邊打字邊存但不轟炸伺服器 */
export const STORY_AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * 同一份故事的 in-flight 閘門。
 *
 * 故事是整份全文覆寫、autosave 每 800ms 一發。若存檔 A 還在路上又送出存檔 B，
 * 兩邊會帶同一個 `expectedRev`：A 寫入後 B 被當成「自己跟自己衝突」，
 * 跳出衝突卡，或更糟——較慢的那一發 onSuccess 用舊 rev／錯誤 baseline 蓋掉剛打的字。
 *
 * 規則：一次只准一發在路上；途中的最新草稿排隊，等 ACK 再用新 rev 送出。
 * baseline 必須是「剛剛成功寫進去的那一份」，不能用當下編輯器的 live 內容。
 */
export type StorySaveRequest = {
  content: string;
  expectedRev: number | undefined;
  baseline: string | undefined;
};

export type StorySaveGateOutcome = "dispatched" | "queued" | "idle";
export type StorySaveFailKind = "conflict" | "error";
export type StoryFlushResult = { ok: true } | { ok: false; reason: StorySaveFailKind };

export function createStorySaveGate(opts: {
  send: (req: StorySaveRequest) => void;
  getRev: () => number | undefined;
  getBaseline: () => string | undefined;
  setRev: (rev: number) => void;
  setBaseline: (content: string) => void;
}) {
  let inFlight = false;
  let queued: string | null = null;
  const flushWaiters: Array<(result: StoryFlushResult) => void> = [];

  function finishFlush(result: StoryFlushResult) {
    const waiters = flushWaiters.splice(0, flushWaiters.length);
    for (const waiter of waiters) waiter(result);
  }

  function dispatch(content: string): Exclude<StorySaveGateOutcome, "idle"> {
    if (inFlight) {
      queued = content;
      return "queued";
    }
    inFlight = true;
    queued = null;
    opts.send({
      content,
      expectedRev: opts.getRev(),
      baseline: opts.getBaseline(),
    });
    return "dispatched";
  }

  function onAck(savedContent: string, newRev: number | undefined): StorySaveGateOutcome {
    if (typeof newRev === "number") opts.setRev(newRev);
    // 成功基準＝這次實際寫進去的全文。用 live 編輯器內容當 baseline
    // 會讓下一發以為「遠端已經是我剛打的字」， rev 卻還停在這一發。
    opts.setBaseline(savedContent);
    inFlight = false;
    if (queued !== null && queued !== savedContent) {
      const next = queued;
      queued = null;
      return dispatch(next);
    }
    queued = null;
    finishFlush({ ok: true });
    return "idle";
  }

  function onFail(kind: StorySaveFailKind): StorySaveFailKind {
    inFlight = false;
    if (kind === "conflict") queued = null;
    finishFlush({ ok: false, reason: kind });
    return kind;
  }

  function whenIdle(cb: (result: StoryFlushResult) => void) {
    if (!inFlight && queued === null) {
      cb({ ok: true });
      return;
    }
    flushWaiters.push(cb);
  }

  return {
    dispatch,
    onAck,
    onFail,
    whenIdle,
    isInFlight: () => inFlight,
    peekQueue: () => queued,
  };
}

/**
 * 遠端內容變了，本地要不要跟？
 * 只有「本地沒有未存修改」（idle/saved）時才收養遠端——正在打字（dirty/saving/error）時
 * 收養等於把使用者手上的字直接換掉。錯誤態也不收養：使用者要先看得到自己沒存成功的內容。
 *
 * `conflict` 尤其不能收養：那個狀態的定義就是「遠端有一份不一樣的內容」，
 * 一收養就等於自動選了對方那一版，而使用者正被問的就是要選哪一版。
 */
export function shouldAdoptRemote(state: StorySaveState, local: string | null, remote: string): boolean {
  if (local === null) return true; // 尚未種初值：一律採用伺服器內容
  if (local === remote) return false;
  // conflict 絕不能收養：那就是「遠端有另一份合法內容，等人選」——一收養等於自動選了對方。
  if (state === "conflict" || state === "dirty" || state === "saving" || state === "error") return false;
  return state === "idle" || state === "saved";
}

/** 解析摘要 chips 的顯示順序與文案（單一真相：StoryStage 與測試共用） */
export function summaryChips(summary: {
  characters: number;
  locations: number;
  props: number;
  looks: number;
  storyScenes: number;
  shots: number;
  flagged?: number;
  pending?: number;
}): Array<{ key: string; label: string }> {
  const marks = (summary.flagged ?? 0) + (summary.pending ?? 0);
  return [
    { key: "characters", label: `角色 ${summary.characters}` },
    { key: "locations", label: `場景 ${summary.locations}` },
    { key: "props", label: `道具 ${summary.props}` },
    { key: "looks", label: `造型 ${summary.looks}` },
    { key: "shots", label: `分鏡 ${summary.storyScenes} 場 ${summary.shots} 鏡` },
    { key: "markers", label: `標記 ${marks}` },
  ];
}
