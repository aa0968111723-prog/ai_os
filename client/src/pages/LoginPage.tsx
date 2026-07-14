import { useRef, useState } from "react";
import { trpc } from "../api";
import { PasswordInput } from "../components/PasswordInput";
import { Icon } from "../components/Icon";

/**
 * zod 驗證失敗時 tRPC 預設把整包 issues JSON 塞進 error.message（伺服器端 errorFormatter
 * 不在本次可改範圍）——這裡取第一則訊息轉成一句人話，讓「email 格式/密碼長度」看得懂。
 */
export function friendlyAuthError(message: string): string {
  try {
    const issues = JSON.parse(message) as Array<{ message?: string }>;
    if (Array.isArray(issues) && issues[0]?.message) {
      const m = issues[0].message;
      if (/invalid email/i.test(m)) return "Email 格式不對，請檢查（例：you@example.com）";
      const min = /at least (\d+) character/i.exec(m);
      if (min) return `密碼長度至少 ${min[1]} 個字`;
      return m; // 後端多數欄位已附中文訊息（如「email 格式不對」），直接顯示
    }
  } catch {
    /* 非 zod JSON → 一般錯誤訊息（如「email 或密碼不正確」）原樣顯示 */
  }
  return message;
}

export function LoginPage() {
  const utils = trpc.useUtils();
  const pwRef = useRef<HTMLInputElement>(null);
  const login = trpc.auth.login.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    // 失敗後選取整段密碼並聚焦：使用者直接重打即可，不用先手動清空
    onError: () => {
      pwRef.current?.select();
      pwRef.current?.focus();
    },
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");

  // 一開始改字就收掉舊錯誤，避免「正在改了紅字還掛著」
  const clearStaleError = () => {
    if (login.error) login.reset();
    if (localError) setLocalError("");
  };

  // 送出前先在本地擋明顯的 email 格式錯誤：不必等後端 zod 回整包 JSON 錯誤
  const doLogin = () => {
    if (login.isPending) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setLocalError("Email 格式不對，請檢查（例：you@example.com）");
      return;
    }
    setLocalError("");
    login.mutate({ email: email.trim(), password });
  };

  return (
    <div style={{ minHeight: "70vh", display: "grid", placeItems: "center" }}>
      <div className="card" style={{ width: 400, maxWidth: "92vw", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--sp-8)" }}>
          <span className="orb" style={{ width: 46, height: 46 }} />
        </div>
        <h1 style={{ margin: "8px 0 2px", fontSize: "var(--fs-24)" }}>AI Director OS</h1>
        <p className="sub" style={{ marginBottom: 8 }}>懂我們素材的創作系統</p>
        {/* 用 <form>：瀏覽器/密碼管理器靠它辨識登入表單做自動填入；Enter 由 submit 統一處理 */}
        <form style={{ textAlign: "left" }} onSubmit={(e) => { e.preventDefault(); doLogin(); }}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearStaleError(); }}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
          />
          <label htmlFor="login-pw">密碼</label>
          <PasswordInput
            id="login-pw"
            ref={pwRef}
            value={password}
            onChange={(e) => { setPassword(e.target.value); clearStaleError(); }}
            autoComplete="current-password"
          />
          <div style={{ marginTop: "var(--sp-16)" }}>
            <button
              className="primary"
              type="submit"
              style={{ width: "100%" }}
              disabled={!email.trim() || !password || login.isPending}
            >
              {login.isPending ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-8)" }}>
                  <Icon name="Loader" className="spin" />
                  登入中…
                </span>
              ) : (
                "登入"
              )}
            </button>
          </div>
        </form>
        {localError ? (
          <p className="error" role="alert">{localError}</p>
        ) : login.error ? (
          <p className="error" role="alert">{friendlyAuthError(login.error.message)}</p>
        ) : null}
        <p className="hint" style={{ marginTop: "var(--sp-12)" }}>帳號採邀請制——請向你的組長或管理員索取邀請連結。忘記密碼請找管理員重設。</p>
      </div>
    </div>
  );
}
