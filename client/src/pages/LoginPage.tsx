import { useState } from "react";
import { trpc } from "../api";

export function LoginPage() {
  const utils = trpc.useUtils();
  const login = trpc.auth.login.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
            onKeyDown={(e) => e.key === "Enter" && email && password && !login.isPending && login.mutate({ email, password })}
          />
        </div>
        <div style={{ marginTop: 18 }}>
          <button
            className="primary"
            style={{ width: "100%" }}
            disabled={!email || !password || login.isPending}
            onClick={() => login.mutate({ email, password })}
          >
            {login.isPending ? "登入中…" : "登入"}
          </button>
        </div>
        {login.error && <p className="error">{login.error.message}</p>}
        <p className="hint" style={{ marginTop: 14 }}>帳號採邀請制——請向你的組長或管理員索取邀請連結。</p>
      </div>
    </div>
  );
}
