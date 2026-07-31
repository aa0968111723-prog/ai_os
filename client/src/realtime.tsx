/**
 * 即時協作前端（任務 D）：useCollab hook＋游標覆蓋層＋編輯指示區塊。
 * 走原生 WebSocket 同源 /ws；協定與 server/services/realtime.ts 嚴格對應——兩邊要一起改。
 * 斷線自動重連（2s→4s→8s→上限 10s）；斷線期間各卡片原有輪詢仍在，功能不中斷只是少了即時感。
 * 連續失敗 30 次即停止重連（伺服器長期不通時別無限打）；收到 4403（權限已變更）直接停，重連也只會再被踢。
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
  /** 0..1：相對主內容容器寬度的比例（兩人視窗寬度不同也對得上欄位） */
  x: number;
  /**
   * 0..1：相對主內容容器「高度」的比例。
   * 舊版是絕對 px——手機（單欄）與桌機（雙欄）版面高度差數倍，px 會整個對不上（回饋 #5 位置不精準）。
   */
  y: number;
  /**
   * 錨點定位（優先於 x/y）：`#elementId` 或 data-fb 卡片代號＋卡內相對比例。
   * 兩端版面不同（手機單欄 vs 桌機雙欄）時，靠「同一張卡／同一列」對位比整頁比例準得多；
   * 對方畫面找不到同名卡片才退回 x/y 整頁比例。
   */
  anchor?: string | null;
  ax?: number;
  ay?: number;
  /**
   * 0..1：送出當下，游標在「發送端視窗高度」的比例（高準度鏡像核心）。
   * 跟隨端把錨點鎖到同一個螢幕高度比例，而不是一律置中。
   */
  vy?: number;
  /** 0..1：發送端視窗寬度比例（橫向捲動／寬頁鎖定） */
  vx?: number;
  /**
   * 0..1：表單欄位內 caret 位置（字元 index / 字串長）。
   * 對方在 input/textarea 打字時，比滑鼠 ax/ay 更能鎖「在第幾個字」。
   */
  ci?: number;
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

/** 游標上報：≈30fps，貼近伺服器下限，極限跟手 */
const CURSOR_THROTTLE_MS = 32;
const CURSOR_TTL_MS = 4000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 10_000;
const RETRY_MAX_ATTEMPTS = 30;
/** 鏡像校正：約一幀一次，雙次量測消殘差 */
const MIRROR_SCROLL_MIN_MS = 16;
/** 對齊容差（px）；越小越準，太小會在亞像素抖 */
const MIRROR_LOCK_EPSILON_PX = 2;
/** 捲動重送游標間隔 */
const SCROLL_RESEND_MIN_MS = 48;
/** 游標點視覺插值時長（ms）——顯示更滑，不影響鎖定精度 */
const CURSOR_LERP_MS = 50;
/**
 * 鏡像預測超前量（ms）：用最近兩包速度外插，抵消網路 RTT 體感延遲。
 * 太大會「超車」抖動；40ms ≈ 半個常見 RTT，保守且有效。
 */
const MIRROR_PREDICT_LEAD_MS = 40;
/** 預測最多外推幾個封包間隔（防丟包後亂衝） */
const MIRROR_PREDICT_MAX_K = 1.25;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

const STABLE_ID_SELECTOR =
  "[data-collab-id], [data-fb][id], [id^='scene-'], [id^='asset-'], [id^='generation-'], [id^='sec-'], [id^='char-'], [id^='knowledge-'], [id^='task-'], [id^='agent-run-'], input[id], textarea[id], select[id]";

/**
 * 極限錨點：優先最深層穩定 id（表單欄位／列表列），再 data-fb 卡片。
 * `#id` 讓重複 data-fb（分鏡格×N）能對到正確那一列。
 */
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

/** 錨點 → 本機元素（#id / data-collab-id / data-fb） */
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

