import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * 章節導覽（#28／需求 6.7 階段化）：專案頁很長，這是一條精簡的頁內目錄，
 * 項目對應三幕標頭錨點（上下文 → AI 創作中心 → 分鏡・交付），點一下平滑捲到該幕。
 * 桌面固定成左側 sticky 側欄；手機（≤820px）收合成頂部可展開的一列。
 *
 * 純附加元件：只負責捲動導覽。② 只跳到 #stage-create（單一工作台），不把各模式拆成目錄項。
 */
export type TocItem = { id: string; label: string; badge?: string };

/**
 * 預設三幕（WB-06）：與 ProjectPage StageHead 對齊。
 * 特殊頁面可用 items props 覆蓋；勿把 #sec-studio / #sec-workflow 等模式錨點列進目錄。
 */
export const DEFAULT_ITEMS: TocItem[] = [
  { id: "stage-context", label: "① 專案上下文" },
  { id: "stage-create", label: "② AI 創作中心" },
  { id: "stage-deliver", label: "③ 分鏡・交付" },
];

/** 尊重使用者的減少動效偏好：開啟時退回瞬間捲動 */
function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TocNav({ items = DEFAULT_ITEMS }: { items?: TocItem[] }) {
  // 桌面是側欄；手機由 CSS 轉成常駐橫向階段列，避免長頁反覆展開選單。
  const [open, setOpen] = useState(true);

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
    // 地毯實測缺陷修復：rootMargin 要求標頭進入視窗頂部 30% 才算 active——短頁面（新專案）
    // 最後一區永遠捲不到那裡，「③ 分鏡・交付」永遠標不亮。補「捲到底＝標最後一項」的 fallback
    const lastId = items[items.length - 1]?.id;
    const onScroll = () => {
      if (lastId && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        setActiveId(lastId);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [items]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    // 點擊即是意圖：立刻標記，不等 scroll-spy（短頁面的最後一區 observer 永遠不會標到）
    setActiveId(id);
    el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    // 跳轉同步寫入 URL hash（replaceState 不塞歷史）：可分享「直達某一幕」（如 #stage-create）的深連結，重整也留在原幕
    history.replaceState(null, "", `#${id}`);
  };

  // 手機的頁籤條是隱藏捲軸的橫捲膠囊列：當前頁籤若在畫面外，使用者會以為
  // 「只有這幾個」。activeId 變動時把當前膠囊捲進視野——只動容器的水平軸
  // （scrollIntoView 會連整頁垂直一起捲，正在閱讀時頁面跳動比看不到頁籤更糟）。
  useEffect(() => {
    if (!activeId) return;
    const link = document.querySelector<HTMLElement>(`#toc-list [aria-current="true"]`);
    const list = link?.closest<HTMLElement>("#toc-list");
    if (!link || !list || list.scrollWidth <= list.clientWidth) return;
    const target = link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, target), behavior: reducedMotion() ? "auto" : "smooth" });
  }, [activeId]);

  // 深連結：帶 #stage-xxx 開頁時自動捲到該階段（內容掛載晚於瀏覽器原生錨點時機，這裡補跳一次）
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id || !items.some((it) => it.id === id)) return;
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
    // 只在掛載時跳一次——items 之後的變動（徽章數字）不該再觸發捲動
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
