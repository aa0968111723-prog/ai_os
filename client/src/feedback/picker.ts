import html2canvas from "html2canvas";

/**
 * 元件級回饋的選取與截圖工具（任務 D）。
 * 所有屬於回饋 widget 自身的節點都帶 data-fb-widget，選取與截圖都用它來排除，
 * 避免使用者選到浮動鈕、或截圖把面板拍進去。
 */

export interface PickResult {
  targetLabel: string;
  targetSelector: string;
  /**
   * x/y/w/h＝點選當下的 viewport 座標（截圖描框用，同一瞬間必準）；vw/vh＝當時視窗尺寸。
   * rx/ry/rw/rh＝相對最近 [data-fb] 卡片的比例（0..1）——viewport 座標換一台裝置/視窗就對不上
   * （回饋 #5 的「位置不精準」），之後要在別的螢幕重播標記框時，用「同名卡片＋比例」重新解析才準。
   */
  targetRect: { x: number; y: number; w: number; h: number; vw: number; vh: number; rx?: number; ry?: number; rw?: number; rh?: number };
}

const WIDGET_ATTR = "data-fb-widget";
const PRIMARY = "#c2613f";
const MAX_LABEL = 24;

/** 該元素是否屬於回饋 widget 自身（浮動鈕、面板、選取用的 overlay 與高亮框） */
function isOwnWidget(el: Element | null): boolean {
  return !!el && !!el.closest(`[${WIDGET_ATTR}]`);
}

/** 收斂空白並截到 MAX_LABEL 字（超過補「…」） */
function clip(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length > MAX_LABEL ? t.slice(0, MAX_LABEL) + "…" : t;
}

/** 元素的可見文字（葉節點語意）；回饋 widget 自身節點不算 */
function visibleText(el: Element): string {
  if (isOwnWidget(el)) return "";
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

/** 中文化的元素類型（都認不出身分時的最後退路，取代裸 tagName） */
function zhTypeOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  if (tag === "button" || role === "button" || tag === "summary") return "按鈕";
  if (tag === "a") return "連結";
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "checkbox" || type === "radio") return "選項";
    if (type === "button" || type === "submit") return "按鈕";
    return "輸入框";
  }
  if (tag === "textarea") return "輸入框";
  if (tag === "select") return "選單";
  if (tag === "img") return "圖片";
  return "區塊";
}

/** 表單控制項自己的標籤：placeholder → 關聯 <label>（htmlFor/id 或包裹）→ aria-label → name */
function controlLabel(el: Element): string | null {
  const ph = el.getAttribute("placeholder");
  if (ph && ph.trim()) return clip(ph);
  const id = el.getAttribute("id");
  if (id) {
    let assoc: Element | null = null;
    try {
      assoc = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    } catch {
      assoc = null;
    }
    const t = assoc ? visibleText(assoc) : "";
    if (t) return clip(t);
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const t = visibleText(wrapping);
    if (t) return clip(t);
  }
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return clip(aria);
  const name = el.getAttribute("name");
  if (name && name.trim()) return clip(name);
  return null;
}

/**
 * 精準標籤：以「元素自己的身分」為準（而非所在大卡）。依序：
 * 可點祖先(button/a/[role=button])的可見文字 → 表單控制項 → img alt →
 * label/標題文字 → title 屬性。都認不出回 null（交給區域名或中文化類型）。
 */
function preciseLabel(el: Element): string | null {
  const clickable = el.closest("button, a, [role='button'], summary");
  if (clickable && !isOwnWidget(clickable)) {
    const t = visibleText(clickable);
    if (t) return clip(t);
    const aria = clickable.getAttribute("aria-label");
    if (aria && aria.trim()) return clip(aria);
    const title = clickable.getAttribute("title");
    if (title && title.trim()) return clip(title);
  }

  const control = el.closest("input, textarea, select");
  if (control) {
    const l = controlLabel(control);
    if (l) return l;
  }

  const img = el.closest("img");
  if (img) {
    const alt = img.getAttribute("alt");
    if (alt && alt.trim()) return clip(alt);
  }

  const labelish = el.closest("label, h1, h2, h3, h4, h5, h6");
  if (labelish && !isOwnWidget(labelish)) {
    const t = visibleText(labelish);
    if (t) return clip(t);
  }

  const titled = el.closest("[title]");
  if (titled) {
    const title = titled.getAttribute("title");
    if (title && title.trim()) return clip(title);
  }

  return null;
}