/** 量 ax/ay 用的元素：與錨點解析同一優先序 */
export function collabAnchorRectElement(el: Element | null | undefined): Element | null {
  if (!el || typeof el.closest !== "function") return null;
  return (
    el.closest("[data-collab-id]") ??
    el.closest(STABLE_ID_SELECTOR) ??
    el.closest("[data-fb]") ??
    null
  );
}

/**
 * 從 input/textarea 讀 caret 比例 0..1（字元 index / 字串長）。
 * 沒有 selection 或不支援時回 null。
 */
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

/**
 * 有 ci 時把欄位內比例調成「字元位置」近似：
 * - 單行 input：ax ≈ ci
 * - textarea：依換行粗估行號 → ay，行內字元 → ax
 * 滑鼠 ax/ay 仍作後備。
 */
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
    // 單行 textarea 仍用 ci 當 ax
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

/**
 * 依最近兩包速度外插，抵消網路延遲體感。
 * leadMs 為超前時間；dt 異常（太短/太長）時不預測以免抖動。
 */
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

/**
 * 對方游標 → 本機 viewport 座標。
 * 錨點可解析 → 元素＋ax/ay（可選 ci 精修）；否則容器 x/y。
 */
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

/** 沿祖先鏈找可垂直捲動的元素（含 document.scrollingElement） */
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

/**
 * 把 deltaY 盡量分配到最近的可捲容器（巢狀 scroll），剩餘再給 window。
 * 回傳實際捲動量總和。
 */
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
    // 以「請求量」計入：window.scrollY 在部分環境（測試 mock／平滑捲動）不會同步更新；
    // 殘差交給 applyMirrorViewportLock 的二次量測消掉。
    window.scrollBy({ top: remaining, left: 0, behavior: "auto" });
    applied += remaining;
    remaining = 0;
  }
  return applied;
}

/**
 * 跟隨前：打開包住錨點的 <details>（含手機 CtxCollapse），
 * 並把 aria-hidden / [hidden] 祖先標成可見意圖（派發 collab:expand）。
 * 回傳是否有展開動作（展開後 layout 可能尚未穩定，呼叫端可再鎖一次）。
 */
