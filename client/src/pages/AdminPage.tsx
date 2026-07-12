import { useState } from "react";
import { trpc } from "../api";

/** 系統自檢卡：一鍵驗證資料庫/目錄/點數/邀請/生成模式/交付引擎 */
function SelfTestCard() {
  const [result, setResult] = useState<{ ok: boolean; checks: Array<{ name: string; ok: boolean; note: string }> } | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/selftest", { credentials: "include" });
      setResult(await res.json());
    } catch (err) {
      setResult({ ok: false, checks: [{ name: "連線", ok: false, note: String(err) }] });
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="card">
      <h2>系統自檢</h2>
      <p className="hint">部署後按一下，全部 ✅ 才算就緒（資料庫/模型目錄/點數/邀請/生成/交付）。</p>
      <button className="primary" disabled={running} onClick={run}>{running ? "檢查中…" : "跑系統自檢"}</button>
      {result && (
        <div style={{ marginTop: 10 }}>
          {result.checks.map((c) => (
            <div key={c.name} style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0" }}>
              <span>{c.ok ? "✅" : "❌"}</span>
              <b style={{ minWidth: 110 }}>{c.name}</b>
              <span className="hint">{c.note}</span>
            </div>
          ))}
          <p style={{ marginTop: 6 }}>{result.ok ? "✅ 全部通過——系統就緒" : "❌ 有項目未過，把畫面截圖給智能助手"}</p>
        </div>
      )}
    </div>
  );
}

/** 管理頁（總管理/超管）：組織總覽＋邀請成員（連結用 LINE 傳） */
export function AdminPage() {
  const utils = trpc.useUtils();
  const overview = trpc.admin.overview.useQuery();
  const invite = trpc.admin.invite.useMutation({ onSuccess: () => utils.admin.overview.invalidate() });
  const createGroup = trpc.admin.createGroup.useMutation({ onSuccess: () => utils.admin.overview.invalidate() });
  const settings = trpc.quota.getSettings.useQuery();
  const saveSettings = trpc.quota.updateSettings.useMutation({ onSuccess: () => { utils.quota.getSettings.invalidate(); utils.quota.my.invalidate(); } });
  const setGroupQuota = trpc.quota.setGroupQuota.useMutation({ onSuccess: () => { utils.admin.overview.invalidate(); utils.quota.my.invalidate(); } });
  const feedback = trpc.feedback.list.useQuery();

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
              {team.groups.map((g) => (
                <div key={g.id + "-quota"} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                  <span className="hint" style={{ width: 120 }}>{g.name} 週額度</span>
                  <input type="number" min={0} style={{ width: 120 }} placeholder="跟全域"
                    onBlur={(e) => setGroupQuota.mutate({ groupId: g.id, weeklyPointsPerUser: e.target.value === "" ? null : Number(e.target.value) })} />
                  <span className="hint">空=跟全域・0=不限</span>
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

        <aside className="stack">
        <SelfTestCard />
        <div className="card">
          <h2>點數與額度（彈性・隨時可調）</h2>
          <p className="hint">空白＝不限。總預算限超管；各組週額度組長/管理員皆可調。</p>
          <label>總預算點數（全系統）</label>
          <input type="number" min={0} defaultValue={settings.data?.totalBudgetPoints ?? ""} placeholder="不限"
            onBlur={(e) => saveSettings.mutate({
              totalBudgetPoints: e.target.value === "" ? null : Number(e.target.value),
              defaultWeeklyPoints: settings.data?.defaultWeeklyPoints ?? null,
            })} />
          <label>預設每人每週上限</label>
          <input type="number" min={0} defaultValue={settings.data?.defaultWeeklyPoints ?? ""} placeholder="不限"
            onBlur={(e) => saveSettings.mutate({
              totalBudgetPoints: settings.data?.totalBudgetPoints ?? null,
              defaultWeeklyPoints: e.target.value === "" ? null : Number(e.target.value),
            })} />
          {saveSettings.error && <p className="error">{saveSettings.error.message}</p>}
          {saveSettings.isSuccess && <p className="hint" style={{ color: "var(--success)" }}>已儲存 ✓</p>}
        </div>
        <div className="card">
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
        </div>
        </aside>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>回饋彙整（{feedback.data?.length ?? 0}）</h2>
        {!feedback.data?.length && <p className="hint">還沒有回饋——夥伴用頂欄「回饋」按鈕填寫。</p>}
        {feedback.data?.map((f) => (
          <div key={f.id} className="gen-row" style={{ gridTemplateColumns: "auto 1fr" }}>
            <span className="chip">{f.userName}</span>
            <div style={{ fontSize: 13 }}>
              <span className="mono" style={{ fontSize: 11 }}>
                {Object.entries((f.scores as Record<string, number>) ?? {}).map(([k, v]) => `${k}:${v}`).join(" ")}
              </span>
              {f.best && <div>👍 {f.best}</div>}
              {f.worst && <div>🛠 {f.worst}</div>}
              {f.note && <div className="hint">{f.note}</div>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
