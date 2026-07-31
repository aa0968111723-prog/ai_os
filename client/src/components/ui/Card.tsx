import type { DetailsHTMLAttributes, HTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "./cx";

/**
 * 卡片表面。四種語意對應 styles.css 既有的三個修飾 class：
 *
 * - `default` → `card`：一般卡面（象牙紙）
 * - `primary` → `card card--primary`：主卡，左緣有主色條、較寬內距
 * - `std`     → `card card--std`：低一階陰影，用於次要區塊
 * - `quiet`   → `card card--quiet`：透明底髮絲框；配 `as="details"` 就是可收合區
 *
 * class 輸出與遷移前逐字相同。
 *
 * 型別用判別聯集而非「把 open 塞給所有標籤」：`open`／`onToggle` 只有 `<details>`
 * 有意義，混在一起會讓 `<div open="">` 這種無效 DOM 通過型別檢查。
 */
export type CardVariant = "default" | "primary" | "std" | "quiet";

const VARIANT_CLASS: Record<CardVariant, string> = {
  default: "",
  primary: "card--primary",
  std: "card--std",
  quiet: "card--quiet",
};

interface CardOwn {
  variant?: CardVariant;
  className?: string;
  children?: ReactNode;
}

/** 站內數處把卡片當對話框（role="dialog"）並用 ref 管焦點，故需宣告 ref。 */
type CardDetails = CardOwn &
  Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "children" | "className"> & {
    as: "details";
    ref?: Ref<HTMLDetailsElement>;
  };

type CardBlock = CardOwn &
  Omit<HTMLAttributes<HTMLElement>, "children" | "className"> & {
    as?: "div" | "section" | "article" | "aside" | "li";
    /**
     * 聯集而非單一寬型別：`Ref<HTMLElement>` 會因回呼 ref 的參數反變性收不下
     * 既有的 `(el: HTMLDivElement) => void` 呼叫端；`Ref<HTMLDivElement>` 又對
     * as="aside"/"section" 謊報元素型別（MessagePanel 的 aside ref 就撞上了）。
     * 兩個都放進聯集，兩種呼叫端都收，且不改任何執行期行為。
     */
    ref?: Ref<HTMLDivElement> | Ref<HTMLElement>;
  };

export function Card(props: CardDetails | CardBlock) {
  const { variant = "default", className, children } = props;
  const { as: Tag = "div", variant: _v, className: _c, children: _ch, ...rest } = props as CardBlock;
  // Tag 是多型的，TS 無法同時滿足 div/li/details 各自的 ref 與屬性型別。
  // 這個轉型侷限在元件內部——對外的 CardDetails/CardBlock 聯集仍然嚴格，
  // 呼叫端拿到的型別檢查不受影響（例如 <Card open> 沒帶 as="details" 仍會被擋）。
  const domProps = rest as Record<string, unknown>;
  return (
    <Tag className={cx("card", VARIANT_CLASS[variant], className)} {...domProps}>
      {children}
    </Tag>
  );
}
