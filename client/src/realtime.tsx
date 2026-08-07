/**
 * 即時協作前端（任務 D）：useCollab hook＋游標覆蓋層＋編輯指示區塊。
 * 走原生 WebSocket 同源 /ws；協定與 server/services/realtime.ts 嚴格對應——兩邊要一起改。
 * 斷線自動重連（2s→4s→8s→上限 10s）；斷線期間各卡片原有輪詢仍在，功能不中斷只是少了即時感。
 * 連續失敗 30 次即停止重連（伺服器長期不通時別無限打）；收到 4403（權限已變更）直接停，重連也只會再被踢。
 *
 * 支援兩種房間：
 *   - kind="project"（預設）→ /ws?projectId=  專案高精度錨點／游標／zone／鏡像跟隨
 *   - kind="group"          → /ws?groupId=   全組 presence + 游標（Launchpad 用）
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "./api";
import { Button, Hint } from "./components/ui";

export interface CollabPeer {
  userId: string;
  name: string;
  color: string;
}

export interface CollabCursor {
  x: number;
  y: number;
  anchor?: string | null;
  ax?: number;
  ay?: number;
  vy?: number;
  vx?: number;
  ci?: number;
  name: string;
  color: string;
  ts: number;
}

export const COLLAB_ZONES = {
  worldview: "世界觀",
  studio: "生成台",
  assets: "素材庫",
  scenes: "分鏡",
  messages: "留言",
} as const;

const CURSOR_THROTTLE_MS = 32;
const CURSOR_TTL_MS = 4000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 10_000;
const RETRY_MAX_ATTEMPTS = 30;
const MIRROR_SCROLL_MIN_MS = 16;
const MIRROR_LOCK_EPSILON_PX = 2;
const SCROLL_RESEND_MIN_MS = 48;
const CURSOR_LERP_MS = 50;
const MIRROR_PREDICT_LEAD_MS = 40;
const MIRROR_PREDICT_MAX_K = 1.25;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

const STABLE_ID_SELECTOR =
  "[data-collab-id], [data-fb][id], [id^='scene-'], [id^='asset-'], [id^='generation-'], [id^='sec-'], [id^='char-'], [id^='knowledge-'], [id^='task-'], [id^='agent-run-'], input[id], textarea[id], select[id]";

export function collabAnchorFromElement(el: Element | null | undefined): string | null {
  if (!el || typeof el.closest !== "function") return null;
  const byCollab = el.closest("[data-collab-id]");
  if (byCollab) {
    const raw = byCollab.getAttribute("data-collab-id")?.trim();
    if (raw && raw.length > 0 && raw.length <= 80) return raw.startsWith("#") ? raw : `#${raw}`;
  }
  const withId = el.closest(STABLE_ID_SELECTOR);
  if (withId) {
    const id = typeof withId.id === "string" ? withId.id.trim() : "";
    if (id && id.length <= 78 && !/[\s"]/.test(id)) return `#${id}`;
  }
  const card = el.closest("[data-fb]");
  if (!card) return null;
  const id = typeof card.id === "string" ? card.id.trim() : "";
  if (id && id.length <= 78 && !/[\s"]/.test(id)) return `#${id}`;
  const name = card.getAttribute("data-fb")?.trim();
  return name && name.length > 0 ? name : null;
}

export function findCollabAnchorElement(anchor: string | null | undefined): Element | null {
  if (!anchor) return null;
  try {
    if (anchor.startsWith("#")) {
      const id = anchor.slice(1);
      if (!id) return null;
      return document.getElementById(id) ?? document.querySelector(`[data-collab-id="${CSS.escape(id)}"]`);
    }
    return (
      document.querySelector(`[data-collab-id="${CSS.escape(anchor)}"]`) ??
      document.querySelector(`[data-fb="${CSS.escape(anchor)}"]`)
    );
  } catch {
    return null;
  }
}

export function collabAnchorRectElement(el: Element | null | undefined): Element | null {
  if (!el || typeof el.closest !== "function") return null;
  return (
    el.closest("[data-collab-id]") ??
    el.closest(STABLE_ID_SELECTOR) ??
    el.closest("[data-fb]") ??
    null
  );
}

export function caretRatioFromElement(el: Element | null | undefined): number | null {
  if (!el) return null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const len = el.value?.length ?? 0;
    if (len <= 0) return 0;
    const idx = typeof el.selectionStart === "number" ? el.selectionStart : len;
    return clamp01(idx / len);
  }
  return null;
}

export function refineAnchorRatiosWithCaret(
  el: Element | null | undefined,
  c: Pick<CollabCursor, "ax" | "ay" | "ci">,
): { ax: number; ay: number } {
  const baseAx = typeof c.ax === "number" && Number.isFinite(c.ax) ? clamp01(c.ax) : 0.5;
  const baseAy = typeof c.ay === "number" && Number.isFinite(c.ay) ? clamp01(c.ay) : 0.5;
  if (typeof c.ci !== "number" || !Number.isFinite(c.ci) || !el) return { ax: baseAx, ay: baseAy };
  const ci = clamp01(c.ci);
  if (el instanceof HTMLInputElement) {
    return { ax: ci, ay: baseAy };
  }
  if (el instanceof HTMLTextAreaElement) {
    const val = el.value ?? "";
    if (val.length === 0) return { ax: 0, ay: 0 };
    const idx = Math.min(val.length, Math.round(ci * val.length));
    const before = val.slice(0, idx);
    const lines = before.split("\n");
    const lineIdx = Math.max(0, lines.length - 1);
    const totalLines = Math.max(1, val.split("\n").length);
    const lineText = lines[lineIdx] ?? "";
    const fullLine = val.split("\n")[lineIdx] ?? lineText;
    const ax = fullLine.length > 0 ? clamp01(lineText.length / fullLine.length) : 0;
    const ay = clamp01(lineIdx / Math.max(1, totalLines - 1 || 1));
    if (totalLines === 1) return { ax: ci, ay: baseAy };
    return { ax, ay };
  }
  return { ax: baseAx, ay: baseAy };
}

export type CursorMotionSample = {
  t: number;
  ax: number;
  ay: number;
  vy: number;
  vx: number;
};

export function extrapolateCursorPose(
  prev: CursorMotionSample | null | undefined,
  curr: CursorMotionSample,
  leadMs: number = MIRROR_PREDICT_LEAD_MS,
): { ax: number; ay: number; vy: number; vx: number } {
  if (!prev || !(leadMs > 0) || curr.t <= prev.t) {
    return { ax: curr.ax, ay: curr.ay, vy: curr.vy, vx: curr.vx };
  }
  const dt = curr.t - prev.t;
  if (dt < 12 || dt > 400) {
    return { ax: curr.ax, ay: curr.ay, vy: curr.vy, vx: curr.vx };
  }
  const k = Math.min(leadMs / dt, MIRROR_PREDICT_MAX_K);
  const step = (a: number, b: number) => clamp01(b + (b - a) * k);
  return {
    ax: step(prev.ax, curr.ax),
    ay: step(prev.ay, curr.ay),
    vy: step(prev.vy, curr.vy),
    vx: step(prev.vx, curr.vx),
  };
}

export function cursorViewportPoint(
  c: Pick<CollabCursor, "x" | "y" | "anchor" | "ax" | "ay" | "ci">,
  container: Element | null | undefined,
): { x: number; y: number } | null {
  const el = findCollabAnchorElement(c.anchor ?? null);
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const { ax, ay } = refineAnchorRatiosWithCaret(el, c);
      return { x: r.left + ax * r.width, y: r.top + ay * r.height };
    }
  }
  if (container) {
    const r = container.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { x: r.left + clamp01(c.x) * r.width, y: r.top + clamp01(c.y) * r.height };
    }
  }
  return null;
}

export function listScrollParents(from: Element | null): Element[] {
  const out: Element[] = [];
  let node: Element | null = from;
  while (node) {
    if (node instanceof HTMLElement) {
      const st = getComputedStyle(node);
      const oy = st.overflowY;
      if ((oy === "auto" || oy === "scroll" || oy === "overlay") && node.scrollHeight > node.clientHeight + 1) {
        out.push(node);
      }
    }
    node = node.parentElement;
  }
  const root = document.scrollingElement;
  if (root && !out.includes(root)) out.push(root);
  return out;
}

export function applyScrollDeltaY(fromEl: Element | null, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  let remaining = deltaY;
  let applied = 0;
  for (const parent of listScrollParents(fromEl)) {
    if (Math.abs(remaining) < 0.5) break;
    if (!(parent instanceof HTMLElement) && parent !== document.scrollingElement) continue;
    const el = parent as HTMLElement;
    const before = el.scrollTop;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const next = Math.min(max, Math.max(0, before + remaining));
    const moved = next - before;
    if (moved !== 0) {
      el.scrollTop = next;
      remaining -= moved;
      applied += moved;
    }
  }
  if (Math.abs(remaining) >= 0.5) {
    window.scrollBy({ top: remaining, left: 0, behavior: "auto" });
    applied += remaining;
    remaining = 0;
  }
  return applied;
}

export function ensureAnchorExpanded(el: Element | null): boolean {
  if (!el) return false;
  let changed = false;
  let d: HTMLDetailsElement | null = el.closest("details:not([open])");
  let guard = 0;
  while (d && guard++ < 8) {
    d.open = true;
    changed = true;
    try {
      d.dispatchEvent(new Event("toggle", { bubbles: true }));
    } catch {
      /* jsdom */
    }
    d = d.parentElement?.closest("details:not([open])") ?? null;
  }
  let node: Element | null = el;
  guard = 0;
  while (node && guard++ < 12) {
    if (node instanceof HTMLElement && node.hasAttribute("data-collab-expand")) {
      if (node.getAttribute("data-collab-expand") !== "open") {
        node.setAttribute("data-collab-expand", "open");
        changed = true;
        try {
          node.dispatchEvent(new CustomEvent("collab:expand", { bubbles: true, detail: { el: node } }));
        } catch {
          /* ignore */
        }
      }
    }
    node = node.parentElement;
  }
  return changed;
}