/** 最近的 [data-fb] 祖先名，作為「所在區域」脈絡 */
function regionLabel(el: Element): string | null {
  const fb = el.closest("[data-fb]")?.getAttribute("data-fb");
  return fb && fb.trim() ? fb.trim() : null;
}

/**
 * 被點元素的可讀標籤（含區域脈絡）。
 * 精準標籤優先呈現「元素自己是什麼」；若所在 [data-fb] 區域與精準標籤不同，
 * 合成「區域 · 精準標籤」（如「世界觀卡 · 一句話故事」）。
 * 認不出精準身分時退回區域名，再退回中文化的元素類型。
 */
export function readableLabel(el: Element): string {
  const precise = preciseLabel(el);
  const region = regionLabel(el);
  if (precise) {
    return region && region !== precise ? `${region} · ${precise}` : precise;
  }
  return region ?? zhTypeOf(el);
}

/**
 * 讓標記更有意義：純文字節點或很小的元素，改選它最近的「互動/具名」祖先，
 * 使高亮框與標籤貼合一個真正有身分的目標，而不是半個字或一顆小圖示。
 * 找不到合適祖先就維持原元素。
 */
export function refineTarget(el: Element): Element {
  // 元素自己就是主要的互動/媒體節點時，直接用它
  if (el.matches("button, a, input, textarea, select, img, [role='button']")) return el;
  const rect = el.getBoundingClientRect();
  const tiny = rect.width < 24 || rect.height < 16;
  const textLeaf = el.childElementCount === 0 && !!(el.textContent || "").trim();
  if (tiny || textLeaf) {
    const meaningful = el.closest("button, a, input, textarea, select, [role='button'], label, summary");
    if (meaningful && !isOwnWidget(meaningful)) return meaningful;
  }
  return el;
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
 * 進入選取模式：全螢幕透明 overlay 攔指標事件，用 elementFromPoint 找指標下元素，
 * 畫外框高亮＋浮動小標籤。滑鼠：移動預覽、點擊選取；觸控：拖曳瞄準、放開選取（Pointer Events 一套涵蓋）。
 * Esc、右鍵或點提示列→onCancel。回傳 stop 函式（呼叫即退出）。
 */
export function pickElement(onPick: (r: PickResult) => void, onCancel: () => void): () => void {
  const overlay = document.createElement("div");
  overlay.setAttribute(WIDGET_ATTR, "picker-overlay");
  // touch-action:none：觸控拖曳是「瞄準」不是捲動，交給 pointermove；不設的話手機一拖就整頁捲動、根本選不到
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;cursor:crosshair;background:rgba(43,38,32,0.04);touch-action:none;";

  const box = document.createElement("div");
  box.setAttribute(WIDGET_ATTR, "picker-box");
  box.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483001;border:2px solid var(--primary);" +
    "border-radius:6px;background:rgba(194,97,63,0.08);display:none;box-shadow:0 0 0 3px rgba(194,97,63,0.15);transition:all 60ms ease;";

  const tag = document.createElement("div");
  tag.setAttribute(WIDGET_ATTR, "picker-tag");
  tag.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483002;background:var(--primary);color:var(--primary-fg);" +
    "font:600 12px/1.4 var(--sans);padding:3px 9px;border-radius:8px;" +
    "max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none;" +
    "box-shadow:0 4px 14px -6px rgba(86,66,42,0.5);";

  const hint = document.createElement("div");
  hint.setAttribute(WIDGET_ATTR, "picker-hint");
  // 手機沒有 Esc 也沒有右鍵——提示列本身就是取消鈕（pointer-events:auto＋自己的 click）
  hint.textContent = "點一下要標記的地方（手機可拖曳瞄準）· Esc / 右鍵 / 點此取消";
  hint.style.cssText =
    "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483002;" +
    "background:rgba(43,38,32,0.86);color:#fbf7f0;font:600 13px/1.4 var(--sans);" +
    "padding:7px 16px;border-radius:999px;pointer-events:auto;cursor:pointer;max-width:92vw;text-align:center;";

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
    // 純文字/很小的節點→貼到最近的互動或具名祖先，讓標記與高亮更有意義
    return refineTarget(el);
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

  /** 選定元素 → 組 PickResult（viewport 座標＋最近 [data-fb] 卡片的相對比例）→ 收尾回報 */
  function finish(el: Element) {
    const r = el.getBoundingClientRect();
    const rect: PickResult["targetRect"] = {
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
    // 相對定位補充：viewport 座標換台裝置就不準，補存「卡內比例」讓日後能在不同螢幕重解析
    const anchorEl = el.closest("[data-fb]");
    if (anchorEl) {
      const a = anchorEl.getBoundingClientRect();
      if (a.width > 0 && a.height > 0) {
        rect.rx = (r.left - a.left) / a.width;
        rect.ry = (r.top - a.top) / a.height;
        rect.rw = r.width / a.width;
        rect.rh = r.height / a.height;
      }
    }
    stop();
    onPick({ targetLabel: readableLabel(el), targetSelector: selectorOf(el), targetRect: rect });
  }

  // Pointer Events 一套涵蓋滑鼠與觸控：滑鼠移動＝預覽；觸控拖曳＝瞄準（touch-action:none 已擋捲動）
  let lastPointerType = "mouse";
  const onMove = (e: PointerEvent) => {
    lastPointerType = e.pointerType || "mouse";
    paint(elementUnder(e.clientX, e.clientY));
  };
  // 觸控「拖曳瞄準後放開」不會產生 click（有位移）——pointerup 是觸控唯一可靠的選取路徑；
  // 滑鼠仍走 click（維持原互動：按下不選、放開才算一次點擊）
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    const el = elementUnder(e.clientX, e.clientY) || current;
    if (!el) return;
    finish(el);
  };
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = current || elementUnder(e.clientX, e.clientY);
    if (!el) return;
    finish(el);
  };
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    // Android 長按（觸控瞄準時容易誤觸發）也會走到這——觸控的取消交給提示列，只有滑鼠右鍵才取消
    if (lastPointerType !== "mouse") return;
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
  const onHintTap = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    stop();
    onCancel();
  };

  overlay.addEventListener("pointermove", onMove);
  overlay.addEventListener("pointerup", onPointerUp);
  overlay.addEventListener("click", onClick);
  overlay.addEventListener("contextmenu", onContext);
  hint.addEventListener("click", onHintTap);
  window.addEventListener("keydown", onKey, true);

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    overlay.removeEventListener("pointermove", onMove);
    overlay.removeEventListener("pointerup", onPointerUp);
    overlay.removeEventListener("click", onClick);
    overlay.removeEventListener("contextmenu", onContext);
    hint.removeEventListener("click", onHintTap);
    window.removeEventListener("keydown", onKey, true);
    for (const node of [box, tag, hint]) node.remove();
    // 觸控 pointerup 選取後，瀏覽器接著會在同一點合成 click——若立刻移除 overlay，
    // 這記 click 會落在底下的真按鈕上（誤觸刪除鈕等）。留一層透明 overlay 吞掉它再移除。
    overlay.style.background = "transparent";
    overlay.style.cursor = "";
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    overlay.addEventListener("click", swallow, true);
    setTimeout(() => overlay.remove(), 350);
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
    // 高亮框改用「真的畫在 DOM 上的元素」讓 html2canvas 在同一次繪製中連同頁面一起拍進去，
    // 而不是事後用 canvas 座標 strokeRect——後者座標假設(rect*scale)與 html2canvas 內部對 scroll/
    // devicePixelRatio/裁切 的映射不一致，框會跟元件錯位（使用者回報的「偏移」）。
    // 用 position:absolute + 文件座標(rect + scroll)：與被標元件同一座標系，html2canvas 對絕對定位元素
    // 的渲染最穩，框與元件必定對齊（就算 html2canvas 整體有偏移，框與內容也一起偏、相對位置不變）。
    let marker: HTMLDivElement | null = null;
    if (rect) {
      marker = document.createElement("div");
      marker.setAttribute("data-fb-shot-marker", "1"); // 不用 WIDGET_ATTR：這個要被拍進去，不能被 ignoreElements 排除
      marker.style.cssText =
        `position:absolute;left:${rect.x + window.scrollX}px;top:${rect.y + window.scrollY}px;` +
        `width:${rect.w}px;height:${rect.h}px;border:3px solid ${PRIMARY};border-radius:6px;` +
        "box-sizing:border-box;pointer-events:none;z-index:2147482000;" +
        "box-shadow:0 0 0 3px rgba(194,97,63,0.25);";
      document.body.appendChild(marker);
    }
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
      return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
    } catch {
      return null;
    } finally {
      if (marker) marker.remove();
    }
  })();

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
  return Promise.race([run, timeout]);
}
