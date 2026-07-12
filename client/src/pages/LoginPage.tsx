import { useState } from "react";
import { trpc } from "../api";

/**
 * zod 驗證失敗時 tRPC 預設把整包 issues JSON 塞進 error.message（伺服器端 errorFormatter
 * 不在本次可改範圍）——這裡取第一則訊息轉成一句人話，讓「email 格式/密碼長度」看得懂。
 */
function friendlyAuthError(message: string): string {
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
  const login = trpc.auth.login.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");

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
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
          <span className="orb" style={{ width: 46, height: 46 }} />
        </div>
        <h1 style={{ margin: "8px 0 2px", fontSize: 26 }}>AI Director OS</h1>
        <p className="sub" style={{ marginBottom: 8 }}>懂我們素材的創作系統</p>
        <div style={{ textAlign: "left" }}>
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          <label>密碼</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            onKeyDown={(e) => e.key === "Enter" && email && password && doLogin()}
          />
        </div>
        <div style={{ marginTop: 18 }}>
          <button
            className="primary"
            style={{ width: "100%" }}
            disabled={!email || !password || login.isPending}
            onClick={doLogin}
          >
            {login.isPending ? "登入中…" : "登入"}
          </button>
        </div>
        {localError ? (
          <p className="error">{localError}</p>
        ) : login.error ? (
          <p className="error">{friendlyAuthError(login.error.message)}</p>
        ) : null}
        <p className="hint" style={{ marginTop: 14 }}>帳號採邀請制——請向你的組長或管理員索取邀請連結。</p>
      </div>
    </div>
  );
}
