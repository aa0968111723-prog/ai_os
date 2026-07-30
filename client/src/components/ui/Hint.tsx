import { useId, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { useDensity } from "./density";

/**
 * 說明小字。全站用量最高的單一樣式（實測 505 處），也是「文字資訊量太大」的主因。
 *
 * 這個元件存在的理由不是包裝 `.hint`，而是讓每一句說明都必須宣告它屬於哪一層：
 *
 * - 預設（`layer="guide"`）：引導模式常駐顯示；精簡模式收合成「？」。
 * - `layer="always"`：兩種模式都常駐。用於「錯誤旁的修法」「扣點金額」等
 *   不看到就會做錯決定的資訊——這類文字不該因為使用者變熟手就消失。
 *
 * 輸出的 class 與遷移前相同（`hint`），預設密度也是 `guide`，
 * 因此換上這個元件本身**不會改變任何畫面**。
 */
export function Hint({
  children,
  layer = "guide",
  as: Tag = "p",
  className,
  toggleLabel = "顯示說明",
  ...rest
}: {
  children: ReactNode;
  /** `guide`＝精簡模式可收；`always`＝任何模式都顯示 */
  layer?: "guide" | "always";
  as?: "p" | "div" | "span";
  className?: string;
  /** 精簡模式下「？」按鈕的無障礙名稱 */
  toggleLabel?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className">) {
  const density = useDensity();
  const [open, setOpen] = useState(false);
  const id = useId();

  if (layer === "always" || density === "guide") {
    return (
      <Tag className={cx("hint", className)} {...rest}>
        {children}
      </Tag>
    );
  }

  // 精簡模式：收成「？」，點開才顯示。展開後樣式與引導模式一致。
  return (
    <>
      <button
        type="button"
        className="btn-ghost btn-sm"
        // btn-sm 的水平內距只撐到 38px 寬，未達計畫 §4 的 44px 觸控目標；
        // 高度本來就有 44px，這裡把寬度補齊成正方形。
        style={{ minWidth: 44 }}
        aria-expanded={open}
        aria-controls={id}
        aria-label={toggleLabel}
        onClick={() => setOpen((v) => !v)}
      >
        ？
      </button>
      {open ? (
        <Tag id={id} className={cx("hint", className)} {...rest}>
          {children}
        </Tag>
      ) : null}
    </>
  );
}
