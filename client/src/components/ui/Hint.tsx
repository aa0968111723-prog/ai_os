import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * 說明小字。全站用量最高的單一樣式（實測 505 處）。
 *
 * 曾經有過「引導／精簡」兩種介面密度：精簡模式把這些說明收合成一顆「說明」小鈕。
 * 那個開關已經拿掉——實機上多出來的問號小鈕自己變成了新的雜訊
 * （使用者回報「為什麼這邊都打問號」），而同一句說明在不同人的畫面上長得不一樣，
 * 也讓口頭教學與截圖對不起來。現在全站統一：說明一律常駐。
 *
 * 保留這個元件而不是退回裸 `<p className="hint">`：呼叫端已有 335 處，
 * 集中在這裡才有機會一次調整語意（例如日後改成可摺疊的段落）。
 */
export function Hint({
  children,
  as: Tag = "p",
  className,
  ...rest
}: {
  children: ReactNode;
  /** 說明有時是條列（例如「先讀全貌 → 再看細節」的使用建議） */
  as?: "p" | "div" | "span" | "ul" | "ol";
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className">) {
  return (
    <Tag className={cx("hint", className)} {...rest}>
      {children}
    </Tag>
  );
}
