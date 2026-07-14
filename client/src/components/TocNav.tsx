import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * 章節導覽（#28）：專案頁很長（十多個堆疊區塊），這是一條精簡的頁內目錄，
 * 點一下平滑捲到對應區塊。桌面固定成左側 sticky 側欄；手機（≤820px）收合成
 * 頂部可展開的一列，靜態定位不遮內容、不造成水平捲動。
 *
 * 純附加元件：只負責捲動導覽，不碰任何既有區塊的行為與標記。
 */
export type TocItem = { id: string; label: string };

/** 依頁面實際排列順序列出各區塊（label＋目標錨點 id）。
 *  onboard-worldview／gen-prompt／onboard-delivery 為既有錨點，其餘為本次新增。 */
const DEFAULT_ITEMS: TocItem[] = [
  // ① 定盤
  { id: "onboard-worldview", label: "世界觀" },
  { id: "sec-knowledge", label: "專案知識庫" },
  { id: "sec-characters", label: "角色定裝卡" },
  { id: "sec-scenes", label: "場景設定卡" },
  { id: "sec-assets", label: "素材庫" },
  // ② 創作
  { id: "gen-prompt", label: "創作生成" },
  { id: "sec-director", label: "AI 導演建議" },
  { id: "sec-split", label: "AI 拆分鏡" },
  { id: "sec-prompts", label: "提示詞庫" },
  { id: "sec-workflow", label: "工作流" },
  // ③ 分鏡與交付
  { id: "onboard-delivery", label: "分鏡・交付" },
  { id: "sec-recyclebin", label: "回收桶" },
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
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} style={{ marginLeft: "auto" }} />
      </button>
      {open && (
        <ul id="toc-list" className="toc-list">
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" className="toc-link" onClick={() => jump(it.id)}>
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