export function applyMirrorViewportLock(
  c: Pick<CollabCursor, "x" | "y" | "anchor" | "ax" | "ay" | "vy" | "ci"> & { vx?: number },
  container: Element | null | undefined,
): boolean {
  const el = findCollabAnchorElement(c.anchor ?? null);
  const expanded = ensureAnchorExpanded(el);
  const point = cursorViewportPoint(c, container);
  if (!point) return false;
  const vh = window.innerHeight || 0;
  const vw = window.innerWidth || 0;
  if (vh <= 0) return false;

  const rawVy = typeof c.vy === "number" && Number.isFinite(c.vy) ? c.vy : 0.42;
  const targetVy = Math.min(0.95, Math.max(0.05, rawVy));
  const targetClientY = targetVy * vh;

  let deltaY = point.y - targetClientY;
  let movedAny = false;

  if (Math.abs(deltaY) >= MIRROR_LOCK_EPSILON_PX) {
    const applied = applyScrollDeltaY(el, deltaY);
    if (Math.abs(applied) >= 0.5) movedAny = true;
  }

  if (typeof c.vx === "number" && Number.isFinite(c.vx) && vw > 0 && el) {
    const rawVx = clamp01(c.vx);
    const targetClientX = Math.min(0.95, Math.max(0.05, rawVx)) * vw;
    const point2x = cursorViewportPoint(c, container);
    if (point2x) {
      const deltaX = point2x.x - targetClientX;
      if (Math.abs(deltaX) >= MIRROR_LOCK_EPSILON_PX) {
        let rem = deltaX;
        let node: Element | null = el;
        while (node && Math.abs(rem) >= 0.5) {
          if (node instanceof HTMLElement) {
            const st = getComputedStyle(node);
            if ((st.overflowX === "auto" || st.overflowX === "scroll" || st.overflowX === "overlay") && node.scrollWidth > node.clientWidth + 1) {
              const before = node.scrollLeft;
              const max = node.scrollWidth - node.clientWidth;
              const next = Math.min(max, Math.max(0, before + rem));
              node.scrollLeft = next;
              rem -= next - before;
              if (next !== before) movedAny = true;
            }
          }
          node = node.parentElement;
        }
        if (Math.abs(rem) >= 0.5) {
          window.scrollBy({ left: rem, top: 0, behavior: "auto" });
          movedAny = true;
        }
      }
    }
  }

  const point2 = cursorViewportPoint(c, container);
  if (point2) {
    const residual = point2.y - targetClientY;
    if (Math.abs(residual) >= MIRROR_LOCK_EPSILON_PX) {
      const applied = applyScrollDeltaY(el, residual);
      if (Math.abs(applied) >= 0.5) movedAny = true;
    }
  }
  if (expanded) {
    const point3 = cursorViewportPoint(c, container);
    if (point3) {
      const residual = point3.y - targetClientY;
      if (Math.abs(residual) >= MIRROR_LOCK_EPSILON_PX) {
        const applied = applyScrollDeltaY(el, residual);
        if (Math.abs(applied) >= 0.5) movedAny = true;
      }
    }
  }
  return movedAny;
}