export function ensureAnchorExpanded(el: Element | null): boolean {
  if (!el) return false;
  let changed = false;
  let d: HTMLDetailsElement | null = el.closest("details:not([open])");
  let guard = 0;
  while (d && guard++ < 8) {
    d.open = true;
    changed = true;
    // 讓 React 控管 open 的 details 也能同步 state（ProjectPage CtxCollapse）
    try {
      d.dispatchEvent(new Event("toggle", { bubbles: true }));
    } catch {
      /* jsdom 舊版可能無 toggle Event */
    }
    d = d.parentElement?.closest("details:not([open])") ?? null;
  }
  // 可選：資料屬性標記的收合區（非 details 實作時）
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

/**
 * 極限 viewport lock：
 * 1) 展開 details／手機收合區
 * 2) 把錨點鎖到發送端 vy（與可選 vx）；ci 精修欄位內點
 * 3) 沿巢狀 scroll parent 分配 delta
 * 4) 雙次量測消殘差；若剛展開再做第三次（等 layout）
 */
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
  // 僅輕微夾制：極限模式盡量保留對方真實螢幕位置（頂欄/底欄邊緣也跟）
  const targetVy = Math.min(0.95, Math.max(0.05, rawVy));
  const targetClientY = targetVy * vh;

  let deltaY = point.y - targetClientY;
  let movedAny = false;

  if (Math.abs(deltaY) >= MIRROR_LOCK_EPSILON_PX) {
    const applied = applyScrollDeltaY(el, deltaY);
    if (Math.abs(applied) >= 0.5) movedAny = true;
  }

  // 水平：若有巢狀橫向捲動或頁面可橫捲，用 vx 鎖（可選）
  if (typeof c.vx === "number" && Number.isFinite(c.vx) && vw > 0 && el) {
    const rawVx = clamp01(c.vx);
    const targetClientX = Math.min(0.95, Math.max(0.05, rawVx)) * vw;
    const point2x = cursorViewportPoint(c, container);
    if (point2x) {
      const deltaX = point2x.x - targetClientX;
      if (Math.abs(deltaX) >= MIRROR_LOCK_EPSILON_PX) {
        // 優先橫向可捲父層
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

  // 雙次校正：scroll 後 reflow，再消一次殘差（極限精度關鍵）
  const point2 = cursorViewportPoint(c, container);
  if (point2) {
    const residual = point2.y - targetClientY;
    if (Math.abs(residual) >= MIRROR_LOCK_EPSILON_PX) {
      const applied = applyScrollDeltaY(el, residual);
      if (Math.abs(applied) >= 0.5) movedAny = true;
    }
  }
  // 剛展開 details 時高度常在下一幀才穩定——再消一次殘差
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
  projectId: string,
  /** false＝不連線並關閉既有連線：專案還沒確認可讀（或根本無權讀）前不開 WS */
  enabled: boolean,
): {
  /** 目前在這個專案裡的所有人（含自己；同人多分頁已去重） */
  peers: CollabPeer[];
  cursors: Map<string, CollabCursor>;
  /**
   * 游標即時 ref（WS 一到就寫，不經 React render）。
   * 鏡像跟隨讀這個，比 state 少 1 幀延遲——極限精度熱路徑。
   */
  cursorsLiveRef: RefObject<Map<string, CollabCursor>>;
  /** zone → 正在該區塊編輯的其他人 */
  focusZones: Record<string, CollabPeer[]>;
  self: CollabPeer | null;
  sendFocus: (zone: string | null) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Pointer Events 一套涵蓋滑鼠＋觸控＋手寫筆——手機協作也能上報游標位置 */
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** WebSocket 是否已 hello 成功（斷線／重連中為 false）——UI 可顯示「即時同步」狀態 */
  connected: boolean;
} {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [self, setSelf] = useState<CollabPeer | null>(null);
  const [connected, setConnected] = useState(false);
  const [cursors, setCursors] = useState<Map<string, CollabCursor>>(() => new Map());
  /** 熱路徑：WS 訊息先寫這裡，鏡像 rAF 直接讀 */
  const cursorsLiveRef = useRef<Map<string, CollabCursor>>(new Map());
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
          // 先寫 live ref（鏡像熱路徑），再觸發 React 重繪覆蓋層
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
        setConnected(false);
        setZoneByUser({});
        cursorsLiveRef.current = new Map();
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
      setConnected(false);
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
        if (changed) cursorsLiveRef.current = next;
        return changed ? next : prev; // 沒變就回原 Map，避免每秒白白重繪
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 即時同步上行：本頁任何 mutation 成功→告訴同房其他人「有東西變了」
  useEffect(() => {
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") {
        // 跳過標記 meta.silentSync 的「非內容」mutation（如每 ~30s 的 markRead）：這些不代表內容變更，
        // 廣播失效只會讓同房協作者無謂地週期性重抓全部查詢。
        if (event.mutation?.options?.meta?.silentSync) return;
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "invalidate" }));
      }
    });
  }, [queryClient]);

  /**
   * 最近一次指標：client + 文件座標（scrollY/X + client）。
   * 捲動重送時用 doc 座標回推 client，鎖定「同一文件點」而非「同一螢幕像素」。
   */
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
    // 表單 caret：打字／選取時比滑鼠點更準
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
    // 指標所在 collab zone 一併上報（不只鍵盤 focus）
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

  // 鍵盤 caret／選取變更：對方在輸入框打字時也持續上報（不必移滑鼠）
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
      // 以欄位中心為 client 點；真正精度靠 ci
      sendCursorAt(r.left + r.width * 0.5, r.top + Math.min(r.height * 0.5, 18), ae);
    };
    document.addEventListener("selectionchange", onSel);
    document.addEventListener("keyup", onSel, true);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      document.removeEventListener("keyup", onSel, true);
    };
  }, [enabled, sendCursorAt]);

  // 捲動重送：優先鎖「同一文件點」（docY - scrollY），超出視窗才改採 elementFromPoint
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
        // 文件座標回推：維持同一 document 點
        clientX = last.docX - window.scrollX;
        clientY = last.docY - window.scrollY;
        const inView =
          clientY >= 0 && clientY <= vh && clientX >= 0 && clientX <= vw;
        if (inView) {
          // 錨點仍在 → 直接用錨點重算更準（版面 reflow 後 doc 可能偏）
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
          // 文件點已出視窗：跟隨者會用 vy 對齊；發送端改報視窗中心內容
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
    // 巢狀容器捲動也要重送
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [enabled, sendCursorAt]);

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

  return { peers, cursors, cursorsLiveRef, focusZones, self, sendFocus, containerRef, onPointerMove, connected };
}

