import {
  useEffect, useId, useRef, useState,
  type ReactNode, type CSSProperties, type RefObject, type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "./Icon";
import { Button, Meta } from "./ui";
/**
 * 共用互動基元（第二輪：把原生 window.confirm/prompt/alert 與無漫遊 radiogroup
 * 換成留在 monastic-calm 語言內、可鍵盤操作的就地元件）。CSP 下零外部依賴。
 */

/**
 * useFocusTrap：對話框開啟時把焦點鎖在容器內、鎖背景捲動、Esc 關閉，
 * 關閉後把焦點還給開啟者。active 為 false 時完全不介入。
 */
export function useFocusTrap<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onClose?: () => void,
) {
  // onClose 用 ref 存：避免父層每次 re-render 傳入新的 inline onClose 就重跑效果、把焦點搶回開頭
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = (): HTMLElement[] =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          // 可見性判定用 getClientRects：offsetParent 對 position:fixed 元素恆為 null，
          // 會把「可見但 fixed」的控件（如粗剪預覽釘在右上角的關閉鈕）誤判為隱藏而踢出焦點環
          ).filter((el) => el.getClientRects().length > 0 || el === document.activeElement)
        : [];
    // 進場把焦點移進對話框
    (focusables()[0] ?? node)?.focus?.();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const idx = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault();
          items[items.length - 1].focus();
        }
      } else if (idx === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [active, ref]);
}

/**
 * ConfirmButton：就地確認的動作按鈕，取代 window.confirm / window.prompt。
 * 兩段式（觸發→確認）；Esc 或點外面取消；焦點自動進出；可選 reason 文字框
 * （取代 window.prompt 的輸入需求）。視覺沿用既有 .confirm-panel / .primary / .btn-ghost。
 */
