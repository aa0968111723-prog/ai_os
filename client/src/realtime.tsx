/**
 * 即時協作前端（任務 D）：useCollab hook＋游標覆蓋層＋編輯指示區塊。
 * 走原生 WebSocket 同源 /ws；協定與 server/services/realtime.ts 嚴格對應——兩邊要一起改。
 * 斷線自動重連（2s→4s→8s→上限 10s）；斷線期間各卡片原有輪詢仍在，功能不中斷只是少了即時感。
 * 連續失敗 30 次即停止重連（伺服器長期不通時別無限打）；收到 4403（權限已變更）直接停，重連也只會再被踢。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "./api";

export interface CollabPeer {
  userId: string;
  name: string;
  color: string;
}

export interface CollabCursor {
  /** 0..1：相對主內容容器寬度的比例（兩人視窗寬度不同也對得上欄位） */
  x: number;
  /** 以容器頂為原點的 px */
  y: number;
  name: string;
  color: string;
  /** 最後更新時間；4 秒沒動靜自動移除（對方離開/切分頁時游標不要僵在畫面上） */
  ts: number;
}

/** 編輯指示的區塊代號（顯示文字即代號，兩端與畫面一致） */
export const COLLAB_ZONES = {
  worldview: "世界觀",
  studio: "生成台",
  assets: "素材庫",
  scenes: "分鏡",
  messages: "留言",
} as const;

const CURSOR_THROTTLE_MS = 80;
const CURSOR_TTL_MS = 4000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 10_000;
const RETRY_MAX_ATTEMPTS = 30;

export function useCollab(
  projectId: string,
  /** false＝不連線並關閉既有連線：專案還沒確認可讀（或根本無權讀）前不開 WS */
  enabled: boolean,
): {
  /** 目前在這個專案裡的所有人（含自己；同人多分頁已去重） */
  peers: CollabPeer[];
  cursors: Map<string, CollabCursor>;
  /** zone → 正在該區塊編輯的其他人 */
  focusZones: Record<string, CollabPeer[]>;
  self: CollabPeer | null;
  sendFocus: (zone: string | null) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  onMouseMove: (e: ReactMouseEvent<HTMLDivElement>) => void;
} {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [self, setSelf] = useState<CollabPeer | null>(null);
  const [cursors, setCursors] = useState<Map<string, CollabCursor>>(() => new Map());
  const [zoneByUser, setZoneByUser] = useState<Record<string, string>>({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const lastCursorAtRef = useRef(0);
  const lastZoneRef = useRef<string | null>(null);
  // utils 走 ref：不進 effect 依賴，避免任何 identity 變化引發整條 WebSocket 重連
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  useEffect(() => {
    if (!enabled) return; // 未啟用不連線；由上一輪（enabled 時）effect 的 cleanup 關閉既有連線
    let disposed = false;
    let ws: WebSocket | null = null;
    let retryDelay = RETRY_BASE_MS;
    let retryCount = 0;
    let retryTimer: number | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws?projectId=${encodeURIComponent(projectId)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retryDelay = RETRY_BASE_MS;
        retryCount = 0;
      };
      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === "hello") {
          selfIdRef.current = msg.self?.userId ?? null;
          setSelf(msg.self ?? null);
          setPeers(msg.users ?? []);
          const zones: Record<string, string> = {};
          for (const f of msg.focus ?? []) if (f?.zone) zones[f.userId] = f.zone;
          setZoneByUser(zones);
        } else if (msg.type === "presence") {
          setPeers(msg.users ?? []);
        } else if (msg.type === "cursor") {
          if (msg.userId === selfIdRef.current) return;
          setCursors((prev) => {
            const next = new Map(prev);
            next.set(msg.userId, { x: msg.x, y: msg.y, name: msg.name, color: msg.color, ts: Date.now() });
            return next;
          });
        } else if (msg.type === "focus") {
          setZoneByUser((prev) => {
            const next = { ...prev };
            if (msg.zone) next[msg.userId] = msg.zone;
            else delete next[msg.userId];
            return next;
          });
        } else if (msg.type === "invalidate") {
          // 粗粒度即時同步：對方任何 mutation 成功→整包查詢失效重抓。
          // app 小、事件頻率低，刻意不做精細 per-key 失效。
          void utilsRef.current.invalidate();
        }
      };
      ws.onerror = () => {
        /* onclose 會接手重連 */
      };
      ws.onclose = (ev) => {
        if (disposed) return;
        // 斷線期間別留舊 presence/游標騙人；重連成功 hello 會整包重建
        setPeers([]);
        setSelf(null);
        setZoneByUser({});
        setCursors(new Map());
        if (ev.code === 4403) return; // 伺服器重驗判定權限已變更：重連也只會再被踢，直接停
        retryCount += 1;
        if (retryCount >= RETRY_MAX_ATTEMPTS) {
          console.warn("協作連線連續失敗已達上限，停止重連（重新整理頁面可再試）");
          return;
        }
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      };
    };
    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      wsRef.current = null;
      ws?.close();
    };
  }, [projectId, enabled]);

  // 游標過期清掃
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCursors((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [key, cur] of next) {
          if (now - cur.ts > CURSOR_TTL_MS) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : prev; // 沒變就回原 Map，避免每秒白白重繪
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 即時同步上行：本頁任何 mutation 成功→告訴同房其他人「有東西變了」
  useEffect(() => {
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "invalidate" }));
      }
    });
  }, [queryClient]);

  const onMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    const ws = wsRef.current;
    if (!el || !ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastCursorAtRef.current < CURSOR_THROTTLE_MS) return;
    lastCursorAtRef.current = now;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = e.clientY - rect.top;
    ws.send(JSON.stringify({ type: "cursor", x, y }));
  }, []);

  const sendFocus = useCallback((zone: string | null) => {
    if (lastZoneRef.current === zone) return; // focus 在區塊內部元素間移動時會反覆觸發，去重後才上行
    lastZoneRef.current = zone;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "focus", zone }));
  }, []);

  const focusZones = useMemo(() => {
    const out: Record<string, CollabPeer[]> = {};
    for (const [userId, zone] of Object.entries(zoneByUser)) {
      if (userId === selfIdRef.current) continue;
      const peer = peers.find((p) => p.userId === userId);
      if (!peer) continue; // 已離線者的殘留 focus 靠 presence 名單過濾掉
      (out[zone] ??= []).push(peer);
    }
    return out;
  }, [zoneByUser, peers]);

  return { peers, cursors, focusZones, self, sendFocus, containerRef, onMouseMove };
}

