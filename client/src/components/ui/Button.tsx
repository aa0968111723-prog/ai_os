import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * 按鈕。對齊全站計畫 §24.3「收斂為 Primary（實心赤陶）／Tonal（淺底赤陶字）／Ghost（透明底）三級」。
 *
 * class 輸出與遷移前逐字相同：
 * - `<button>`：基底樣式來自全域 `button` 選擇器，變體只加修飾 class（`primary`／`tonal`／`btn-ghost`）。
 * - `<a>`（`as="a"`）：基底需要 `btn`（全域 `button` 選擇器吃不到錨點），變體同上。
 *
 * 因此把裸 `<button className="primary btn-sm">` 換成 `<Button variant="primary" size="sm">`
 * 之後 DOM 完全一致——遷移零視覺風險。
 */
export type ButtonVariant = "neutral" | "primary" | "tonal" | "ghost";
export type ButtonSize = "md" | "sm";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  neutral: "",
  primary: "primary",
  tonal: "tonal",
  ghost: "btn-ghost",
};

interface Own {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
}

type AsButton = Own & ButtonHTMLAttributes<HTMLButtonElement> & { as?: "button" };
type AsAnchor = Own & AnchorHTMLAttributes<HTMLAnchorElement> & { as: "a" };

export function Button(props: AsButton | AsAnchor) {
  const { variant = "neutral", size = "md", className, children } = props;
  const modifier = cx(VARIANT_CLASS[variant], size === "sm" && "btn-sm", className);

  if (props.as === "a") {
    const { as: _as, variant: _v, size: _s, className: _c, children: _ch, ...rest } = props;
    // 錨點需要 `btn` 提供基底樣式；ghost 變體自帶完整外觀，不疊 `btn` 免得雙重 padding。
    const base = variant === "ghost" ? "" : "btn";
    return (
      <a className={cx(base, modifier)} {...rest}>
        {children}
      </a>
    );
  }

  const { as: _as, variant: _v, size: _s, className: _c, children: _ch, type, ...rest } = props;
  return (
    <button type={type ?? "button"} className={modifier || undefined} {...rest}>
      {children}
    </button>
  );
}