export function useCollab(
  /** projectId 或 groupId（由 kind 決定） */
  id: string,
  /** false＝不連線並關閉既有連線：專案還沒確認可讀（或根本無權讀）前不開 WS */
  enabled: boolean,
  /** "project"（預設，專案高精度錨點）或 "group"（全組 presence／游標） */
  kind: "project" | "group" = "project",
): {
  peers: CollabPeer[];
  cursors: Map<string, CollabCursor>;
  cursorsLiveRef: RefObject<Map<string, CollabCursor>>;
  focusZones: Record<string, CollabPeer[]>;
  self: CollabPeer | null;
  sendFocus: (zone: string | null) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  connected: boolean;
} {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [self, setSelf] = useState<CollabPeer | null>(null);
  const [connected, setConnected] = useState(false);
  const [cursors, setCursors] = useState<Map<string, CollabCursor>>(() => new Map());
  const cursorsLiveRef = useRef<Map<string, CollabCursor>>(new Map());
  const [zoneByUser, setZoneByUser] = useState<Record<string, string>>({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const lastCursorAtRef = useRef(0);
  const lastZoneRef = useRef<string | null>(null);
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let ws: WebSocket | null = null;
    let retryDelay = RETRY_BASE_MS;
    let retryCount = 0;
    let retryTimer: number | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const qs = kind === "group" ? `groupId=${encodeURIComponent(id)}` : `projectId=${encodeURIComponent(id)}`;
      ws = new WebSocket(`${proto}://${location.host}/ws?${qs}`);
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
          setConnected(true);
          const zones: Record<string, string> = {};
          for (const f of msg.focus ?? []) if (f?.zone) zones[f.userId] = f.zone;
          setZoneByUser(zones);
        } else if (msg.type === "presence") {
          setPeers(msg.users ?? []);
        } else if (msg.type === "cursor") {
          if (msg.userId === selfIdRef.current) return;
          const entry: CollabCursor = {
            x: msg.x,
            y: msg.y,
            anchor: typeof msg.anchor === "string" ? msg.anchor : null,
            ax: typeof msg.ax === "number" ? msg.ax : 0,
            ay: typeof msg.ay === "number" ? msg.ay : 0,
            vy: typeof msg.vy === "number" ? msg.vy : undefined,
            vx: typeof msg.vx === "number" ? msg.vx : undefined,
            ci: typeof msg.ci === "number" ? msg.ci : undefined,
            name: msg.name,
            color: msg.color,
            ts: Date.now(),
          };
          const live = new Map(cursorsLiveRef.current);
          live.set(msg.userId, entry);
          cursorsLiveRef.current = live;
          setCursors(live);
        } else if (msg.type === "focus") {
          setZoneByUser((prev) => {
            const next = { ...prev };
            if (msg.zone) next[msg.userId] = msg.zone;
            else delete next[msg.userId];
            return next;
          });
        } else if (msg.type === "invalidate") {
          void utilsRef.current.invalidate();
        }
      };
      ws.onerror = () => {
        /* onclose 會接手重連 */
      };
      ws.onclose = (ev) => {
        if (disposed) return;
        setPeers([]);
        setSelf(null);
        setConnected(false);
        setZoneByUser({});
        cursorsLiveRef.current = new Map();
        setCursors(new Map());
        if (ev.code === 4403) return;
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
      setConnected(false);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      wsRef.current = null;
      ws?.close();
    };
  }, [id, enabled, kind]);

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
        if (changed) cursorsLiveRef.current = next;
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") {
        if (event.mutation?.options?.meta?.silentSync) return;
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "invalidate" }));
      }
    });
  }, [queryClient]);

  const lastPointerRef = useRef<{
    clientX: number;
    clientY: number;
    docX: number;
    docY: number;
    target: Element | null;
    anchor: string | null;
    ax: number;
    ay: number;
  } | null>(null);
  const lastScrollSendRef = useRef(0);

  const sendCursorAt = useCallback((clientX: number, clientY: number, target: Element | null) => {
    const el = containerRef.current;
    const ws = wsRef.current;
    if (!el || !ws || ws.readyState !== WebSocket.OPEN) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const x = clamp01((clientX - rect.left) / rect.width);
    const y = clamp01((clientY - rect.top) / rect.height);
    const vh = window.innerHeight || 1;
    const vw = window.innerWidth || 1;
    const vy = clamp01(clientY / vh);
    const vx = clamp01(clientX / vw);
    let ax = 0;
    let ay = 0;
    const anchor = collabAnchorFromElement(target);
    const anchorEl = collabAnchorRectElement(target);
    if (anchorEl) {
      const ar = anchorEl.getBoundingClientRect();
      if (ar.width > 0 && ar.height > 0) {
        ax = clamp01((clientX - ar.left) / ar.width);
        ay = clamp01((clientY - ar.top) / ar.height);
      }
    }
    const field =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        ? target
        : (target?.closest?.("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null);
    const ci = caretRatioFromElement(field ?? target);
    const payload: Record<string, unknown> = { type: "cursor", x, y, anchor, ax, ay, vy, vx };
    if (ci != null) payload.ci = ci;
    ws.send(JSON.stringify(payload));
    lastPointerRef.current = {
      clientX,
      clientY,
      docX: window.scrollX + clientX,
      docY: window.scrollY + clientY,
      target,
      anchor,
      ax,
      ay,
    };
    const zoneEl = target?.closest?.("[data-collab-zone]");
    const zone = zoneEl?.getAttribute("data-collab-zone") ?? null;
    if (zone && zone !== lastZoneRef.current) {
      lastZoneRef.current = zone;
      ws.send(JSON.stringify({ type: "focus", zone }));
    }
    return true;
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const now = Date.now();
    if (now - lastCursorAtRef.current < CURSOR_THROTTLE_MS) return;
    lastCursorAtRef.current = now;
    sendCursorAt(e.clientX, e.clientY, e.target as Element | null);
  }, [sendCursorAt]);

  useEffect(() => {
    if (!enabled) return;
    const onSel = () => {
      const now = Date.now();
      if (now - lastCursorAtRef.current < CURSOR_THROTTLE_MS) return;
      const ae = document.activeElement;
      if (!(ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement)) return;
      if (containerRef.current && !containerRef.current.contains(ae)) return;
      lastCursorAtRef.current = now;
      const r = ae.getBoundingClientRect();
      sendCursorAt(r.left + r.width * 0.5, r.top + Math.min(r.height * 0.5, 18), ae);
    };
    document.addEventListener("selectionchange", onSel);
    document.addEventListener("keyup", onSel, true);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      document.removeEventListener("keyup", onSel, true);
    };
  }, [enabled, sendCursorAt]);

  useEffect(() => {
    if (!enabled) return;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastScrollSendRef.current < SCROLL_RESEND_MIN_MS) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      lastScrollSendRef.current = now;
      lastCursorAtRef.current = now;
      const last = lastPointerRef.current;
      const vh = window.innerHeight || 1;
      const vw = window.innerWidth || 1;
      let clientX: number;
      let clientY: number;
      let target: Element | null = null;
      if (last) {
        clientX = last.docX - window.scrollX;
        clientY = last.docY - window.scrollY;
        const inView =
          clientY >= 0 && clientY <= vh && clientX >= 0 && clientX <= vw;
        if (inView) {
          const aEl = findCollabAnchorElement(last.anchor);
          if (aEl) {
            const ar = aEl.getBoundingClientRect();
            if (ar.width > 0 && ar.height > 0) {
              clientX = ar.left + last.ax * ar.width;
              clientY = ar.top + last.ay * ar.height;
              target = aEl;
            }
          }
          if (!target) {
            try {
              target = document.elementFromPoint(
                Math.min(vw - 1, Math.max(0, clientX)),
                Math.min(vh - 1, Math.max(0, clientY)),
              );
            } catch {
              target = last.target;
            }
          }
        } else {
          clientX = vw / 2;
          clientY = vh * 0.42;
          try {
            target = document.elementFromPoint(clientX, clientY);
          } catch {
            target = null;
          }
        }
      } else {
        clientX = vw / 2;
        clientY = vh * 0.42;
        try {
          target = document.elementFromPoint(clientX, clientY);
        } catch {
          target = null;
        }
      }
      if (target?.closest?.("[data-collab-cursor-layer]")) {
        target = last?.target ?? null;
      }
      sendCursorAt(clientX, clientY, target);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [enabled, sendCursorAt]);

  const sendFocus = useCallback((zone: string | null) => {
    if (lastZoneRef.current === zone) return;
    lastZoneRef.current = zone;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "focus", zone }));
  }, []);

  const focusZones = useMemo(() => {
    const out: Record<string, CollabPeer[]> = {};
    for (const [userId, zone] of Object.entries(zoneByUser)) {
      if (userId === selfIdRef.current) continue;
      const peer = peers.find((p) => p.userId === userId);
      if (!peer) continue;
      (out[zone] ??= []).push(peer);
    }
    return out;
  }, [zoneByUser, peers]);

  return { peers, cursors, cursorsLiveRef, focusZones, self, sendFocus, containerRef, onPointerMove, connected };
}

