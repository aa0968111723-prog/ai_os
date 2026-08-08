/**
 * Story 共編的 client 綁定（/ws-doc ↔ 受控 textarea）。
 *
 * 職責邊界：
 *  - 這支 hook 管 Y.Doc、WebSocket、awareness；**不碰 DOM**。
 *  - 呼叫端（StoryStage）拿到 `onRemote(next, transformCaret)` 後自己決定
 *    怎麼更新 state 與游標——textarea 是它的，不是我們的。
 *
 * 降級原則：連不上／斷線＝`active=false`，呼叫端自動退回既有的
 * autosave（debounce → story.save → revision 衝突卡）。共編是升級，
 * 不是把唯一的儲存路徑換掉——伺服器沒開 /ws-doc 時故事編輯照常運作。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { diffToSplice, transformCaret } from "@shared/textSync";

/** 與 server/services/collabDoc.ts 的 STORY_TEXT_KEY 同字串——兩邊要一起改 */
const TEXT_KEY = "content";
/** awareness（caret 位置）節流：打字時每一鍵都送只是浪費，150ms 已足夠即時 */
const AWARENESS_MIN_MS = 150;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 15_000;

export interface YPeer {
  userId: string;
  name: string;
  color: string;
  cursor: number | null;
  selectionEnd: number | null;
}

export function useStoryYDoc(opts: {
  projectId: string;
  enabled: boolean;
  /**
   * 遠端改動落地：拿到新全文與「舊游標 → 新游標」的轉換器。
   * 轉換器必須在 setState 前呼叫（要用**舊**的 selectionStart 算）。
   */
  onRemote: (next: string, transform: (caret: number) => number) => void;
}): {
  /** ws 已連上且完成初始同步——true 時呼叫端應停用舊 autosave 路徑 */
  active: boolean;
  /** 本地編輯進 Y.Text；回 false＝共編未啟用，呼叫端走舊路徑 */
  applyLocal: (next: string) => boolean;
  /** 回報我的 caret（節流；夥伴的編輯器上會畫出我的游標） */
  sendCaret: (start: number, end: number) => void;
  /** 夥伴的 caret（userId → 位置與顏色） */
  peers: Map<string, YPeer>;
} {
  const [active, setActive] = useState(false);
  const [peers, setPeers] = useState<Map<string, YPeer>>(() => new Map());
  const docRef = useRef<Y.Doc | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onRemoteRef = useRef(opts.onRemote);
  onRemoteRef.current = opts.onRemote;
  const lastAwarenessAt = useRef(0);

  useEffect(() => {
    if (!opts.enabled) return;
    // jsdom／舊環境沒有 WebSocket：共編靜默不啟用，編輯器照常走 autosave
    if (typeof WebSocket === "undefined") return;
    let disposed = false;
    let retryDelay = RETRY_BASE_MS;
    let retryTimer: number | undefined;
    let ws: WebSocket | null = null;

    const doc = new Y.Doc();
    docRef.current = doc;
    const ytext = doc.getText(TEXT_KEY);

    // 本地 transaction（origin="local"）→ 送增量給伺服器。
    // 遠端來的 update 以 origin="remote" 套用，不會在這裡回聲送回去。
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== "local") return;
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({ type: "update", u: bytesToBase64(update) }));
      }
    };
    doc.on("update", onUpdate);

    const connect = () => {
      if (disposed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      // 每條連線都用自己的 const（sock），事件處理器全部掛在它身上——
      // 不能用外層可重指派的變數：React StrictMode 會「掛載→卸載→再掛載」，
      // 第一條被中止的 socket 其 onclose 是**非同步**才到的，若它去清共用的
      // wsRef，就會把第二條（活著的）連線的參照清掉——畫面顯示「共編中」、
      // 字卻一個都送不出去，而且哪一條儲存路徑都不會接手。實機雙瀏覽器抓到的。
      const sock = new WebSocket(`${proto}://${location.host}/ws-doc?doc=story:${encodeURIComponent(opts.projectId)}`);
      ws = sock;
      wsRef.current = sock;
      sock.onopen = () => {
        retryDelay = RETRY_BASE_MS;
      };
      sock.onmessage = (ev) => {
        let msg: { type?: string; u?: string; a?: Record<string, unknown> };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if ((msg.type === "sync" || msg.type === "update") && typeof msg.u === "string") {
          const before = ytext.toString();
          try {
            Y.applyUpdate(doc, base64ToBytes(msg.u), "remote");
          } catch {
            return; // 壞封包丟棄；下一次 sync 會補齊
          }
          const after = ytext.toString();
          if (msg.type === "sync") setActive(true);
          if (before !== after) {
            const splice = diffToSplice(before, after);
            onRemoteRef.current(after, splice ? (caret) => transformCaret(caret, splice) : (caret) => caret);
          } else if (msg.type === "sync") {
            // 初始同步內容恰好與畫面相同：仍要通知一次，讓呼叫端把基準切到 Y
            onRemoteRef.current(after, (caret) => caret);
          }
        } else if (msg.type === "awareness" && msg.a && typeof msg.a === "object") {
          const a = msg.a as { userId?: string; name?: string; color?: string; cursor?: number; selectionEnd?: number; gone?: boolean };
          if (typeof a.userId !== "string") return;
          setPeers((prev) => {
            const next = new Map(prev);
            if (a.gone) next.delete(a.userId!);
            else {
              next.set(a.userId!, {
                userId: a.userId!,
                name: typeof a.name === "string" ? a.name : "夥伴",
                color: typeof a.color === "string" ? a.color : "#888",
                cursor: typeof a.cursor === "number" ? a.cursor : null,
                selectionEnd: typeof a.selectionEnd === "number" ? a.selectionEnd : null,
              });
            }
            return next;
          });
        }
      };
      sock.onclose = () => {
        // 只有「目前活著的那條」才有資格清狀態與重連——舊 socket 遲到的
        // onclose 不能動 wsRef，否則活連線會被誤判成斷線。
        if (wsRef.current !== sock) return;
        wsRef.current = null;
        // 斷線＝退回舊 autosave 路徑；peers 清空（幽靈 caret 比沒有 caret 更誤導）
        setActive(false);
        setPeers(new Map());
        if (disposed) return;
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      };
      sock.onerror = () => sock.close();
    };
    connect();

    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      doc.off("update", onUpdate);
      try {
        ws?.close();
      } catch {
        /* 已斷線 */
      }
      wsRef.current = null;
      docRef.current = null;
      doc.destroy();
      setActive(false);
      setPeers(new Map());
    };
    // enabled/projectId 變了才重連；onRemote 走 ref
  }, [opts.enabled, opts.projectId]);

  const applyLocal = useCallback((next: string): boolean => {
    const doc = docRef.current;
    if (!doc || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
    const ytext = doc.getText(TEXT_KEY);
    const splice = diffToSplice(ytext.toString(), next);
    if (!splice) return true; // 沒變＝已同步
    doc.transact(() => {
      if (splice.removed > 0) ytext.delete(splice.index, splice.removed);
      if (splice.inserted) ytext.insert(splice.index, splice.inserted);
    }, "local");
    return true;
  }, []);

  const sendCaret = useCallback((start: number, end: number) => {
    const now = Date.now();
    if (now - lastAwarenessAt.current < AWARENESS_MIN_MS) return;
    lastAwarenessAt.current = now;
    const sock = wsRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "awareness", a: { cursor: start, selectionEnd: end } }));
    }
  }, []);

  return { active, applyLocal, sendCaret, peers };
}

/* base64 ↔ bytes：瀏覽器沒有 Buffer；atob/btoa 走 latin1 字串繞一圈 */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
