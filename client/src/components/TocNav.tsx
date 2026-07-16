import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * 章節導覽（#28／需求 6.7 階段化）：專案頁很長，這是一條精簡的頁內目錄，
 * 項目對應五階段標頭錨點，點一下平滑捲到該階段。桌面固定成左側 sticky 側欄；
 * 手機（≤820px）收合成頂部可展開的一列，靜態定位不遮內容、不造成水平捲動。
 *
 * 純附加元件：只負責捲動導覽，不碰任何既有區塊的行為與標記。
 */
export type TocItem = { id: string; label: string; badge?: string };

/** 五階段靜態清單（以簡單為準，不掃 DOM）：錨點對應 ProjectPage 各階段標頭（StageHead）的 id，
 *  順序即頁面「企劃→創作→整理→審核→交付」的一條龍敘事順序；特殊頁面可用 items props 覆蓋。 */
const DEFAULT_ITEMS: TocItem[] = [
  { id: "stage-plan", label: "① 企劃・定盤" },
  { id: "stage-create", label: "② 創作・生成" },
  { id: "stage-assets", label: "③ 素材整理" },
  { id: "stage-review", label: "④ 分鏡與審核" },
  { id: "stage-deliver", label: "⑤ 交付" },
];

const MOBILE_QUERY = "(max-width: 820px)";

/** 尊重使用者的減少動效偏好：開啟時退回瞬間捲動 */
function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TocNav({ items = DEFAULT_ITEMS }: { items?: TocItem[] }) {
  // 手機預設收合成一條，桌面固定展開為側欄
  const [open, setOpen] = useState(() =>
    typeof window === "undefined" ? true : !window.matchMedia(MOBILE_QUERY).matches,
  );

  // 跨越斷點時同步展開狀態（進桌面→展開；進手機→收合）；桌面內的手動收合不受影響
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setOpen(!mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // 捲動定位（scroll-spy）：標記目前在視窗上緣附近的區塊，讓目錄有「你在這裡」的方位感
  const [activeId, setActiveId] = useState("");
  useEffect(() => {
    const els = items
      .map((it) => document.getElementById(it.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    // 手機收合態下點完自動收起，避免展開的清單遮住內容
    if (window.matchMedia(MOBILE_QUERY).matches) setOpen(false);
  };

  return (
    <nav className="toc-rail" aria-label="章節導覽">
      <button
        type="button"
        className="toc-toggle"
        aria-expanded={open}
        aria-controls="toc-list"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="FileText" size={14} />
        <span>章節導覽</span>
        {/* 收合態也看得到未讀（手機常駐收合，不能把徽章藏進清單裡） */}
        {!open && items.some((it) => it.badge) && (
          <span className="toc-badge" aria-label="有未讀留言">
            {items.find((it) => it.badge)?.badge}
          </span>
        )}
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} style={{ marginLeft: "auto" }} />
      </button>
      {open && (
        <ul id="toc-list" className="toc-list">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="toc-link"
                aria-current={activeId === it.id ? "true" : undefined}
                onClick={() => jump(it.id)}
              >
                {it.label}
                {it.badge && <span className="toc-badge" aria-label="未讀留言數">{it.badge}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
