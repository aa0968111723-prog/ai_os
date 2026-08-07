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

/** 在場者 ＋「這一格的訊號有多新」。stale＝超過 ANCHOR_FADE_MS 沒更新，畫成半透明。 */
export interface CollabAnchorPeer extends CollabPeer {
  stale: boolean;
}

/** 某人最後一則「有落在錨點上」的 cursor。ts 不吃 CURSOR_TTL_MS，只受 ANCHOR_* 兩段門檻管。 */
export interface CollabAnchorSighting {
  anchor: string;
  ts: number;
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
  cards: "定裝",
  studio: "生成台",
  knowledge: "知識庫",
  assets: "素材庫",
  scenes: "分鏡",
  messages: "留言",
} as const;

const CURSOR_THROTTLE_MS = 32;
const CURSOR_TTL_MS = 4000;
/**
 * 「誰在改這一格」的兩段淡出。刻意比 CURSOR_TTL_MS（4 秒）寬得多：
 * 游標圖示消失只是少了一個裝飾，但格級指示消失會讓看到的人以為對方已經走了，
 * 於是動手改同一格——而對方只是停下來想事情。10 秒沒更新先轉半透明（可能只是離開椅子），
 * 60 秒才真的移除。人離房則不等 60 秒，presence 名單一少人就立刻消失（見 groupPeersByAnchor）。
 */
const ANCHOR_FADE_MS = 10_000;
const ANCHOR_DROP_MS = 60_000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 10_000;
const RETRY_MAX_ATTEMPTS = 30;
const MIRROR_SCROLL_MIN_MS = 16;
/** 鏡像鎖定的死區半徑。2px 在有 subpixel 佈局的頁面上永遠收斂不了——
 *  每個封包都量到一點點殘差、修完又跑掉，畫面就一直在抖。 */
const MIRROR_LOCK_EPSILON_PX = 6;
/** 超過這個落差就直接追，不等死區的第二次同號確認：
 *  對方跳到另一個錨點時等一整個封包（>30ms）才動，跟隨會明顯遲鈍。 */
const MIRROR_LOCK_SNAP_PX = 24;
/** 發送端節流。真正決定鏡像更新率的是這個數字（接收端的 MIRROR_SCROLL_MIN_MS=16 永遠命不中），
 *  48ms≈21Hz 在跟隨端看起來就是一格一格跳。 */
const SCROLL_RESEND_MIN_MS = 32;
const CURSOR_LERP_MS = 50;
/** 預測前導時間的初值；穩定後改用實測封包間隔的 EMA（見 updatePacketIntervalEma）。
 *  以前寫死 40ms 而發送端節流 ≥48ms，`k = lead/dt` 恆小於 1 → 預測系統性欠量。 */
const MIRROR_PREDICT_LEAD_INIT_MS = SCROLL_RESEND_MIN_MS;
const MIRROR_PREDICT_EMA_ALPHA = 0.2;
const MIRROR_PREDICT_MAX_K = 1.25;

/** 鏡像期間掛在 <html> 上的 class：關掉 scroll-behavior:smooth 與 .gen-row 的 content-visibility
 *  （見 styles.css）。兩者都會讓「寫入捲動 → 立刻重量 rect」量到假值。 */
export const COLLAB_MIRRORING_CLASS = "collab-mirroring";

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
  leadMs: number = MIRROR_PREDICT_LEAD_INIT_MS,
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
 * 封包間隔的指數移動平均，拿來當預測前導時間。
 * 前導時間必須貼著「下一個封包多久會到」——`extrapolateCursorPose` 的 k = lead/dt，
 * lead 若小於實際間隔就永遠補不足這一段空窗，跟隨畫面會恆定落後對方一小截。
 * 對端網路抖動或分頁被凍結會送出離譜的 dt，這種樣本不能污染平均值，直接忽略
 * （範圍與 extrapolateCursorPose 判定「這一段不可信」的門檻一致）。
 */