export type CollabViewMode = "live" | "mirror";

export function zoneOfPeer(userId: string, focusZones: Record<string, CollabPeer[]>): string | null {
  for (const [zone, list] of Object.entries(focusZones)) {
    if (list.some((p) => p.userId === userId)) return zone;
  }
  return null;
}

export function followablePeers(peers: CollabPeer[], selfId: string | null | undefined): CollabPeer[] {
  if (!selfId) return peers;
  return peers.filter((p) => p.userId !== selfId);
}

export function useCollabMirrorFollow(
  mode: CollabViewMode,
  followUserId: string | null,
  cursors: Map<string, CollabCursor> | RefObject<Map<string, CollabCursor>>,
  focusZones: Record<string, CollabPeer[]>,
  containerRef?: RefObject<HTMLElement | null>,
): void {
  const focusRef = useRef(focusZones);
  focusRef.current = focusZones;
  const containerRefStable = containerRef;
  const lastZoneRef = useRef<string | null>(null);
  const prevSampleRef = useRef<CursorMotionSample | null>(null);
  const mapCursors = (src: typeof cursors): Map<string, CollabCursor> => {
    if (src && typeof src === "object" && "current" in src) {
      return src.current ?? new Map();
    }
    return src as Map<string, CollabCursor>;
  };

  useEffect(() => {
    if (mode !== "mirror" || !followUserId) {
      lastZoneRef.current = null;
      prevSampleRef.current = null;
      return;
    }
    const zone = zoneOfPeer(followUserId, focusZones);
    if (!zone || zone === lastZoneRef.current) return;
    lastZoneRef.current = zone;
    const cur = mapCursors(cursors).get(followUserId);
    if (cur && (findCollabAnchorElement(cur.anchor) || cur.vy != null)) return;
    let el: Element | null = null;
    try {
      el = document.querySelector(`[data-collab-zone="${CSS.escape(zone)}"]`);
    } catch {
      el = null;
    }
    if (el) {
      ensureAnchorExpanded(el);
      el.scrollIntoView({ behavior: "auto", block: "nearest" });
    }
  }, [mode, followUserId, focusZones, cursors]);

  useEffect(() => {
    if (mode !== "mirror" || !followUserId) return;
    let raf = 0;
    let lastCursorTs = 0;
    let lastScrollAt = 0;
    prevSampleRef.current = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const cur = mapCursors(cursors).get(followUserId);
      if (!cur) return;
      if (cur.ts === lastCursorTs) return;
      const now = performance.now();
      if (now - lastScrollAt < MIRROR_SCROLL_MIN_MS) return;

      const sample: CursorMotionSample = {
        t: cur.ts,
        ax: typeof cur.ax === "number" ? cur.ax : 0.5,
        ay: typeof cur.ay === "number" ? cur.ay : 0.5,
        vy: typeof cur.vy === "number" ? cur.vy : 0.42,
        vx: typeof cur.vx === "number" ? cur.vx : 0.5,
      };
      const pred = extrapolateCursorPose(prevSampleRef.current, sample, MIRROR_PREDICT_LEAD_MS);
      prevSampleRef.current = sample;
      const predicted: CollabCursor = {
        ...cur,
        ax: pred.ax,
        ay: pred.ay,
        vy: pred.vy,
        vx: pred.vx,
      };

      const ok = applyMirrorViewportLock(predicted, containerRefStable?.current ?? null);
      if (ok) {
        lastCursorTs = cur.ts;
        lastScrollAt = now;
        return;
      }
      lastCursorTs = cur.ts;
      if (!findCollabAnchorElement(cur.anchor)) {
        const zone = zoneOfPeer(followUserId, focusRef.current);
        if (!zone) return;
        let el: Element | null = null;
        try {
          el = document.querySelector(`[data-collab-zone="${CSS.escape(zone)}"]`);
        } catch {
          el = null;
        }
        if (!el) return;
        ensureAnchorExpanded(el);
        const r = el.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const vh = window.innerHeight || 1;
        const delta = mid - vh * 0.42;
        if (Math.abs(delta) >= MIRROR_LOCK_EPSILON_PX) {
          applyScrollDeltaY(el, delta);
          lastScrollAt = now;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, followUserId, cursors, containerRefStable]);
}

export function CollabModeBar({
  connected,
  mode,
  onModeChange,
  peers,
  selfId,
  followUserId,
  onFollowChange,
}: {
  connected: boolean;
  mode: CollabViewMode;
  onModeChange: (m: CollabViewMode) => void;
  peers: CollabPeer[];
  selfId: string | null | undefined;
  followUserId: string | null;
  onFollowChange: (userId: string | null) => void;
}) {
  const others = followablePeers(peers, selfId);
  useEffect(() => {
    if (followUserId && !others.some((p) => p.userId === followUserId)) onFollowChange(null);
  }, [followUserId, others, onFollowChange]);

  useEffect(() => {
    if (mode === "mirror" && !followUserId && others.length > 0) onFollowChange(others[0].userId);
  }, [mode, followUserId, others, onFollowChange]);

  if (!connected) return null;

  return (
    <div
      role="group"
      aria-label="協作視角"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        fontSize: 12,
        padding: "3px 4px",
        borderRadius: 999,
        border: "1px solid var(--border-soft)",
        background: mode === "mirror" ? "var(--primary-tint)" : "var(--card2)",
      }}
    >
      <button
        type="button"
        className={`chip${mode === "live" ? " on" : ""}`}
        style={{ margin: 0, padding: "2px 10px", fontSize: 12 }}
        title="只顯示誰在場與游標，不自動捲動"
        aria-pressed={mode === "live"}
        onClick={() => onModeChange("live")}
      >
        一般
      </button>
      <button
        type="button"
        className={`chip${mode === "mirror" ? " on" : ""}`}
        style={{ margin: 0, padding: "2px 10px", fontSize: 12 }}
        title="極限精準鏡像：錨點＋螢幕比例鎖定、巢狀捲動雙次校正（非螢幕串流）"
        aria-pressed={mode === "mirror"}
        disabled={others.length === 0}
        onClick={() => onModeChange("mirror")}
      >
        鏡像跟隨
      </button>
      {mode === "mirror" && (
        <>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, margin: 0 }}>
            <Hint as="span" style={{ fontSize: 11 }}>跟著</Hint>
            <select
              aria-label="選擇要跟隨的夥伴"
              value={followUserId ?? ""}
              onChange={(e) => onFollowChange(e.target.value || null)}
              style={{ fontSize: 12, padding: "2px 6px", maxWidth: 140 }}
            >
              {others.length === 0 && <option value="">（沒有其他人）</option>}
              {others.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => onModeChange("live")}>
            退出鏡像
          </Button>
        </>
      )}
    </div>
  );
}

