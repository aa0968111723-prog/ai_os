import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "./cx";

/**
 * 按鈕。對齊 ribbon-light 設計語言：Primary（Aios 緞帶漸層）／Tonal（淺底主色字）／Ghost（透明底）三級。
 *
 * class 輸出與遷移前相容：
 * - `<button>`：基底樣式來自全域 `button` 選擇器，變體只加修飾 class（`primary`／`tonal`／`btn-ghost`）。
 * - `<a>`（`as="a"`）：基底需要 `btn`（全域 `button` 選擇器吃不到錨點），變體同上。
 * - `loading` → `is-loading` + `aria-busy`，由 styles.css 顯示轉圈並鎖點擊。
 *
 * 因此把裸 `<button className="primary btn-sm">` 換成 `<Button variant="primary" size="sm">`
 * 之後 DOM 仍相容既有規則。
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
  /** 載入中：加 is-loading、aria-busy，並在未顯式 disabled 時鎖住點擊 */
  loading?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * React 19 起 `ref` 對函式元件就是一般 prop，不需要 forwardRef——
 * 但型別得自己宣告，否則呼叫端傳 ref 會被 TS 擋下（站內有數處按鈕需要 ref 做焦點管理）。
 */
type AsButton = Own & ButtonHTMLAttributes<HTMLButtonElement> & { as?: "button"; ref?: Ref<HTMLButtonElement> };
type AsAnchor = Own & AnchorHTMLAttributes<HTMLAnchorElement> & { as: "a"; ref?: Ref<HTMLAnchorElement> };

export function Button(props: AsButton | AsAnchor) {
  const { variant = "neutral", size = "md", loading = false, className, children } = props;
  const modifier = cx(VARIANT_CLASS[variant], size === "sm" && "btn-sm", loading && "is-loading", className);

  if (props.as === "a") {
    const { as: _as, variant: _v, size: _s, loading: _l, className: _c, children: _ch, ...rest } = props;
    // 錨點需要 `btn` 提供基底樣式；ghost 變體自帶完整外觀，不疊 `btn` 免得雙重 padding。
    const base = variant === "ghost" ? "" : "btn";
    return (
      <a
        className={cx(base, modifier)}
        aria-busy={loading || undefined}
        aria-disabled={loading || rest["aria-disabled"] || undefined}
        {...rest}
      >
        {children}
      </a>
    );
  }

  const { as: _as, variant: _v, size: _s, loading: _l, className: _c, children: _ch, type, disabled, ...rest } = props;
  return (
    <button
      type={type ?? "button"}
      className={modifier || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
