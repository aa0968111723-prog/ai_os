import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { PasswordInput } from "../components/PasswordInput";

const TEAM_ROLE_LABEL: Record<string, string> = { admin: "團隊管理員", member: "成員" };
const GROUP_ROLE_LABEL: Record<string, string> = { leader: "組長", member: "組員" };

export function AcceptInvitePage({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  // 邀請頁在 App 的登入檢查之外也會渲染——這裡自己查目前登入狀態，提醒「換帳號」的情況
  const me = trpc.auth.me.useQuery();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  const preview = trpc.auth.invitePreview.useQuery({ token });
  const accept = trpc.auth.acceptInvite.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      // replace：兌換後這條 /invite/:token 已失效，別留在瀏覽器歷史（上一頁又回到失效連結）
      navigate("/", { replace: true });
    },
  });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const wrap = (inner: React.ReactNode) => (
    <div style={{ minHeight: "70vh", display: "grid", placeItems: "center" }}>
      <div className="card" style={{ width: 420, maxWidth: "92vw" }}>{inner}</div>
    </div>
  );

  if (preview.isLoading) return wrap(<p className="hint">確認邀請連結中…</p>);

  // 連結無效／過期／用過：清楚說明＋回登入
  if (preview.error || !preview.data?.valid) {
    return wrap(
      <>
        <h1 style={{ fontSize: 22, marginTop: 0 }}>這個邀請不能用了</h1>
        <p className="error" role="alert">{preview.data?.reason ?? preview.error?.message ?? "邀請連結無效"}</p>
        <p className="hint" style={{ marginTop: 12 }}>
          已經有帳號了？<Link href="/">前往登入</Link>
        </p>
      </>,
    );
  }

  const d = preview.data;

  // email 已有帳號：不走邀請落地（安全設計），引導登入
  if (d.alreadyHasAccount) {
    return wrap(
      <>
        <h1 style={{ fontSize: 22, marginTop: 0 }}>你已經有帳號了 🙌</h1>
        <p className="sub">{d.email} 已註冊過——請直接用原本的密碼登入；要加入新的組，登入後由管理員把你加入即可。</p>
        <Link href="/"><button className="primary" style={{ width: "100%", marginTop: 12 }}>前往登入</button></Link>
      </>,
    );
  }

  const canSubmit = name.trim().length > 0 && password.length >= 8 && !accept.isPending;

  return wrap(
    <>
      {me.data && (
        <p className="hint" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 0, marginBottom: 14 }}>
          <span style={{ flex: 1 }}>
            你目前已登入為 <b>{me.data.user.name}</b>——完成加入後這個瀏覽器會切換成新帳號
          </span>
          <button
            type="button"
            style={{ padding: "4px 14px", fontSize: 12, whiteSpace: "nowrap" }}
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            {logout.isPending ? "登出中…" : "登出"}
          </button>
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) accept.mutate({ token, name: name.trim(), password });
        }}
      >
        <h1 style={{ fontSize: 24, marginTop: 0 }}>歡迎加入 🙏</h1>
        <p className="sub">
          你被邀請加入 <b>{d.teamName}</b>
          {d.groupName ? <>・<b>{d.groupName}</b></> : ""}
          {d.groupName ? `（${GROUP_ROLE_LABEL[d.groupRole ?? "member"]}）` : `（${TEAM_ROLE_LABEL[d.teamRole ?? "member"]}）`}
        </p>
        <p className="hint" style={{ marginTop: -4 }}>邀請寄給：{d.email}</p>

        <label htmlFor="inv-name">你的名字（夥伴會看到）</label>
        <input id="inv-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="例：阿哲" autoFocus />
        <label htmlFor="inv-pw">密碼（至少 8 碼）</label>
        <PasswordInput id="inv-pw" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        {password.length > 0 && password.length < 8 && <p className="hint">還差 {8 - password.length} 個字</p>}

        <div style={{ marginTop: 18 }}>
          <button className="primary" type="submit" style={{ width: "100%" }} disabled={!canSubmit}>
            {accept.isPending ? "建立中…" : "完成加入"}
          </button>
        </div>
        {accept.error && <p className="error" role="alert">{accept.error.message}</p>}
      </form>
    </>,
  );
}