// ─── 鏡像跟隨模式（非螢幕串流：跟隨對方焦點區＋游標錨點，做出「同畫面」感）───

/** 協作視角：一般＝只看 presence／游標；鏡像＝主動跟隨選定夥伴的焦點與游標 */
export type CollabViewMode = "live" | "mirror";

/** 從 focusZones 反查某 user 目前在哪個 collab zone（沒有回 null） */
export function zoneOfPeer(userId: string, focusZones: Record<string, CollabPeer[]>): string | null {
  for (const [zone, list] of Object.entries(focusZones)) {
    if (list.some((p) => p.userId === userId)) return zone;
  }
  return null;
}

/** 可跟隨的其他人（排除自己） */
export function followablePeers(peers: CollabPeer[], selfId: string | null | undefined): CollabPeer[] {
  if (!selfId) return peers;
  return peers.filter((p) => p.userId !== selfId);
}

/**
 * 極限精準鏡像跟隨：
 * - 讀 cursorsLiveRef（WS 直寫，零 React 幀延遲）
 * - 每包 cursor：速度預測外插 → viewport lock（vy/vx/ci）＋巢狀 scroll＋雙／三次校正＋auto-open details
 * - rAF 迴圈；無游標時才 zone 粗定位
 */
export function useCollabMirrorFollow(
  mode: CollabViewMode,
  followUserId: string | null,
  /** 優先傳 live ref；也可傳 Map（測試／相容） */
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

      // 速度預測：用上一包外插，抵消 RTT 體感延遲
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

      // 先標記已消費，避免同包重入；鎖定失敗仍保留 ts 以免空轉
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

/**
 * 標題列旁的協作模式切換：一般 ／ 鏡像跟隨（選夥伴）。
 * 鏡像不是遠端桌面串流，是「捲動＋焦點跟著對方走」。
 */
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
  // 被跟隨者離線 → 清掉選擇
  useEffect(() => {
    if (followUserId && !others.some((p) => p.userId === followUserId)) onFollowChange(null);
  }, [followUserId, others, onFollowChange]);

  // 進入鏡像且尚未選人 → 自動選第一位他人
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

/**
 * 把一枚游標換算成覆蓋層內的座標（px）。
 * 有錨點且本機找得到對應元素（#id / data-collab-id / data-fb）→ 元素位置＋卡內比例；
 * 否則退回整頁寬高比例。
 */
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

/** 單枚游標：rAF 插值到最新錨點座標（視覺滑順；鎖定精度不靠這個） */
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
      // 貼近目標時直接吸附，避免亞像素殘抖
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

/** 其他人的彩色游標覆蓋層：掛在 position:relative 的主內容容器內 */
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

/**
 * 編輯指示區塊（像 Google 試算表儲存格外框）：
 * 內部任何元素得到鍵盤焦點→通知同房「我在這區」；有人在時畫該人顏色內框＋右上角小標籤。
 */
export function CollabZone({
  zone,
  watchers,
  sendFocus,
  children,
  /** 鏡像跟隨中：這區是被跟隨者目前焦點 → 加粗描邊提示 */
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
        // focus 移到區塊外才算離開；區塊內欄位間切換不要閃爍 null→zone
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
