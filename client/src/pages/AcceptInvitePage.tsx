import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../api";

export function AcceptInvitePage({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const accept = trpc.auth.acceptInvite.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      navigate("/");
    },
  });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div style={{ minHeight: "70vh", display: "grid", placeItems: "center" }}>
      <div className="card" style={{ width: 400, maxWidth: "92vw" }}>
        <h1 style={{ fontSize: 24, marginTop: 0 }}>歡迎加入 🙏</h1>
        <p className="sub">設定你的名字與密碼，就可以開始創作。</p>
        <label>你的名字（夥伴會看到）</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：阿哲" />
        <label>密碼（至少 8 碼）</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <div style={{ marginTop: 18 }}>
          <button
            className="primary"
            style={{ width: "100%" }}
            disabled={!name.trim() || password.length < 8 || accept.isPending}
            onClick={() => accept.mutate({ token, name: name.trim(), password })}
          >
            {accept.isPending ? "建立中…" : "完成加入"}
          </button>
        </div>
        {accept.error && <p className="error">{accept.error.message}</p>}
      </div>
    </div>
  );
}
