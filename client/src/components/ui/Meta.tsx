import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * 次要內容（小灰字）。**與 Hint 的差別是這一層最重要的區分。**
 *
 * 全站 505 處 `.hint` 逐一讀過後發現：其中很大一部分根本不是說明文字，
 * 而是「內容剛好用小灰字呈現」——計畫目標、成功條件、風險、里程碑、待補資訊、
 * 步驟清單、狀態計數、時間戳。它們套 `.hint` 只因為那是站內唯一的小灰字樣式。
 *
 * 這個區分很要命：把內容收到「？」後面會直接毀掉介面（使用者會以為資料不見了），
 * 但把說明常駐又回到「文字量太大」的原點。所以兩者必須分開表達：
 *
 * - `<Hint>`：**說明**。解釋介面怎麼用、為什麼不能按。熟手不需要 → 精簡模式可收。
 * - `<Meta>`：**內容**。資料本身，只是視覺權重較低 → 任何模式都顯示。
 *
 * 視覺輸出與 `.hint` 完全相同，故遷移零變化；差別只在語意與是否參與分層。
 * 選擇哪一個時的判準：**把它藏起來，使用者會不會誤以為資料不存在？**
 * 會 → Meta；不會（只是少了解釋）→ Hint。
 */
export function Meta({
  as: Tag = "span",
  className,
  children,
  ...rest
}: {
  /** 內容的形狀很多樣：條列（ul/ol/li）、段落、可收合區的標頭（summary）都用得上 */
  as?: "span" | "p" | "div" | "ul" | "ol" | "li" | "small" | "summary";
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className">) {
  return (
    <Tag className={cx("hint", className)} {...rest}>
      {children}
    </Tag>
  );
}