export function updatePacketIntervalEma(ema: number, dt: number): number {
  if (!Number.isFinite(dt) || dt < 12 || dt > 400) return ema;
  return ema * (1 - MIRROR_PREDICT_EMA_ALPHA) + dt * MIRROR_PREDICT_EMA_ALPHA;
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

/**
 * 「我們自己剛剛把這個元素捲到哪裡」的帳本。
 *
 * 程式化捲動一樣會觸發 window/document 上的 capture scroll handler（見 useCollab），
 * 那條路的終點是 sendCursorAt → focus，於是「只是在旁邊看的人」會在全房畫面上
 * 變成「正在編輯」，兩個人互跟還會形成不收斂的牽引迴圈。
 *
 * 不能用時間窗旗標擋：sendCursorAt 是所有游標與 focus 的**唯一**出口（含真正的 onPointerMove），
 * 鏡像期間抑制窗幾乎一直開著，跟隨者會對全房完全隱形。
 * 改用預期位置比對——只有「捲到我們寫進去的那個值」才跳過，確定性、無時序競態，
 * 而且只擋捲動這一條路，滑鼠移動與真正的聚焦照送。
 *
 * WeakMap：元素卸載後條目自動消失，不需要任何清理路徑。
 */
const expectedScrollTop = new WeakMap<Element, number>();
const expectedScrollLeft = new WeakMap<Element, number>();
/** 捲動位置在瀏覽器端可能被四捨五入到 device pixel，比對要留 1px。 */
const PROGRAMMATIC_SCROLL_TOLERANCE_PX = 1;

/**
 * 以 scrollTo({ behavior:"instant" }) 寫入捲動，並記下預期落點。
 *
 * 必須是 "instant" 不能是 "auto"：CSSOM-View 規定 "auto" 的語意就是「照該元素 computed 的
 * scroll-behavior 走」，在 `html{scroll-behavior:smooth}`（styles.css）之下它與直接寫
 * `el.scrollTop` 完全同義——捲動變成一段動畫，同一個同步 tick 內的殘差校正就全部量到
 * 動畫中途值，等於對著移動中的目標開槍（這就是「有人覺得很準、有人覺得在飄」的來源）。
 * `html.collab-mirroring{scroll-behavior:auto}` 那條 CSS 是同一件事的第二道保險（給不認得
 * "instant" 的舊瀏覽器），兩層都要留著——只靠其中一層，另一層被誰刪掉就會靜默退回平滑動畫。
 *
 * 呼叫端必須先確認「真的會位移」：記一筆「預期落點＝現在位置」的帳永遠等不到對應的
 * scroll 事件來消耗，會留到使用者下一次真實捲動時被誤判（見 consumeProgrammaticScroll）。
 * jsdom 沒有實作 Element.prototype.scrollTo，退回直接指派。
 */
function scrollElementTo(el: HTMLElement, axis: "top" | "left", next: number): void {
  if (axis === "top") expectedScrollTop.set(el, next);
  else expectedScrollLeft.set(el, next);
  if (typeof el.scrollTo === "function") {
    el.scrollTo(axis === "top" ? { top: next, behavior: "instant" } : { left: next, behavior: "instant" });
    return;
  }
  if (axis === "top") el.scrollTop = next;
  else el.scrollLeft = next;
}

/**
 * 判斷這次 scroll 事件是不是我們自己捲的。
 * 不論比對成不成功都把記錄消掉：一筆記錄只負責它對應的那一次事件，
 * 留著它反而可能在稍後某次使用者的手動捲動剛好落在同一位置時誤擋。
 *
 * 記了幾軸就要幾軸都吻合，不能「任一軸命中就算」：同一個元素上若同時留著兩軸的帳，
 * 只有一軸對得上代表這次位移不是我們寫的那一筆，把它當成程式化捲動就等於吞掉
 * 使用者真正的操作——跟隨者對全房完全隱形，正好是這條防線最不該造成的副作用。
 */
export function consumeProgrammaticScroll(el: Element | null | undefined): boolean {
  if (!el) return false;
  let recorded = 0;
  let matched = 0;
  const top = expectedScrollTop.get(el);
  if (top !== undefined) {
    expectedScrollTop.delete(el);
    recorded += 1;
    if (Math.abs(el.scrollTop - top) <= PROGRAMMATIC_SCROLL_TOLERANCE_PX) matched += 1;
  }
  const left = expectedScrollLeft.get(el);
  if (left !== undefined) {
    expectedScrollLeft.delete(el);
    recorded += 1;
    if (Math.abs(el.scrollLeft - left) <= PROGRAMMATIC_SCROLL_TOLERANCE_PX) matched += 1;
  }
  return recorded > 0 && recorded === matched;
}

/**
 * 同一個 scroll 事件會被判斷兩次：useCollab 在 window 與 document 上各掛了一個 capture handler，
 * 而 scroll 事件雖然不冒泡，捕獲階段兩個都會收到同一個 Event 物件。
 * 帳本是「用完即銷」的，第二次查一定落空——不記住判斷結果的話，擋掉的那一次會從另一個
 * handler 原封不動送出去，這條防線等於沒有。
 */
const judgedProgrammaticEvents = new WeakSet<Event>();

/** 視窗捲動的事件 target 是 document 而不是元素，要換算回 scrollingElement 才查得到帳本。 */
export function shouldSkipCollabScrollBroadcast(ev: Event): boolean {
  if (judgedProgrammaticEvents.has(ev)) return true;
  const target = ev.target;
  const el =
    target instanceof Element
      ? target
      : target instanceof Document
        ? target.scrollingElement
        : document.scrollingElement;
  if (!consumeProgrammaticScroll(el)) return false;
  judgedProgrammaticEvents.add(ev);
  return true;
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
      scrollElementTo(el, "top", next);
      remaining -= moved;
      applied += moved;
    }
  }
  if (Math.abs(remaining) >= 0.5) {
    // 實務上走不到：listScrollParents 一律把 scrollingElement 加進清單、它幾乎一定吃得下 delta。
    // 留著當退路，但一樣要記帳，否則這條路捲出來的事件會被當成使用者操作廣播出去。
    const root = document.scrollingElement;
    if (root) {
      const max = Math.max(0, root.scrollHeight - root.clientHeight);
      const next = Math.min(max, Math.max(0, root.scrollTop + remaining));
      // 捲不動就不要記帳（已經頂在底部／頂部時 next 就等於現值）：那一筆帳等不到 scroll 事件來
      // 消耗，會留到使用者下一次真實捲動被當成程式化捲動而不廣播，房裡其他人看到他的游標卡一拍。
      if (next !== root.scrollTop) expectedScrollTop.set(root, next);
    }
    window.scrollBy({ top: remaining, left: 0, behavior: "instant" });
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

/** 鏡像鎖定的跨封包記憶：只放死區需要的「上一次殘差方向」。 */
export interface MirrorLockState {
  /** 上一次量到的殘差方向：+1 / -1 / 0（0＝在死區內）。 */
  lastSign: number;
}

export const createMirrorLockState = (): MirrorLockState => ({ lastSign: 0 });

/**
 * 死區判定：這一次的殘差該不該真的動手修。
 * 不帶 state（例如單元測試逐次呼叫）時退化成單純的 epsilon 門檻。
 */
function shouldCorrect(delta: number, state: MirrorLockState | undefined): boolean {
  const abs = Math.abs(delta);
  if (abs < MIRROR_LOCK_EPSILON_PX) {
    if (state) state.lastSign = 0;
    return false;
  }
  const sign = delta > 0 ? 1 : -1;
  if (!state) return true;
  if (abs >= MIRROR_LOCK_SNAP_PX) {
    state.lastSign = sign;
    return true;
  }
  // 小幅殘差在 subpixel 佈局上會每個封包正負來回；追它只是把抖動忠實重現在跟隨端。
  // 要求連續兩次同號：抖動自然被濾掉，真正的緩慢漂移則會在下一個封包補上。
  const ok = state.lastSign === sign;
  state.lastSign = sign;
  return ok;
}

export function applyMirrorViewportLock(
  c: Pick<CollabCursor, "x" | "y" | "anchor" | "ax" | "ay" | "vy" | "ci"> & { vx?: number },
  container: Element | null | undefined,
  state?: MirrorLockState,
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

  const deltaY = point.y - targetClientY;
  let movedAny = false;
  // 垂直有沒有動過要與水平分開記。下面的殘差回合只修垂直，若它被「水平捲了一下」點亮，
  // 上面因為死區刻意不修的垂直殘差就會在殘差回合被純 epsilon 修掉——只要對方的游標停在
  // 任何一個橫向可捲的容器裡，死區等於沒加，subpixel 抖動照樣忠實重現在跟隨端。
  let movedVertical = false;

  if (shouldCorrect(deltaY, state)) {
    const applied = applyScrollDeltaY(el, deltaY);
    if (Math.abs(applied) >= 0.5) {
      movedAny = true;
      movedVertical = true;
    }
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
              // 捲得動才寫（與 applyScrollDeltaY 的 `if (moved !== 0)` 同一條規則）：
              // 已經頂在兩端時 scrollElementTo 會留下一筆等不到 scroll 事件的死帳。
              if (next !== before) {
                scrollElementTo(node, "left", next);
                rem -= next - before;
                movedAny = true;
              }
            }
          }
          node = node.parentElement;
        }
        if (Math.abs(rem) >= 0.5) {
          const root = document.scrollingElement;
          // 本站 html 是 overflow-x:clip（styles.css:216），根元素橫向根本捲不動，這條退路
          // 幾乎每個封包都會走到卻什麼都沒捲。無條件記帳等於每個封包在 <html> 上留一筆死帳，
          // 之後（包含退出鏡像後）使用者的第一次捲動就被誤判成程式化捲動而不廣播。
          if (root) {
            const max = Math.max(0, root.scrollWidth - root.clientWidth);
            const next = Math.min(max, Math.max(0, root.scrollLeft + rem));
            if (next !== root.scrollLeft) {
              expectedScrollLeft.set(root, next);
              movedAny = true;
            }
          }
          window.scrollBy({ left: rem, top: 0, behavior: "instant" });
        }
      }
    }
  }

  // 殘差校正：捲動已改成 scrollTo({behavior:"instant"})、且鏡像期間 html.collab-mirroring
  // 也把 scroll-behavior:smooth 關掉了，這裡重量 rect 才量得到「捲完之後」的真值。
  //
  // 只有**垂直**真的捲過（或展開過 details 而改變了版面）才重量：
  // 若上面因為死區刻意不修，這裡再修一次等於把死區整個繞過去，抖動照舊。
  // （展開 details 是例外——版面整個跳掉，死區當時是拿過期的量測做的判斷，重量才對。）
  const residualPasses = expanded ? 2 : movedVertical ? 1 : 0;
  for (let i = 0; i < residualPasses; i += 1) {
    const p = cursorViewportPoint(c, container);
    if (!p) break;
    const residual = p.y - targetClientY;
    if (Math.abs(residual) < MIRROR_LOCK_EPSILON_PX) break;
    const applied = applyScrollDeltaY(el, residual);
    if (Math.abs(applied) < 0.5) break;
    movedAny = true;
    // 殘差回合也是一次「往這個方向修」：不記下來的話，下一個封包的同號判定會拿修正前的
    // 舊方向去比，死區的兩次確認就建立在過期資訊上。
    if (state) state.lastSign = residual > 0 ? 1 : -1;
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
  /** 錨點（`#scene-<id>` 等）→ 最後停在那裡的人。給「誰在改這一格」用，純 client 端聚合。 */
  anchorPeers: Map<string, CollabAnchorPeer[]>;
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
  /**
   * 每人最後一則帶錨點的 cursor。放 ref 不放 state：cursor 封包最高約 30Hz，
   * 每一則都 setState 會讓整份分鏡列跟著封包率重繪。真正需要重畫的時機由 anchorEpoch 決定。
   */
  const anchorSeenRef = useRef<Map<string, CollabAnchorSighting>>(new Map());
  const anchorSigRef = useRef("");
  const [anchorEpoch, setAnchorEpoch] = useState(0);
  /** 只有「分組結果會變」才重畫：換格、轉半透明、逾時消失都算，在同一格裡動滑鼠不算。 */
  const syncAnchorEpoch = useCallback(() => {
    const sig = anchorSignature(anchorSeenRef.current, Date.now());
    if (sig === anchorSigRef.current) return;
    anchorSigRef.current = sig;
    setAnchorEpoch((n) => n + 1);
  }, []);

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
          // 「誰在改這一格」走的是這條、不是上面的 cursors：cursors 4 秒就過期，
          // 而人停手想事情本來就會超過 4 秒。anchor 為空＝他的游標已經不在任何可辨識的
          // 元素上，這時要收掉指示——留著一個過時的格子比沒有指示更會誤導人。
          if (entry.anchor) anchorSeenRef.current.set(msg.userId, { anchor: entry.anchor, ts: entry.ts });
          else anchorSeenRef.current.delete(msg.userId);
          syncAnchorEpoch();
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
        anchorSeenRef.current = new Map();
        syncAnchorEpoch();
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
  }, [id, enabled, kind, syncAnchorEpoch]);

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

  // 格級指示的兩段淡出得自己走時鐘：最後一則 cursor 之後可能再也沒有封包進來，
  // 少了這個掃描，「10 秒轉半透明、60 秒移除」就永遠不會發生（指示會一直亮著）。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const [userId, sighting] of anchorSeenRef.current) {
        if (anchorSightingState(now - sighting.ts) === "gone") anchorSeenRef.current.delete(userId);
      }
      syncAnchorEpoch();
    }, 1000);
    return () => clearInterval(timer);
  }, [syncAnchorEpoch]);

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
    const onScroll = (ev: Event) => {
      // 鏡像跟隨自己捲出來的事件不能再廣播出去（見 consumeProgrammaticScroll）：
      // 否則被動看的人會在全房畫面上出現「正在編輯」指示框，兩人互跟更會互相牽引到不收斂。
      if (shouldSkipCollabScrollBroadcast(ev)) return;
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

  // anchorSeenRef 是 ref，改動不會觸發重算——anchorEpoch 就是它的「內容變了」訊號，
  // 故意列進依賴（拿掉它畫面會停在第一次算出來的分組上）。
  const anchorPeers = useMemo(
    () => groupPeersByAnchor(anchorSeenRef.current, peers, Date.now()),
    [peers, anchorEpoch],
  );

  return { peers, cursors, cursorsLiveRef, focusZones, anchorPeers, self, sendFocus, containerRef, onPointerMove, connected };
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

export function anchorSightingState(ageMs: number): "live" | "stale" | "gone" {
  if (ageMs > ANCHOR_DROP_MS) return "gone";
  return ageMs > ANCHOR_FADE_MS ? "stale" : "live";
}

/**
 * 把「每人最後一則 cursor 的錨點」依錨點分組——「誰在改這一格」的資料來源。
 *
 * 與 peers 做 join 而不是自己記誰離線：離房唯一的真相是 presence 名單，
 * 兩邊各記一份，遲早會出現「人早就走了、格子上還掛著他的名字」。
 */
export function groupPeersByAnchor(
  seen: Map<string, CollabAnchorSighting>,
  peers: CollabPeer[],
  now: number,
): Map<string, CollabAnchorPeer[]> {
  const out = new Map<string, CollabAnchorPeer[]>();
  for (const [userId, sighting] of seen) {
    const state = anchorSightingState(now - sighting.ts);
    if (state === "gone") continue;
    const peer = peers.find((p) => p.userId === userId);
    if (!peer) continue;
    const entry: CollabAnchorPeer = { ...peer, stale: state === "stale" };
    const list = out.get(sighting.anchor);
    if (list) list.push(entry);
    else out.set(sighting.anchor, [entry]);
  }
  return out;
}

/**
 * 分組結果的指紋：只有它變了才值得重畫。
 * cursor 封包最高約 30Hz，若每一則都 setState，整份分鏡列會跟著封包率重繪——
 * 而使用者在同一格裡移動滑鼠時，畫面上該顯示的東西一個字都沒變。
 */
export function anchorSignature(seen: Map<string, CollabAnchorSighting>, now: number): string {
  return [...seen.entries()]
    .map(([userId, s]) => `${userId}|${s.anchor}|${anchorSightingState(now - s.ts)}`)
    .sort()
    .join(",");
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
  const lockStateRef = useRef<MirrorLockState>(createMirrorLockState());
  const leadEmaRef = useRef(MIRROR_PREDICT_LEAD_INIT_MS);
  const mapCursors = (src: typeof cursors): Map<string, CollabCursor> => {
    if (src && typeof src === "object" && "current" in src) {
      return src.current ?? new Map();
    }
    return src as Map<string, CollabCursor>;
  };

  // 鏡像期間才關掉平滑捲動與 .gen-row 的 content-visibility（見 styles.css 的 html.collab-mirroring）。
  // 這個 class 殘留的代價很高——會**永久**停用全站的平滑捲動與離屏繪製最佳化，
  // 所以卸除交給 useEffect 的 cleanup：切換模式、跟隨對象離線／離房（followUserId 變 null）、
  // 元件卸載全都會走到它。
  // 「跟隨對象不在 peers 裡就把 followUserId 歸零」這條規則必須跟這支 hook 掛在同一層（ProjectPage），
  // 不能只放在 CollabModeBar：那顆 bar 在手機收合在場面板時會整個卸載，對象離線時沒人歸零，
  // class 就留在 <html> 上到離開頁面為止，而且使用者連取消鏡像的入口都被收起來了。
  useEffect(() => {
    if (mode !== "mirror" || !followUserId) return;
    const root = document.documentElement;
    root.classList.add(COLLAB_MIRRORING_CLASS);
    return () => root.classList.remove(COLLAB_MIRRORING_CLASS);
  }, [mode, followUserId]);

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
    if (!el) return;
    ensureAnchorExpanded(el);
    const r = el.getBoundingClientRect();
    // 隱藏中的 zone（定裝／知識庫都包在 display:none 的定調子分頁裡）rect 全 0，
    // 照它算捲動量會把跟隨端捲到莫名其妙的位置。
    if (r.width <= 0 && r.height <= 0) return;
    // 不用 el.scrollIntoView()：那是這支 hook 裡唯一不會記進「預期位置」帳本的程式化捲動，
    // 它捲出來的 scroll 事件會被 useCollab 當成使用者操作廣播出去——只是在旁邊看的人
    // 於是在全房畫面上變成「正在這裡」，兩人互跟還會開始互相牽引。走 applyScrollDeltaY 才有記帳。
    const vh = window.innerHeight || 1;
    // block:"nearest" 的語意是「已經看得到就不動」，這裡照樣保留
    if (r.bottom > 0 && r.top < vh) return;
    applyScrollDeltaY(el, r.top + r.height / 2 - vh * 0.42);
  }, [mode, followUserId, focusZones, cursors]);

  useEffect(() => {
    if (mode !== "mirror" || !followUserId) return;
    let raf = 0;
    let lastCursorTs = 0;
    let lastScrollAt = 0;
    prevSampleRef.current = null;
    // 換人跟／重新進入鏡像＝換一組節奏與版面，上一位留下的間隔與殘差方向都不能沿用。
    lockStateRef.current = createMirrorLockState();
    leadEmaRef.current = MIRROR_PREDICT_LEAD_INIT_MS;
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
      // 前導時間取實測封包間隔：發送端節流、對端網路狀況都會讓真實間隔跟常數對不上，
      // 而預測要補的正是「下一個封包到達前的這段空窗」。先吃進這一筆再用，才是最新的估計。
      const prevSample = prevSampleRef.current;
      if (prevSample) leadEmaRef.current = updatePacketIntervalEma(leadEmaRef.current, sample.t - prevSample.t);
      const pred = extrapolateCursorPose(prevSample, sample, leadEmaRef.current);
      prevSampleRef.current = sample;
      const predicted: CollabCursor = {
        ...cur,
        ax: pred.ax,
        ay: pred.ay,
        vy: pred.vy,
        vx: pred.vx,
      };

      const ok = applyMirrorViewportLock(predicted, containerRefStable?.current ?? null, lockStateRef.current);
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
        // 隱藏中的 zone rect 全 0（定調的子分頁用 display:none 切換），據此算出來的
        // delta 是 -0.42*vh，會把跟隨端往上捲一段莫名其妙的距離。
        if (r.width <= 0 && r.height <= 0) return;
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
      {/* sticky 而非 absolute：分鏡 zone 從 SceneList 一路包到交付中心，標籤釘在 zone 最上緣時
          捲到第 7 格就已經出視窗，畫面上只剩兩側 2px 內陰影——等於沒有訊號。
          三個刻意的細節：
          1. 高度 0 ＋ alignItems:flex-start——標籤浮在內容上、不佔版面高度
             （0 高的 flex 容器用預設 stretch 會把標籤壓成 0 高看不見）。
          2. 沒人在這裡時也照樣渲染這個空容器：它是 in-flow 的第一個子元素，會擋掉
             首個子元素 margin 的向上合併；只在有人時才插進來的話，別人進出這個區塊
             整塊內容就會上下跳一下。
          3. top 用與站內其他 sticky 元素同一個 --topbar-sticky-offset，否則會滑到常駐頂欄底下。 */}
      <div
        aria-hidden
        style={{
          position: "sticky",
          top: "calc(var(--topbar-sticky-offset) + var(--sp-8))",
          zIndex: 30,
          height: 0,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          pointerEvents: "none",
        }}
      >
        {first && (
          <span
            style={{
              position: "relative",
              top: 4,
              right: 8,
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
      </div>
      {children}
    </div>
  );
}
