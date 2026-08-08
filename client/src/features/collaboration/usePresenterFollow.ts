/**
 * Presenter 跟隨（opt-in）。
 *
 * 這支 hook 的每一行都在服務同一件事：**跟隨是使用者借出去的控制權，不是被拿走的。**
 *
 *  - 收到「Bruce 正在帶大家看」只會讓 UI 長出一張邀請卡。按了 join 才開始跟。
 *  - 跟隨中只要跟隨者自己捲動／點擊／打字，立刻暫停並顯示「回到 Bruce」。
 *    絕不硬拉回去——被搶走滑鼠是最快讓人永久關掉這個功能的方式。
 *  - 主講者離線就說他離線，**絕不自動改跟另一個在線的人**。
 *
 * 狀態機本身在 shared/viewState.ts（純函式、可測）；這裡只負責接上 DOM 與 realtime。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  followPauseReason,
  followReducer,
  initialFollowState,
  sameViewState,
  shouldFollow,
  type FollowState,
  type ViewState,
} from "../../../../shared/viewState";
import type { CollabPeer, CollabPresenter, PeerView } from "../../realtime";

/**
 * 跟隨者自己操作 → 暫停。用 capture 掛在 window 上，才會在任何元件處理之前就收到。
 *
 * **這份清單刻意不含 `scroll`。** 這四種事件只會由真實輸入裝置產生；
 * 而跟隨自己造成的程式化捲動（scrollTo／scrollIntoView）發出的是 `scroll`。
 * 少了這個區分，跟隨會在跟上的第一幀就自己把自己暫停掉——
 * 而使用者只會看到「這個功能按了沒反應」。
 */
const INTERACTION_EVENTS = ["wheel", "touchmove", "pointerdown", "keydown"] as const;

export interface PresenterFollow {
  state: FollowState;
  /** 目前該被帶到哪（null＝不該跟／沒有位置可跟） */
  targetView: ViewState | null;
  /** 有沒有人在邀請我（且我還沒加入） */
  invitation: CollabPresenter | null;
  join: (presenter: CollabPresenter) => void;
  /** 「回到 Bruce」 */
  resume: () => void;
  /** 停止跟隨 */
  leave: () => void;
}

export function usePresenterFollow({
  presenters,
  peerViews,
  peers,
  /** 跟隨者被帶到新位置時要做什麼（呼叫端把 viewState 套用到自己的畫面上） */
  onNavigate,
}: {
  presenters: CollabPresenter[];
  peerViews: Map<string, PeerView>;
  peers: CollabPeer[];
  onNavigate?: (view: ViewState) => void;
}): PresenterFollow {
  const [state, dispatch] = useReducer(followReducer, undefined, initialFollowState);

  /**
   * 主講者現在在哪。以 connId 查而不是 userId——同一人開兩個分頁時，
   * 只鎖 userId 會讓跟隨者在兩個分頁的位置之間每秒來回彈跳（hysteresis 的來源）。
   */
  const targetView = useMemo(() => {
    if (!shouldFollow(state) || !state.connId) return null;
    return peerViews.get(state.connId)?.view ?? null;
  }, [state, peerViews]);

  // 在場名單變動 → 判斷主講者還在不在。**這條規則只會產生 presenter_gone，
  // 永遠不會把跟隨對象換成另一個人。**
  const onlineIds = useMemo(() => peers.map((p) => p.userId), [peers]);
  const onlineSig = onlineIds.join(",");
  useEffect(() => {
    dispatch({ type: "peers", onlineIds });
    // onlineSig 是 onlineIds 的內容指紋：陣列每次 render 都是新參考，
    // 直接列進依賴會讓這支 effect 每一幀都跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineSig]);

  // 主講者主動結束主講（present active=false）→ 也要離開跟隨，不能留在一個
  // 永遠不會再更新的位置上假裝還在跟。
  const presenterStillPresenting = state.connId ? presenters.some((p) => p.connId === state.connId) : false;
  useEffect(() => {
    if (state.status === "off") return;
    if (!presenterStillPresenting && state.status !== "presenter_gone") dispatch({ type: "leave" });
  }, [presenterStillPresenting, state.status]);

  // 跟隨者自己動手 → 暫停
  const followingRef = useRef(false);
  followingRef.current = state.status === "following";
  useEffect(() => {
    const handler = (ev: Event) => {
      if (!followingRef.current) return;
      const reason = followPauseReason({ type: ev.type });
      if (reason) dispatch({ type: "interact", reason });
    };
    for (const type of INTERACTION_EVENTS) {
      window.addEventListener(type, handler, { capture: true, passive: true });
    }
    return () => {
      for (const type of INTERACTION_EVENTS) window.removeEventListener(type, handler, { capture: true });
    };
  }, []);

  // 被帶到新位置。只在「目標真的變了」時呼叫——否則同一個位置會被重複套用，
  // 而每次套用都可能觸發捲動，看起來就像畫面在抖。
  const lastAppliedRef = useRef<ViewState | null>(null);
  useEffect(() => {
    if (!targetView || !onNavigate) return;
    if (sameViewState(lastAppliedRef.current, targetView)) return;
    lastAppliedRef.current = targetView;
    onNavigate(targetView);
  }, [targetView, onNavigate]);

  /**
   * 邀請卡：有人在主講、而我還沒加入他。
   * 已經在跟（或已暫停、或他剛離線）就不再重複邀請——那只會變成洗版。
   */
  const invitation = useMemo(() => {
    if (state.status !== "off") return null;
    return presenters[0] ?? null;
  }, [state.status, presenters]);

  const join = useCallback((presenter: CollabPresenter) => {
    // 加入時清掉「上一次套用到哪」，讓第一次跟隨一定會真的導航過去
    lastAppliedRef.current = null;
    dispatch({
      type: "join",
      presenterId: presenter.userId,
      presenterName: presenter.name,
      connId: presenter.connId,
    });
  }, []);

  const resume = useCallback(() => {
    lastAppliedRef.current = null; // 回去時要重新導航到他現在的位置，不是我暫停時的位置
    dispatch({ type: "resume" });
  }, []);

  const leave = useCallback(() => dispatch({ type: "leave" }), []);

  return { state, targetView, invitation, join, resume, leave };
}
