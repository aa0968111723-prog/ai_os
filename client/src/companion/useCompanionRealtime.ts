import { useEffect, useRef, useState } from "react";
import {
  EMPTY_COMPANION_LIVE_STATE,
  companionEventNeedsRefetch,
  parseCompanionWireEvent,
  reduceCompanionEvent,
  type CompanionLiveState,
} from "@shared/companionRealtime";

/**
 * Companion 的即時訊號。
 *
 * ## 為什麼不用既有的 useCollab
 *
 * `client/src/realtime.tsx` 的 `useCollab()` 是**協作**用的：presence、彩色游標、
 * 錨點聚合、Presenter 跟隨、viewState 同步。那一整套在 Companion 首頁一件都用不到，
 * 但掛上去就要付它的代價——每秒最高 30Hz 的游標封包解析、一堆 Map 與 ref、
 * 以及一個會隨房內人數成長的重繪來源。手機首頁只需要「有事發生了」這一件事。
 *
 * 所以這裡是**同一條線、同一個房間、同一份協定**的一個薄訂閱：
 * 開 `/ws?groupId=`，只解 `companion-event`，其餘 type 一律忽略。
 * 伺服器端零改動（房間與認證都是既有的）。
 *
 * ## 重連
 *
 * 指數退避到 30 秒上限，並在回到前景時立刻重試一次——手機鎖屏幾分鐘後
 * WS 一定是斷的，而使用者解鎖後期待的是「馬上看到最新狀態」。
 *
 * 重連成功會呼叫一次 `onResync`：斷線期間的事件永遠補不回來（房間不留歷史），
 * 所以權威狀態一律靠重抓，而不是假裝事件流沒斷過。
 */
export interface CompanionRealtimeOptions {
  groupId: string;
  enabled?: boolean;
  /** 收到值得重抓的事件、或重連成功時呼叫 */
  onResync?: () => void;
}

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export function useCompanionRealtime({
  groupId,
  enabled = true,
  onResync,
}: CompanionRealtimeOptions): { live: CompanionLiveState; connected: boolean } {
  const [live, setLive] = useState<CompanionLiveState>(EMPTY_COMPANION_LIVE_STATE);
  const [connected, setConnected] = useState(false);
  // onResync 常常是 inline 箭頭函式；放 ref 才不會每次 render 都重開連線。
  const resyncRef = useRef(onResync);
  resyncRef.current = onResync;

  useEffect(() => {
    if (!enabled || !groupId) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryDelay = RETRY_BASE_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hadConnection = false;

    const connect = () => {
      if (disposed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      try {
        socket = new WebSocket(`${proto}://${location.host}/ws?groupId=${encodeURIComponent(groupId)}`);
      } catch {
        scheduleRetry();
        return;
      }
      socket.onopen = () => {
        if (disposed) return;
        setConnected(true);
        retryDelay = RETRY_BASE_MS;
        // 第一次連上不算「重連」——那時呼叫端的查詢正要發出，再叫一次是白花一趟。
        if (hadConnection) resyncRef.current?.();
        hadConnection = true;
      };
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        let raw: unknown;
        try {
          raw = JSON.parse(message.data);
        } catch {
          return;
        }
        const event = parseCompanionWireEvent(raw);
        // 不是 companion-event（presence／cursor／invalidate）就交給別人——這裡不處理。
        if (!event) return;
        setLive((prev) => reduceCompanionEvent(prev, event));
        if (companionEventNeedsRefetch(event.kind)) resyncRef.current?.();
      };
      socket.onclose = () => {
        if (disposed) return;
        setConnected(false);
        scheduleRetry();
      };
      socket.onerror = () => {
        // onerror 之後一定會有 onclose，重試邏輯集中在那裡就好。
        try {
          socket?.close();
        } catch {
          /* ignore */
        }
      };
    };

    const scheduleRetry = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    };

    /** 回到前景：不等退避倒數，立刻試一次。 */
    const onVisible = () => {
      if (disposed || document.visibilityState !== "visible") return;
      if (socket && socket.readyState === WebSocket.OPEN) return;
      clearTimeout(retryTimer);
      retryDelay = RETRY_BASE_MS;
      connect();
    };

    connect();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      setConnected(false);
    };
  }, [groupId, enabled]);

  return { live, connected };
}