export function ConfirmButton({
  onConfirm,
  children,
  title,
  message,
  confirmLabel = "確認",
  cancelLabel = "取消",
  mode = "inline",
  reason,
  disabled,
  triggerClassName,
  triggerStyle,
  triggerTitle,
  triggerAriaLabel,
}: {
  onConfirm: (reason?: string) => void;
  children: ReactNode;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  mode?: "inline" | "panel";
  reason?: { label?: string; placeholder?: string; required?: boolean };
  disabled?: boolean;
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  triggerTitle?: string;
  triggerAriaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [reasonText, setReasonText] = useState("");
  // QA-024：必填理由留空按確認時，除了 refocus 還要「看得見」的 inline 錯誤——
  // 舊版只默默把焦點移回文字框，使用者以為按鈕壞掉
  const [reasonError, setReasonError] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const reasonId = useId();
  const usePanel = mode === "panel" || !!reason;

  const cancel = () => {
    setArmed(false);
    setReasonText("");
    setReasonError(false);
    triggerRef.current?.focus();
  };
  const confirm = () => {
    if (reason?.required && !reasonText.trim()) {
      setReasonError(true);
      reasonRef.current?.focus();
      return;
    }
    onConfirm(reason ? reasonText.trim() : undefined);
    setArmed(false);
    setReasonText("");
    setReasonError(false);
  };

  useEffect(() => {
    if (!armed) return;
    (reason ? reasonRef.current : confirmRef.current)?.focus();
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) cancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  if (!armed) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        style={triggerStyle}
        title={triggerTitle}
        aria-label={triggerAriaLabel}
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {children}
      </button>
    );
  }

  const buttons = (
    <>
      <Button size="sm" variant="primary" ref={confirmRef} type="button" onClick={confirm}>
        {confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" onClick={cancel}>
        {cancelLabel}
      </Button>
    </>
  );

  if (usePanel) {
    return (
      <span ref={wrapRef} style={{ display: "block" }}>
        <div className="confirm-panel" role="alertdialog" aria-label={title || message || "確認"}>
          {title && <h3>{title}</h3>}
          {message && <Meta as="p" style={{ marginTop: title ? 4 : 0 }}>{message}</Meta>}
          {reason && (
            <>
              {reason.label && <label htmlFor={reasonId}>{reason.label}</label>}
              <textarea
                id={reasonId}
                ref={reasonRef}
                value={reasonText}
                onChange={(e) => {
                  setReasonText(e.target.value);
                  if (reasonError && e.target.value.trim()) setReasonError(false);
                }}
                placeholder={reason.placeholder}
                aria-invalid={reasonError || undefined}
                style={{ minHeight: 60, marginTop: 6, ...(reasonError ? { borderColor: "var(--danger-ink, #b91c1c)" } : {}) }}
              />
              {reasonError && (
                <p className="error" role="alert" style={{ marginTop: 4 }}>
                  請填寫理由後再送出（此欄必填）
                </p>
              )}
            </>
          )}
          <div style={{ display: "flex", gap: "var(--sp-8)", marginTop: "var(--sp-12)" }}>{buttons}</div>
        </div>
      </span>
    );
  }

  return (
    <span
      ref={wrapRef}
      role="alertdialog"
      aria-label={title || message || "確認"}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
    >
      <Meta style={{ margin: 0 }}>{message || title || "確定嗎？"}</Meta>
      {buttons}
    </span>
  );
}

/** 白話小提示：術語旁的「?」小圖示。桌面 hover 看 title；點擊/鍵盤展開就地氣泡——
 * 觸控裝置沒有 hover，原生 title 永遠不會出現。共用元件（原在 ProjectPage，
 * 因 SceneList 等元件的標題也需要而移到這裡）。 */
export function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
      <button
        type="button"
        className="help-tip-trigger"
        aria-label={open ? "收合提示" : `顯示提示：${text}`}
        aria-expanded={open}
        title={text}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          marginLeft: 6, padding: 2, minHeight: 0, color: "var(--primary)", cursor: "help",
          background: "none", border: "none", boxShadow: "none", userSelect: "none", lineHeight: 1,
        }}
      >
        <Icon name="HelpCircle" size={14} />
      </button>
      {open && (
        <span
          role="status"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
            zIndex: 45, width: "max-content", maxWidth: "min(280px, 78vw)",
            background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "var(--r-8)",
            boxShadow: "var(--e3)", padding: "8px 12px",
            fontSize: "var(--fs-13)", fontWeight: 400, lineHeight: 1.6, color: "var(--fg)",
            whiteSpace: "normal", textAlign: "left",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * CharCount：長文欄位的「已 N / 上限 字」即時計數。逼近上限（≥90%）轉警示色、
 * 觸頂時明講「超出的部分不會被收錄」——搭配 maxLength 使用時，貼上長稿被截斷不再無聲。
 */
export function CharCount({ value, max }: { value: string; max: number }) {
  const len = value.length;
  const near = len >= max * 0.9;
  const atMax = len >= max;
  return (
    <Meta
      as="p"
      role={atMax ? "status" : undefined}
      style={{ margin: "4px 0 0", textAlign: "right", ...(near ? { color: atMax ? "var(--danger-ink)" : "var(--gold-ink)" } : {}) }}
    >
      {len.toLocaleString()} / {max.toLocaleString()} 字
      {atMax && "——已達上限，再貼上的內容不會被收錄；長稿請分成多份"}
    </Meta>
  );
}

/**
 * useRovingRadio：讓一組 role="radio" 支援方向鍵漫遊（左右/上下/Home/End），
 * 只有選中項（或無選中時的第一項）進 Tab 序，其餘 tabIndex=-1。保留點擊切換／取消選取。
 */
export function useRovingRadio(values: string[], selected: string, onSelect: (v: string) => void) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const sel = values.indexOf(selected);
  const activeIndex = sel >= 0 ? sel : 0;
  const move = (to: number) => {
    const n = values.length;
    if (!n) return;
    const idx = ((to % n) + n) % n;
    refs.current[idx]?.focus();
    onSelect(values[idx]);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const cur = refs.current.findIndex((el) => el === document.activeElement);
    const base = cur >= 0 ? cur : activeIndex;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(base + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(base - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(values.length - 1);
    }
  };
  const itemProps = (index: number) => ({
    ref: (el: HTMLElement | null) => {
      refs.current[index] = el;
    },
    tabIndex: index === activeIndex ? 0 : -1,
  });
  return { groupProps: { onKeyDown }, itemProps };
}
