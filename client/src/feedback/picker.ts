import html2canvas from "html2canvas";

/**
 * 元件級回饋的選取與截圖工具（任務 D）。
 * 所有屬於回饋 widget 自身的節點都帶 data-fb-widget，選取與截圖都用它來排除，
 * 避免使用者選到浮動鈕、或截圖把面板拍進去。
 */

export interface PickResult {
  targetLabel: string;
  targetSelector: string;
  targetRect: { x: number; y: number; w: number; h: number; vw: number; vh: number };
}

const WIDGET_ATTR = "data-fb-widget";
const PRIMARY = "#c2613f";

/** 該元素是否屬於回饋 widget 自身（浮動鈕、面板、選取用的 overlay 與高亮框） */
function isOwnWidget(el: Element | null): boolean {
  return !!el && !!el.closest(`[${WIDGET_ATTR}]`);
}

/** 被點元素的可讀標籤：data-fb → aria-label → button/a 文字(≤24) → tagName */
export function readableLabel(el: Element): string {
  const fb = el.closest("[data-fb]")?.getAttribute("data-fb");
  if (fb && fb.trim()) return fb.trim();
  const aria = el.closest("[aria-label]")?.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  const clickable = el.closest("button, a");
  if (clickable) {
    const text = (clickable.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return text.length > 24 ? text.slice(0, 24) + "…" : text;
  }
  return el.tagName.toLowerCase();
}

/** 定位字串：優先 data-fb，其次一段簡易 DOM 路徑（供人日後對照，不保證唯一） */
export function selectorOf(el: Element): string {
  const fb = el.closest("[data-fb]")?.getAttribute("data-fb");
  if (fb && fb.trim()) return `[data-fb="${fb.trim()}"]`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 5) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${part}#${node.id}`);
      break;
    }
    const cls =
      typeof node.className === "string" && node.className.trim()
        ? "." + node.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
    part += cls;
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

/**
 * 進入選取模式：全螢幕透明 overlay 攔滑鼠，用 elementFromPoint 找游標下元素，
 * 畫外框高亮＋浮動小標籤。點擊→onPick；Esc 或右鍵→onCancel。回傳 stop 函式（呼叫即退出）。
 */
export function pickElement(onPick: (r: PickResult) => void, onCancel: () => void): () => void {
  const overlay = document.createElement("div");
  overlay.setAttribute(WIDGET_ATTR, "picker-overlay");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;cursor:crosshair;background:rgba(43,38,32,0.04);";

  const box = document.createElement("div");
  box.setAttribute(WIDGET_ATTR, "picker-box");
  box.style.cssText =
    `position:fixed;pointer-events:none;z-index:2147483001;border:2px solid ${PRIMARY};` +
    "border-radius:6px;background:rgba(194,97,63,0.08);display:none;box-shadow:0 0 0 3px rgba(194,97,63,0.15);transition:all 60ms ease;";

  const tag = document.createElement("div");
  tag.setAttribute(WIDGET_ATTR, "picker-tag");
  tag.style.cssText =
    `position:fixed;pointer-events:none;z-index:2147483002;background:${PRIMARY};color:#fff7f1;` +
    "font:600 12px/1.4 system-ui,'Noto Sans TC',sans-serif;padding:3px 9px;border-radius:8px;" +
    "max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none;" +
    "box-shadow:0 4px 14px -6px rgba(86,66,42,0.5);";

  const hint = document.createElement("div");
  hint.setAttribute(WIDGET_ATTR, "picker-hint");
  hint.textContent = "點一下要標記的地方 · Esc 或右鍵取消";
  hint.style.cssText =
    "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483002;" +
    "background:rgba(43,38,32,0.86);color:#fbf7f0;font:600 13px/1.4 system-ui,'Noto Sans TC',sans-serif;" +
    "padding:7px 16px;border-radius:999px;pointer-events:none;";

  document.body.appendChild(overlay);
  document.body.appendChild(box);
  document.body.appendChild(tag);
  document.body.appendChild(hint);

  let current: Element | null = null;

  // overlay 蓋在最上層會攔住 elementFromPoint，先暫時讓它穿透再問一次游標下的真元素
  function elementUnder(x: number, y: number): Element | null {
    overlay.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    overlay.style.pointerEvents = "auto";
    if (!el || isOwnWidget(el) || el === document.documentElement || el === document.body) return null;
    return el;
  }

  function paint(el: Element | null) {
    current = el;
    if (!el) {
      box.style.display = "none";
      tag.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    tag.textContent = readableLabel(el);
    tag.style.display = "block";
    // 標籤放框上緣，貼近頂端時改放框內
    const above = r.top > 26;
    tag.style.left = Math.max(6, r.left) + "px";
    tag.style.top = (above ? r.top - 24 : r.top + 4) + "px";
  }

  const onMove = (e: MouseEvent) => paint(elementUnder(e.clientX, e.clientY));
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = current || elementUnder(e.clientX, e.clientY);
    if (!el) return;
    const r = el.getBoundingClientRect();
    stop();
    onPick({
      targetLabel: readableLabel(el),
      targetSelector: selectorOf(el),
      targetRect: {
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        vw: window.innerWidth,
        vh: window.innerHeight,
      },
    });
  };
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    stop();
    onCancel();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      stop();
      onCancel();
    }
  };

  overlay.addEventListener("mousemove", onMove);
  overlay.addEventListener("click", onClick);
  overlay.addEventListener("contextmenu", onContext);
  window.addEventListener("keydown", onKey, true);

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    overlay.removeEventListener("mousemove", onMove);
    overlay.removeEventListener("click", onClick);
    overlay.removeEventListener("contextmenu", onContext);
    window.removeEventListener("keydown", onKey, true);
    for (const node of [overlay, box, tag, hint]) node.remove();
  }

  return stop;
}

/** 頁面底色（截圖背景用），讀不到就回黏土主題底色 */
function pageBackground(): string {
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  if (bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" && bodyBg !== "transparent") return bodyBg;
  return "#f4eee4";
}

/**
 * 擷取目前可視區為 PNG Blob（scale 0.7）。有 rect 就在畫布上描一個主色框標出被回報的元件。
 * 失敗或逾時 8 秒都回 null——截圖是可選的，絕不擋住送出流程。widget 自身節點一律不入鏡。
 */
export function captureWithHighlight(
  rect?: { x: number; y: number; w: number; h: number } | null,
): Promise<Blob | null> {
  const SCALE = 0.7;
  const run = (async (): Promise<Blob | null> => {
    try {
      const canvas = await html2canvas(document.body, {
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        scale: SCALE,
        backgroundColor: pageBackground(),
        useCORS: true,
        logging: false,
        ignoreElements: (el) => el.hasAttribute(WIDGET_ATTR),
      });
      if (rect) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.strokeStyle = PRIMARY;
          ctx.lineWidth = 3;
          ctx.strokeRect(rect.x * SCALE, rect.y * SCALE, rect.w * SCALE, rect.h * SCALE);
        }
      }
      return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
    } catch {
      return null;
    }
  })();

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
  return Promise.race([run, timeout]);
}
