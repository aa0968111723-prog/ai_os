import { useState } from "react";
import { trpc } from "../api";

/** 管理頁（總管理/超管）：組織總覽＋邀請成員（連結用 LINE 傳） */
export function AdminPage() {
  const utils = trpc.useUtils();
  const overview = trpc.admin.overview.useQuery();
  const invite = trpc.admin.invite.useMutation({ onSuccess: () => utils.admin.overview.invalidate() });
  const createGroup = trpc.admin.createGroup.useMutation({ onSuccess: () => utils.admin.overview.invalidate() });

  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [groupRole, setGroupRole] = useState<"leader" | "member">("member");
  const [newGroupName, setNewGroupName] = useState("");

  if (overview.isLoading) return <p className="hint">載入中…</p>;
  if (overview.error) return <p className="error">{overview.error.message}</p>;
  const teams = overview.data ?? [];
  const selectedTeam = teams.find((t) => t.id === (teamId || teams[0]?.id));

  return (
    <div>
      <h1>團隊管理</h1>
      <p className="sub">團隊 → 組別 → 成員。邀請連結 72 小時內有效，用 LINE 傳給夥伴即可。</p>
      <div className="cols">
        <div className="stack">
          {teams.map((team) => (
            <section key={team.id} className="card">
              <h2>{team.name}</h2>
              <p className="hint">管理：{team.admins.map((a) => a?.name).join("、") || "—"}</p>
              {team.groups.map((g) => (
                <div key={g.id} style={{ marginTop: 10 }}>
                  <b>{g.name}</b>{" "}
                  {g.members.length === 0 ? (
                    <span className="hint">（還沒有成員）</span>
                  ) : (
                    g.members.map((m) => (
                      <span key={m.id} className="chip">
                        {m.name}
                        {m.role === "leader" ? "・組長" : ""}
                      </span>
                    ))
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <input
                  placeholder="新組名稱（例：文宣組）"
                  value={teamId === team.id ? newGroupName : ""}
                  onChange={(e) => {
                    setTeamId(team.id);
                    setNewGroupName(e.target.value);
                  }}
                />
                <button
                  disabled={!(teamId === team.id && newGroupName.trim()) || createGroup.isPending}
                  onClick={() => createGroup.mutate({ teamId: team.id, name: newGroupName.trim() }, { onSuccess: () => setNewGroupName("") })}
                >
                  ＋建組
                </button>
              </div>
            </section>
          ))}
        </div>

        <aside className="card">
          <h2>邀請成員</h2>
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partner@example.com" />
          <label>團隊</label>
          <select value={selectedTeam?.id ?? ""} onChange={(e) => { setTeamId(e.target.value); setGroupId(""); }}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <label>組別</label>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">（先不入組）</option>
            {selectedTeam?.groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <label>組內角色</label>
          <select value={groupRole} onChange={(e) => setGroupRole(e.target.value as "leader" | "member")}>
            <option value="member">組員</option>
            <option value="leader">組長</option>
          </select>
          <div style={{ marginTop: 16 }}>
            <button
              className="primary"
              disabled={!email.includes("@") || !selectedTeam || invite.isPending}
              onClick={() =>
                invite.mutate({ email: email.trim(), teamId: selectedTeam!.id, teamRole: "member", groupId: groupId || undefined, groupRole })
              }
            >
              {invite.isPending ? "建立中…" : "產生邀請連結"}
            </button>
          </div>
          {invite.data && (
            <div style={{ marginTop: 12 }}>
              <p className="hint">複製這個連結，用 LINE 傳給夥伴（{invite.data.expiresInHours} 小時內有效）：</p>
              <input readOnly value={invite.data.inviteUrl || `${location.origin}${invite.data.inviteUrl}`} onFocus={(e) => e.target.select()} />
            </div>
          )}
          {invite.error && <p className="error">{invite.error.message}</p>}
        </aside>
      </div>
    </div>
  );
}
