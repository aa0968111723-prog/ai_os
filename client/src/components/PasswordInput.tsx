import { useState } from "react";

/**
 * 密碼欄＋「顯示/隱藏」小鈕（登入頁與邀請頁共用）。
 * type 由內部切換控制，其餘 props（id/value/onChange/autoComplete/maxLength/ref…）原樣透傳。
 */
export function PasswordInput({ style, ...rest }: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input {...rest} type={visible ? "text" : "password"} style={{ paddingRight: 62, ...style }} />
      <button
        type="button"
        // tabIndex=-1：Tab 不停在這顆鈕（直接從密碼欄跳下一欄），滑鼠／觸控仍可點
        tabIndex={-1}
        aria-label={visible ? "隱藏密碼" : "顯示密碼"}
        onClick={() => setVisible((v) => !v)}
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          padding: "2px 10px",
          fontSize: 12,
          border: "none",
          background: "transparent",
          color: "var(--muted-fg)",
        }}
      >
        {visible ? "隱藏" : "顯示"}
      </button>
    </div>
  );
}
