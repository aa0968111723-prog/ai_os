/**
 * 夥伴的 caret 疊層（Story 共編；驗收場景 5 的「Bruce caret 韋澔 caret 不同顏色」）。
 *
 * Textarea 畫不了別人的游標，所以用鏡像量測：一個隱藏的 div 完整複製 textarea 的
 * 字型／寬度／換行行為，把「index 之前的文字＋一個量測 span」塞進去，
 * span 的 offsetTop/Left 就是 caret 在內容座標系的位置；再扣掉 textarea 的
 * scrollTop/Left、加上它在畫面上的 rect，得到 fixed 定位。
 *
 * 名字與顏色來自 /ws-doc awareness——伺服器端蓋章的同一套 userId/name/8 色盤
 * （collabDoc.colorFor 與 /ws 完全同一個雜湊），**不另起一套顏色與名字**。
 * 超出可視範圍（捲走了）就不畫；量測失敗就整個不畫——畫錯位置的 caret 比沒有更糟。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { YPeer } from "./useStoryYDoc";

/** 鏡像要複製的樣式屬性——少一項就可能在特定字型／縮放下量歪 */
const MIRROR_PROPS = [
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "boxSizing", "textIndent", "wordBreak", "overflowWrap", "tabSize",
] as const;

interface CaretPos {
  userId: string;
  name: string;
  color: string;
  left: number;
  top: number;
  height: number;
}

export function RemoteCarets({
  textareaRef,
  peers,
  value,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  peers: Map<string, YPeer>;
  /** 目前的全文——caret index 是相對它的 */
  value: string;
}) {
  const [positions, setPositions] = useState<CaretPos[]>([]);
  const mirrorRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    const el = textareaRef.current;
    if (!el || peers.size === 0) {
      setPositions([]);
      return;
    }
    // 鏡像 div 懶建立、掛在 body（display 隱藏但可量測）
    let mirror = mirrorRef.current;
    if (!mirror) {
      mirror = document.createElement("div");
      mirror.setAttribute("aria-hidden", "true");
      mirror.style.position = "fixed";
      mirror.style.visibility = "hidden";
      mirror.style.top = "-9999px";
      mirror.style.left = "0";
      mirror.style.whiteSpace = "pre-wrap";
      mirror.style.pointerEvents = "none";
      document.body.appendChild(mirror);
      mirrorRef.current = mirror;
    }
    const cs = getComputedStyle(el);
    for (const prop of MIRROR_PROPS) mirror.style[prop as "fontFamily"] = cs[prop as "fontFamily"];
    // 內容寬要一致，換行點才會一致
    mirror.style.width = `${el.clientWidth}px`;

    const rect = el.getBoundingClientRect();
    const lineHeight = Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.4 || 20;
    const out: CaretPos[] = [];
    for (const peer of peers.values()) {
      if (peer.cursor == null) continue;
      const index = Math.min(Math.max(0, peer.cursor), value.length);
      // 鏡像內容：index 之前的文字＋量測 span。textContent 賦值不經 HTML 解析，無注入面。
      mirror.textContent = "";
      const before = document.createElement("span");
      before.textContent = value.slice(0, index);
      const marker = document.createElement("span");
      marker.textContent = "​";
      mirror.append(before, marker);

      const top = marker.offsetTop - el.scrollTop + rect.top;
      const left = marker.offsetLeft - el.scrollLeft + rect.left;
      // 捲出可視範圍就不畫（上緣留半行緩衝）
      if (top < rect.top - lineHeight / 2 || top > rect.bottom - lineHeight / 2) continue;
      if (left < rect.left - 4 || left > rect.right + 4) continue;
      out.push({ userId: peer.userId, name: peer.name, color: peer.color, left, top, height: lineHeight });
    }
    setPositions(out);
  }, [peers, textareaRef, value]);

  useEffect(() => {
    measure();
    const el = textareaRef.current;
    if (!el) return;
    // 捲動／視窗變化都要重量；peers 與 value 變化由依賴觸發
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true, capture: true });
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, textareaRef]);

  // 卸載時清掉鏡像 div
  useEffect(() => () => {
    mirrorRef.current?.remove();
    mirrorRef.current = null;
  }, []);

  if (positions.length === 0) return null;
  return (
    <>
      {positions.map((p) => (
        <div
          key={p.userId}
          data-testid="remote-caret"
          style={{ position: "fixed", left: p.left, top: p.top, zIndex: 40, pointerEvents: "none" }}
        >
          {/* caret 本體：2px 直線，用夥伴的既有色票 */}
          <div style={{ width: 2, height: p.height, background: p.color, borderRadius: 1 }} />
          {/* 名牌：掛在 caret 上方，小到不擋字 */}
          <div
            style={{
              position: "absolute",
              top: -16,
              left: 0,
              fontSize: 10,
              lineHeight: "14px",
              padding: "0 4px",
              borderRadius: 3,
              whiteSpace: "nowrap",
              color: "#fff",
              background: p.color,
            }}
          >
            {p.name}
          </div>
        </div>
      ))}
    </>
  );
}