function cursorPoint(c: CollabCursor, overlayRect: DOMRect): { left: number; top: number } {
  const el = findCollabAnchorElement(c.anchor);
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const ax = typeof c.ax === "number" && Number.isFinite(c.ax) ? c.ax : 0;
      const ay = typeof c.ay === "number" && Number.isFinite(c.ay) ? c.ay : 0;
      return {
        left: r.left - overlayRect.left + ax * r.width,
        top: r.top - overlayRect.top + ay * r.height,
      };
    }
  }
  return { left: c.x * overlayRect.width, top: c.y * overlayRect.height };
}

function CursorDot({ c, overlayRef }: { c: CollabCursor; overlayRef: RefObject<HTMLDivElement | null> }) {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef<{ x: number; y: number } | null>(null);
  const targetRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const p = cursorPoint(c, overlay.getBoundingClientRect());
    targetRef.current = { x: p.left, y: p.top };
    if (!posRef.current) {
      posRef.current = { x: p.left, y: p.top };
      const dot = dotRef.current;
      if (dot) {
        dot.style.left = `${p.left}px`;
        dot.style.top = `${p.top}px`;
      }
    }
  }, [c, overlayRef]);

  useEffect(() => {
    let alive = true;
    let last = performance.now();
    const step = (now: number) => {
      if (!alive) return;
      rafRef.current = requestAnimationFrame(step);
      const dot = dotRef.current;
      const pos = posRef.current;
      if (!dot || !pos) return;
      const dt = Math.min(64, now - last);
      last = now;
      const t = Math.min(1, dt / CURSOR_LERP_MS);
      const tx = targetRef.current.x;
      const ty = targetRef.current.y;
      pos.x += (tx - pos.x) * t;
      pos.y += (ty - pos.y) * t;
      if (Math.abs(tx - pos.x) < 0.4 && Math.abs(ty - pos.y) < 0.4) {
        pos.x = tx;
        pos.y = ty;
      }
      dot.style.left = `${pos.x}px`;
      dot.style.top = `${pos.y}px`;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={dotRef}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        display: "flex",
        alignItems: "flex-start",
        willChange: "left, top",
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
  );
}

export function CursorOverlay({ cursors }: { cursors: Map<string, CollabCursor> }) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  if (cursors.size === 0) return null;
  return (
    <div ref={overlayRef} data-collab-cursor-layer aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 40, overflow: "hidden" }}>
      {[...cursors.entries()].map(([userId, c]) => (
        <CursorDot key={userId} c={c} overlayRef={overlayRef} />
      ))}
    </div>
  );
}

export function CollabZone({
  zone,
  watchers,
  sendFocus,
  children,
  mirrorActive = false,
}: {
  zone: string;
  watchers: CollabPeer[];
  sendFocus: (zone: string | null) => void;
  children: ReactNode;
  mirrorActive?: boolean;
}) {
  const first = watchers[0];
  return (
    <div
      data-collab-zone={zone}
      onFocusCapture={() => sendFocus(zone)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) sendFocus(null);
      }}
      style={{
        position: "relative",
        ...(first || mirrorActive
          ? {
              boxShadow: `inset 0 0 0 ${mirrorActive ? 3 : 2}px ${mirrorActive ? (first?.color ?? "var(--primary)") : first!.color}`,
              borderRadius: "var(--radius)",
              transition: "box-shadow 0.2s ease",
            }
          : {}),
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
