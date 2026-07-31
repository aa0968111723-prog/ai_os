import { useState } from "react";
import { Button } from "./ui";

/**
 * 密碼欄＋「顯示/隱藏」小鈕（登入頁與邀請頁共用）。
 * type 由內部切換控制，其餘 props（id/value/onChange/autoComplete/maxLength/ref…）原樣透傳。
 */
export function PasswordInput({ style, ...rest }: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input {...rest} type={visible ? "text" : "password"} style={{ paddingRight: 62, ...style }} />
      <Button
        variant="ghost"
        // 顯示/隱藏切換可用鍵盤操作：Tab 可聚焦、Enter／Space 觸發
        aria-label={visible ? "隱藏密碼" : "顯示密碼"}
        onClick={() => setVisible((v) => !v)}
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          display: "grid",
          placeItems: "center",
          minWidth: 40,
          minHeight: 40,
          padding: 0,
          fontSize: 12,
          color: "var(--muted-fg)",
        }}
      >
        {visible ? "隱藏" : "顯示"}
      </Button>
    </div>
  );
}
