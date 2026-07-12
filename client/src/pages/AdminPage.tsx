import { useRef, useState } from "react";
import { trpc } from "../api";

/** 後端未設 APP_URL 時邀請連結是相對路徑，補上目前網域才是能直接貼給夥伴的完整連結 */
function toFullUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${location.origin}${url}`;
}

/** 複製鈕：成功顯示「已複製 ✓」約 2 秒（邀請連結、臨時密碼共用） */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (
    <button
      style={{ padding: "3px 12px", fontSize: 12, flex: "none" }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
          // 剪貼簿 API 在非 https 或舊瀏覽器可能不可用——退回讓使用者手動複製
          window.prompt("自動複製失敗，請手動複製：", text);
        }
      }}
    >
      {copied ? "已複製 ✓" : "複製"}
    </button>
  );
}

/**
 * 單一組的週額度輸入列。
 * 為什麼獨立成元件：admin.overview 不含 weeklyPointsPerUser（後端不在本次可改範圍），
 * 現值改從 quota.usage 取得（該查詢本就回傳 groupQuota，管理員/組長皆有權限）；
 * 並且「只在真的有改時才送出」——舊版 onBlur 無條件送出，Tab 掃過空欄就把組額度誤設回「跟全域」。
 */
function GroupQuotaRow({ group }: { group: { id: string; name: string } }) {
  const utils = trpc.useUtils();
  const usage = trpc.quota.usage.useQuery({ groupId: group.id });
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setGroupQuota = trpc.quota.setGroupQuota.useMutation({
    onSuccess: () => {
      utils.quota.usage.invalidate({ groupId: group.id });
      utils.quota.my.invalidate();
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    },
  });
  const current = usage.data?.groupQuota ?? null;
  const inputId = `group-quota-${group.id}`;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
      <label className="hint" htmlFor={inputId} style={{ width: 120, margin: 0 }}>{group.name} 週額度</label>
      {usage.isLoading ? (
        <span className="hint">載入中…</span>
      ) : (
        // defaultValue 等資料到位才掛載（上方 isLoading 守門），避免綁到未載入的空值而顯示不出現值
        <input
          id={inputId}
          type="number"
          min={0}
          style={{ width: 120 }}
          placeholder="跟全域"
          defaultValue={current ?? ""}
          onBlur={(e) => {
            const next = e.target.value === "" ? null : Number(e.target.value);
            if (next !== current) setGroupQuota.mutate({ groupId: group.id, weeklyPointsPerUser: next });
          }}
        />
      )}
      <span className="hint">空=跟全域・0=不限</span>
      {setGroupQuota.error && <span className="error" style={{ marginTop: 0 }}>{setGroupQuota.error.message}</span>}
      {saved && <span className="hint" style={{ color: "var(--success)" }}>已儲存 ✓</span>}
    </div>
  );
}

/**
 * 成員列＋管理操作（組長切換/移出組/重設密碼）。
 * 為什麼獨立成元件：每位成員要有自己的 isPending/error/臨時密碼狀態，
 * 共用一個 mutation 會讓 A 成員的錯誤與密碼顯示到 B 成員旁邊。
 */
function MemberChip({ groupId, groupName, member }: {
  groupId: string;
  groupName: string;
  member: { id?: string; name?: string; role?: "leader" | "member" };
}) {
  const utils = trpc.useUtils();
  const [tempPassword, setTempPassword] = useState("");
  const setRole = trpc.admin.setGroupRole.useMutation({ onSuccess: () => utils.admin.overview.invalidate() });
  const removeMember = trpc.admin.removeFromGroup.useMutation({ onSuccess: () => utils.admin.overview.invalidate() });
  const resetPassword = trpc.admin.resetMemberPassword.useMutation({
    onSuccess: (data) => {
      setTempPassword(data.tempPassword);
      utils.admin.overview.invalidate();
    },
  });
  const userId = member.id;
  if (!userId) return null;
  const isLeader = member.role === "leader";
  const pending = setRole.isPending || removeMember.isPending || resetPassword.isPending;
  const actionError = setRole.error ?? removeMember.error ?? resetPassword.error;
  const btn = { padding: "2px 10px", fontSize: 12 } as const;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span className="chip" style={{ margin: 0 }}>
          {member.name}
          {isLeader ? "・組長" : ""}
        </span>
        <button style={btn} disabled={pending} onClick={() => setRole.mutate({ groupId, userId, role: isLeader ? "member" : "leader" })}>
          {isLeader ? "設為組員" : "設為組長"}
        </button>
        <button
          style={btn}
          disabled={pending}
          onClick={() =>
            window.confirm(`把 ${member.name} 移出「${groupName}」？之後隨時可以再邀請回來。`) &&
            removeMember.mutate({ groupId, userId })
          }
        >
          移出組
        </button>
        <button
          style={btn}
          disabled={pending}
          onClick={() =>
            window.confirm(`重設 ${member.name} 的密碼？他會立刻被登出，要用新的臨時密碼重新登入。`) &&
            resetPassword.mutate({ userId })
          }
        >
          重設密碼
        </button>
      </div>
      {actionError && <p className="error">{actionError.message}</p>}
      {tempPassword && (
        <div className="confirm-panel" style={{ marginTop: 8, padding: "10px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
            <span>臨時密碼（只顯示這一次）：</span>
            <b style={{ fontFamily: "var(--mono)", fontSize: 15, letterSpacing: 1 }}>{tempPassword}</b>
            <CopyButton text={tempPassword} />
          </div>
          <p className="hint" style={{ marginTop: 4 }}>
            請把密碼傳給 {member.name} 本人，並提醒他妥善保存——之後登入都用這組密碼。
          </p>
        </div>
      )}
    </div>
  );
}

/** 建組輸入列：每張團隊卡自己的輸入狀態，不跟邀請表單的團隊選擇共用（互不污染） */
function CreateGroupRow({ teamId }: { teamId: string }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const createGroup = trpc.admin.createGroup.useMutation({
    onSuccess: () => {
      utils.admin.overview.invalidate();
      setName("");
    },
  });
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input aria-label="新組名稱" placeholder="新組名稱（例：文宣組）" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={!name.trim() || createGroup.isPending} onClick={() => createGroup.mutate({ teamId, name: name.trim() })}>
          {createGroup.isPending ? "建立中…" : "＋建組"}
        </button>
      </div>
      {createGroup.error && <p className="error">建組失敗：{createGroup.error.message}</p>}
    </>
  );
}

/** 建立團隊（超管限定；非超管不渲染這張卡，後端 createTeam 也會再擋一次） */
function CreateTeamCard() {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const createTeam = trpc.admin.createTeam.useMutation({
    onSuccess: () => {
      utils.admin.overview.invalidate();
      setName("");
    },
  });
  return (
    <div className="card">
      <h2>建立團隊</h2>
      <label htmlFor="new-team-name">團隊名稱</label>
      <input id="new-team-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：影音創作團隊" />
      <div style={{ marginTop: 12 }}>
        <button className="primary" disabled={!name.trim() || createTeam.isPending} onClick={() => createTeam.mutate({ name: name.trim() })}>
          {createTeam.isPending ? "建立中…" : "＋建立團隊"}
        </button>
      </div>
      {createTeam.error && <p className="error">{createTeam.error.message}</p>}
    </div>
  );
}

/** 系統自檢卡：一鍵驗證資料庫/目錄/點數/邀請/生成模式/交付引擎 */
function SelfTestCard() {
  const [result, setResult] = useState<{ ok: boolean; checks: Array<{ name: string; ok: boolean; note: string }> } | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    setErrMsg("");
    setResult(null);
    try {
      const res = await fetch("/api/selftest", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      // 403（非超管）或任何非 2xx 回應沒有 checks 陣列——直接 .map 會整頁崩掉，先分流
      if (!res.ok || !Array.isArray(data.checks)) {
        setErrMsg(data.error ?? (res.status === 403 ? "系統自檢需要超管帳號" : `自檢失敗（HTTP ${res.status}）`));
        return;
      }
      setResult(data);
    } catch (err) {
      setErrMsg(`連線失敗：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="card">
      <h2>系統自檢</h2>
      <p className="hint">部署後按一下，全部 ✅ 才算就緒（資料庫/模型目錄/點數/邀請/生成/交付）。</p>
      <button className="primary" disabled={running} onClick={run}>{running ? "檢查中…" : "跑系統自檢"}</button>
      {errMsg && <p className="error" role="alert" style={{ marginTop: 10 }}>{errMsg}</p>}
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
  const settings = trpc.quota.getSettings.useQuery();
  const feedback = trpc.feedback.list.useQuery();
  const me = trpc.auth.me.useQuery();
  const isSuperAdmin = !!me.data?.user.isSuperAdmin;

  // 邀請表單自己的狀態（建組輸入已拆到 CreateGroupRow，兩邊互不污染）
  const [email, setEmail] = useState("");
  const [inviteTeamId, setInviteTeamId] = useState("");
  const [teamRole, setTeamRole] = useState<"admin" | "member">("member");
  const [groupId, setGroupId] = useState("");
  const [groupRole, setGroupRole] = useState<"leader" | "member">("member");
  const invite = trpc.admin.invite.useMutation({
    onSuccess: () => {
      utils.admin.overview.invalidate();
      // 只清 email、保留團隊/組選擇：連續邀請同組夥伴不用重選
      setEmail("");
    },
  });

  const [settingsSaved, setSettingsSaved] = useState(false);
  const settingsSavedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveSettings = trpc.quota.updateSettings.useMutation({
    onSuccess: () => {
      utils.quota.getSettings.invalidate();
      utils.quota.my.invalidate();
      setSettingsSaved(true);
      clearTimeout(settingsSavedTimer.current);
      settingsSavedTimer.current = setTimeout(() => setSettingsSaved(false), 3000);
    },
  });

  // 全域點數欄用 ref 讀「畫面上的即時輸入」而非可能過期的快取——
  // 舊版 onBlur 拿 settings.data 舊值補另一欄，連續編輯兩欄會用舊值蓋回剛存的欄位
  const totalBudgetRef = useRef<HTMLInputElement>(null);
  const weeklyRef = useRef<HTMLInputElement>(null);
  const dailyRef = useRef<HTMLInputElement>(null);
  const saveBudget = () => {
    const data = settings.data;
    if (!data || !totalBudgetRef.current || !weeklyRef.current || !dailyRef.current) return;
    const parse = (v: string) => (v === "" ? null : Number(v));
    const totalBudgetPoints = parse(totalBudgetRef.current.value);
    const defaultWeeklyPoints = parse(weeklyRef.current.value);
    const defaultDailyPoints = parse(dailyRef.current.value);
    // 沒有變更就不送：Tab 掃過欄位不觸發無意義寫入
    if (
      totalBudgetPoints === (data.totalBudgetPoints ?? null) &&
      defaultWeeklyPoints === (data.defaultWeeklyPoints ?? null) &&
      defaultDailyPoints === (data.defaultDailyPoints ?? null)
    ) return;
    saveSettings.mutate({ totalBudgetPoints, defaultWeeklyPoints, defaultDailyPoints });
  };

  if (overview.isLoading) return <p className="hint">載入中…</p>;
  if (overview.error) return <p className="error">{overview.error.message}</p>;
  const teams = overview.data ?? [];
  const selectedTeam = teams.find((t) => t.id === (inviteTeamId || teams[0]?.id));
  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());

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
                    g.members.map((m) => <MemberChip key={m.id} groupId={g.id} groupName={g.name} member={m} />)
                  )}
                </div>
              ))}
              {team.groups.map((g) => (
                <GroupQuotaRow key={g.id + "-quota"} group={g} />
              ))}
              <CreateGroupRow teamId={team.id} />
            </section>
          ))}
        </div>

        <aside className="stack">
        {/* 系統自檢只有超管的 /api/selftest 能用——非超管按了只會 403，對他們是死功能，故只對超管顯示 */}
        {isSuperAdmin && <SelfTestCard />}
        {isSuperAdmin && <CreateTeamCard />}
        <div className="card">
          <h2>點數與額度（彈性・隨時可調）</h2>
          <p className="hint">空白＝不限。總預算限超管；各組週額度由團隊管理員在左側團隊卡調整。</p>
          {/* 載入完成才掛載輸入框：defaultValue 只在掛載時生效，先掛空欄會永遠顯示不出現值 */}
          {settings.data ? (
            <>
              <label htmlFor="settings-total-budget">總預算點數（全系統）{!isSuperAdmin && <span className="hint">・限超管調整</span>}</label>
              {/* 非超管改總預算會被後端擋（FORBIDDEN）——直接 disable 並說明，別讓人白填才報錯 */}
              <input
                id="settings-total-budget"
                ref={totalBudgetRef}
                type="number"
                min={0}
                defaultValue={settings.data.totalBudgetPoints ?? ""}
                placeholder="不限"
                onBlur={saveBudget}
                disabled={!isSuperAdmin}
                title={isSuperAdmin ? undefined : "只有超級管理員能調整全系統總預算"}
              />
              <label htmlFor="settings-weekly">預設每人每週上限</label>
              <input id="settings-weekly" ref={weeklyRef} type="number" min={0} defaultValue={settings.data.defaultWeeklyPoints ?? ""} placeholder="不限" onBlur={saveBudget} disabled={!isSuperAdmin} />
              <label htmlFor="settings-daily">每人每日上限（每天重置）</label>
              <input id="settings-daily" ref={dailyRef} type="number" min={0} defaultValue={settings.data.defaultDailyPoints ?? ""} placeholder="不限" onBlur={saveBudget} disabled={!isSuperAdmin} />
            </>
          ) : (
            <p className="hint">設定載入中…</p>
          )}
          {saveSettings.error && <p className="error">{saveSettings.error.message}</p>}
          {settingsSaved && <p className="hint" style={{ color: "var(--success)" }}>已儲存 ✓</p>}
        </div>
        <div className="card">
          <h2>邀請成員</h2>
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partner@example.com" />
          <label htmlFor="invite-team">團隊</label>
          <select id="invite-team" value={selectedTeam?.id ?? ""} onChange={(e) => { setInviteTeamId(e.target.value); setGroupId(""); }}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <label htmlFor="invite-team-role">團隊角色</label>
          <select id="invite-team-role" value={teamRole} onChange={(e) => setTeamRole(e.target.value as "admin" | "member")}>
            <option value="member">成員</option>
            <option value="admin">團隊管理員</option>
          </select>
          <p className="hint" style={{ margin: "4px 0 0" }}>團隊管理員能管理整個團隊的組別、成員與額度，權限較大，請謹慎授予。</p>
          <label htmlFor="invite-group">組別</label>
          <select id="invite-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">（先不入組）</option>
            {selectedTeam?.groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <label htmlFor="invite-group-role">組內角色</label>
          <select id="invite-group-role" value={groupRole} disabled={!groupId} onChange={(e) => setGroupRole(e.target.value as "leader" | "member")}>
            <option value="member">組員</option>
            <option value="leader">組長</option>
          </select>
          {!groupId && <p className="hint" style={{ margin: "4px 0 0" }}>未選組時角色不生效——選了組別才需要設定。</p>}
          <div style={{ marginTop: 16 }}>
            <button
              className="primary"
              disabled={!emailValid || !selectedTeam || invite.isPending}
              onClick={() =>
                invite.mutate({ email: email.trim(), teamId: selectedTeam!.id, teamRole, groupId: groupId || undefined, groupRole })
              }
            >
              {invite.isPending ? "建立中…" : "產生邀請連結"}
            </button>
          </div>
          {invite.data && invite.data.attached && (
            <p className="hint" style={{ marginTop: 12 }}>✓ {invite.data.message}</p>
          )}
          {invite.data && !invite.data.attached && invite.data.inviteUrl && (
            <div style={{ marginTop: 12 }}>
              <p className="hint">複製這個連結，用 LINE 傳給夥伴（{invite.data.expiresInHours} 小時內有效）：</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input readOnly value={toFullUrl(invite.data.inviteUrl)} onFocus={(e) => e.target.select()} />
                <CopyButton text={toFullUrl(invite.data.inviteUrl)} />
              </div>
            </div>
          )}
          {invite.error && <p className="error">{invite.error.message}</p>}
        </div>
        </aside>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>回饋彙整（{feedback.data?.length ?? 0}）</h2>
        {feedback.isLoading ? (
          <p className="hint">回饋載入中…</p>
        ) : feedback.error ? (
          <div>
            <p className="error">回饋載入失敗：{feedback.error.message}</p>
            <button style={{ marginTop: 8 }} onClick={() => feedback.refetch()}>再試一次</button>
          </div>
        ) : !feedback.data?.length ? (
          <p className="hint">還沒有回饋——夥伴用頂欄「回饋」按鈕填寫。</p>
        ) : (
          feedback.data.map((f) => (
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
          ))
        )}
      </section>
    </div>
  );
}