/** 其他人的彩色游標覆蓋層：掛在 position:relative 的主內容容器內 */
export function CursorOverlay({ cursors }: { cursors: Map<string, CollabCursor> }) {
  if (cursors.size === 0) return null;
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 40, overflow: "hidden" }}>
      {[...cursors.entries()].map(([userId, c]) => (
        <div
          key={userId}
          style={{
            position: "absolute",
            left: `${c.x * 100}%`, // 百分比＝x × 容器寬，容器縮放也不跑位
            top: c.y,
            transition: "left 0.08s linear, top 0.08s linear",
            display: "flex",
            alignItems: "flex-start",
          }}
        >
          <svg width="14" height="18" viewBox="0 0 14 18" style={{ display: "block", filter: "drop-shadow(0 1px 1px rgba(74,54,32,.28))" }}>
            <path d="M1 1 L1 14.5 L4.6 11.2 L7 16.5 L9.4 15.4 L7 10.2 L12 9.6 Z" fill={c.color} stroke="#fff" strokeWidth="1" />
          </svg>
          <span
            style={{
              background: c.color,
              color: "#fff",
              textShadow: "0 1px 2px var(--scrim)",
              borderRadius: 999,
              padding: "1px 8px",
              fontSize: "var(--fs-11)",
              whiteSpace: "nowrap",
              marginTop: 12,
              marginLeft: 2,
            }}
          >
            {c.name}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 編輯指示區塊（像 Google 試算表儲存格外框）：
 * 內部任何元素得到鍵盤焦點→通知同房「我在這區」；有人在時畫該人顏色內框＋右上角小標籤。
 */
export function CollabZone({
  zone,
  watchers,
  sendFocus,
  children,
}: {
  zone: string;
  watchers: CollabPeer[];
  sendFocus: (zone: string | null) => void;
  children: ReactNode;
}) {
  const first = watchers[0];
  return (
    <div
      onFocusCapture={() => sendFocus(zone)}
      onBlurCapture={(e) => {
        // focus 移到區塊外才算離開；區塊內欄位間切換不要閃爍 null→zone
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) sendFocus(null);
      }}
      style={{
        position: "relative",
        ...(first ? { boxShadow: `inset 0 0 0 2px ${first.color}`, borderRadius: "var(--radius)" } : {}),
      }}
    >
      {first && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 4,
            right: 8,
            zIndex: 30,
            pointerEvents: "none",
            background: first.color,
            color: "#fff",
            textShadow: "0 1px 2px var(--scrim)",
            fontSize: "var(--fs-11)",
            padding: "1px 8px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          {first.name} 正在這裡{watchers.length > 1 ? ` +${watchers.length - 1}` : ""}
        </span>
      )}
      {children}
    </div>
  );
}
