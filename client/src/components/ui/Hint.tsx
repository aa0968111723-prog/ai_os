import { isValidElement, useId, useState, type ReactNode } from "react";
import { Icon } from "../Icon";
import { cx } from "./cx";
import { useDensity } from "./density";

/**
 * 從 ReactNode 收集純文字（深度優先，最多 `limit` 字就停）。
 * 收合按鈕的無障礙名稱用：同一頁常有十幾個收合 Hint，若全叫「顯示說明」，
 * 讀屏的元件清單（rotor）聽到的是一整排同名按鈕，語音控制也無從指定目標。
 * 從內容取前幾個字當名稱，每一顆就有可辨識的身分，且 206 個呼叫端零改動。
 */
function textOf(node: ReactNode, limit: number): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    let out = "";
    for (const child of node) {
      out += textOf(child, limit - out.length);
      if (out.length >= limit) break;
    }
    return out;
  }
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children, limit);
  return "";
}

/**
 * 說明小字。全站用量最高的單一樣式（實測 505 處），也是「文字資訊量太大」的主因。
 *
 * 這個元件存在的理由不是包裝 `.hint`，而是讓每一句說明都必須宣告它屬於哪一層：
 *
 * - 預設（`layer="guide"`）：引導模式常駐顯示；精簡模式收合成一顆「說明」小鈕。
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
  toggleLabel,
  ...rest
}: {
  children: ReactNode;
  /** `guide`＝精簡模式可收；`always`＝任何模式都顯示 */
  layer?: "guide" | "always";
  /** 說明有時是條列（例如「先讀全貌 → 再看細節」的使用建議） */
  as?: "p" | "div" | "span" | "ul" | "ol";
  className?: string;
  /** 精簡模式下「說明」按鈕的無障礙名稱。不給就從內容前幾個字自動推導。 */
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

  // 精簡模式：收成一顆「說明」小鈕，點開才顯示。展開後樣式與引導模式一致。
  // 名稱格式「顯示說明：<內容前 16 字>…」——先講用途（一致的前綴便於掃讀），
  // 再用內容片段區分身分。內容取不出文字（例如純圖示）才退回通稱。
  //
  // 這裡曾經只印一個裸的「？」字元（btn-ghost 是透明底＋透明框）。實機上那看起來
  // 不是按鈕，是段落中間掉了一個問號——使用者回報「為什麼這邊都打問號」。
  // 改成帶框線的膠囊＋問號圖示＋可見文字「說明」：一眼看得出可以點，
  // 也讓語音控制講得出名字（可見文字必須包含在無障礙名稱裡，WCAG 2.5.3）。
  const snippet = textOf(children, 24).trim().slice(0, 16);
  const label = toggleLabel ?? (snippet ? `顯示說明：${snippet}…` : "顯示說明");
  return (
    <>
      <button
        type="button"
        className={cx("hint-toggle", open && "is-open")}
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="HelpCircle" size={13} />
        說明
      </button>
      {open ? (
        <Tag id={id} className={cx("hint", className)} {...rest}>
          {children}
        </Tag>
      ) : null}
    </>
  );
}
