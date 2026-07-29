import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";

type Member = inferRouterOutputs<AppRouter>["directory"]["list"]["members"][number];

/** 相對時間（比照 Launchpad 的 relTime；通訊錄的「最近活動」用） */
function relTime(d: string | Date | null): string {
  if (!d) return "—";
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(d).toLocaleDateString("zh-TW");
}

const badge = (style: CSSProperties): CSSProperties => ({
  fontSize: 11,
  padding: "1px 8px",
  borderRadius: 999,
  whiteSpace: "nowrap",
  ...style,
});
const ROLE_BADGE = {
  super: badge({ background: "var(--primary-tint)", color: "var(--primary-ink)", border: "1px solid var(--primary-border)" }),
  leader: badge({ background: "var(--gold-soft)", color: "var(--gold-ink)", border: "1px solid var(--gold)" }),
  member: badge({ background: "var(--card2)", color: "var(--fg-secondary)", border: "1px solid var(--border-soft)" }),
};

/**
 * 成員通訊錄（需求：團隊/組別/人員的細節）。
 * 逐人一張卡：角色（超管/組長/組員）＋ Email ＋ 所屬團隊/組別 ＋ 各組點數用量 ＋ 最近登入/操作。
 * 能看到的範圍由後端按權限過濾（開發者全部、團隊管理員自己團隊、組長自己組）。
 */
export function MembersPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [groupId, setGroupId] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const scope = trpc.directory.scope.useQuery();
  const dir = trpc.directory.list.useQuery({ q: debouncedQ.trim() || undefined, groupId: groupId || undefined });
  const me = trpc.auth.me.useQuery(); // 自己的卡不顯示「私訊」（不能私訊自己）
  const members = dir.data?.members ?? [];

  return (
    <div className="page-shell secondary-page secondary-page--reading members-page">
      <SecondaryPageHeader
        eyebrow="團隊協作"
        title="通訊錄"
        icon="User"
        badge={dir.isLoading ? "正在整理夥伴" : `${members.length} 位可見夥伴`}
        description={<>找人、看所屬團隊與最近活動，再直接開始私訊；可見範圍會依你的角色與組別自動隔離。</>}
      />

      <div className="secondary-filter-bar">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="用姓名或 Email 搜尋…"
          aria-label="搜尋成員"
          style={{ flex: "1 1 220px" }}
        />
        {(scope.data?.groups.length ?? 0) > 1 && (
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="依組別過濾" style={{ flex: "0 1 240px" }}>
            <option value="">所有可見組別</option>
            {scope.data?.groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>{g.teamName}・{g.groupName}</option>
            ))}
          </select>
        )}
      </div>

      {dir.isLoading ? (
        <div role="status" aria-label="通訊錄載入中" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 96, marginBottom: 12, borderRadius: 12 }} />
          ))}
        </div>
      ) : dir.error ? (
        // 尚無可見組別（如剛建團隊、還沒建組/加人）後端回 FORBIDDEN——對管理員是空狀態而非錯誤，給中性提示
        dir.error.data?.code === "FORBIDDEN" ? (
          <p className="hint">還沒有你能看到的組別成員。先到「團隊管理」建立組別、把夥伴加進來，這裡就會出現。</p>
        ) : (
          <p className="error" role="alert">通訊錄載入失敗：{dir.error.message}</p>
        )
      ) : members.length === 0 ? (
        <p className="hint">{debouncedQ.trim() || groupId ? "沒有符合條件的成員。" : "還沒有成員。"}</p>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 8 }}>共 {members.length} 位</p>
          {members.map((m) => (
            <MemberCard key={m.userId} m={m} isSelf={m.userId === me.data?.user.id} />
          ))}
        </>
      )}
    </div>
  );
}

function MemberCard({ m, isSelf }: { m: Member; isSelf: boolean }) {
  const isLeaderSomewhere = m.memberships.some((x) => x.role === "leader");
  return (
    <section className="card" style={{ marginBottom: 12, opacity: m.disabled ? 0.6 : 1 }}>
      {/* 標頭：姓名＋角色徽章；右端「私訊」直達站內聊天（停用帳號收不到訊息，不給入口） */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: "var(--fs-16)" }}>{m.name}</b>
        {m.isSuperAdmin && <span style={ROLE_BADGE.super}>超管</span>}
        {isLeaderSomewhere && <span style={ROLE_BADGE.leader}>組長</span>}
        {!m.isSuperAdmin && !isLeaderSomewhere && <span style={ROLE_BADGE.member}>組員</span>}
        {m.disabled && <span style={badge({ background: "var(--danger-soft, var(--card2))", color: "var(--danger-ink)", border: "1px solid var(--border-soft)" })}>已停用</span>}
        {isSelf && <span style={ROLE_BADGE.member}>我</span>}
        {!isSelf && !m.disabled && (
          <Link
            href={`/chat/${m.userId}`}
            className="btn-tonal btn-sm"
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
            title={`私訊 ${m.name}——站內一對一聊天`}
          >
            <Icon name="MessageCircle" size={13} />私訊
          </Link>
        )}
      </div>

      {/* Email：可直接點開寄信 */}
      <div className="hint" style={{ fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 4, overflowWrap: "anywhere" }}>
        <Icon name="MessageCircle" size={12} />
        <a href={`mailto:${m.email}`} style={{ color: "inherit" }}>{m.email}</a>
      </div>

      {/* 所屬團隊/組別＋各組點數用量：一列一組，右邊接點數（本週用量＋個人預算） */}
      <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
        {m.memberships.map((g) => (
          <div key={g.groupId} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Icon name="User" size={12} />{g.teamName}・{g.groupName}
              <span style={g.role === "leader" ? ROLE_BADGE.leader : ROLE_BADGE.member}>{g.role === "leader" ? "組長" : "組員"}</span>
            </span>
            <span className="hint" style={{ marginLeft: "auto" }}>
              本週 {g.weeklyUsed} 點
              {g.budget != null && `・個人預算 ${g.totalUsed}／${g.budget}`}
            </span>
          </div>
        ))}
      </div>

      {/* 最近活動：登入與最後操作 */}
      <div className="hint" style={{ fontSize: 11, marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <Icon name="Clock" size={11} />最近登入 {relTime(m.lastLoginAt)}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <Icon name="CheckCircle2" size={11} />
          {m.lastActionLabel ? `最後操作「${m.lastActionLabel}」${relTime(m.lastActionAt)}` : "尚無操作紀錄"}
        </span>
      </div>
    </section>
  );
}
