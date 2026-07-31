import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Card, Hint, Meta, Skeleton } from "../components/ui";
import type { GroupCommandLevel } from "@shared/groupAgent";
type Member = inferRouterOutputs<AppRouter>["directory"]["list"]["members"][number];

/* ── 組代理指揮權（分級授權）的設定介面 ──
 *
 * 為什麼這段放在通訊錄檔案裡、還 export 給 AdminPage 用：授權等級的人話標籤與說明是「使用者看到的規則」，
 * 兩個頁面各抄一份的話，遲早會出現「這頁說 supervise 只能看、那頁說能核准」的矛盾文案——
 * 而這條說明正是使用者判斷「要不要把花錢的權力交出去」的唯一依據，不能有兩個版本。
 * 方向選擇（通訊錄 → AdminPage）只是打包考量：這支檔案小，反向 import 會把兩千多行的管理頁塞進通訊錄的 chunk。
 */

/**
 * 四級授權的人話標籤與「這一級到底能做什麼」。
 * 說明刻意講後果而不是名詞：使用者要知道的不是「supervise 是什麼」，
 * 而是「給了這一級，這個人就能在我沒看著的時候花掉組裡的點數」。
 */
export const COMMAND_LEVEL_OPTIONS: Array<{ value: GroupCommandLevel; label: string; detail: string }> = [
  { value: "none", label: "不可用", detail: "只能用組代理問問題，不能下任何指令。" },
  { value: "dispatch", label: "可派工", detail: "可以請組代理在專案發起 AI 執行計畫，但計畫要有人核准才會開始花點。" },
  {
    value: "supervise",
    label: "可監督",
    detail: "除了派工，還能替別人核准／停止／放棄／重跑計畫——核准的那一刻就開始花點，等於把花錢的權力交出去。",
  },
  {
    value: "command",
    label: "可總指揮",
    detail: "可以讓組代理自己規劃一整份調度計畫、派完工自動盯著，並在授權點數上限內自動核准子計畫（無人看著時也會花點）。",
  },
];

const COMMAND_LEVEL_LABEL: Record<GroupCommandLevel, string> = Object.fromEntries(
  COMMAND_LEVEL_OPTIONS.map((o) => [o.value, o.label]),
) as Record<GroupCommandLevel, string>;

/** 這一級的說明（找不到就回空字串——UI 少一行字，不要炸掉整列） */
export function describeCommandLevel(level: GroupCommandLevel): string {
  return COMMAND_LEVEL_OPTIONS.find((o) => o.value === level)?.detail ?? "";
}

/**
 * 單一組員的指揮權選單（通訊錄與團隊管理頁共用）。
 *
 * 為什麼用四級下拉而不是原本的「可派工」開關：等級已經在後端全面生效，只給布林的話
 * 「可監督／可總指揮」根本設不出來，做好的分級授權對一般組員等於不存在。
 * 自己的等級不給改（後端也擋）——能自升的授權等於沒有授權。
 */
export function CommandLevelField({ groupId, userId, level, isSelf, onSaved }: {
  groupId: string;
  userId: string;
  level: GroupCommandLevel;
  /** 對自己只顯示現況：提權必須由上層來，不能自己按 */
  isSelf?: boolean;
  onSaved?: () => void;
}) {
  const setLevel = trpc.quota.setMemberCommandLevel.useMutation({ onSuccess: onSaved });
  const fieldId = `command-level-${groupId}-${userId}`;
  // 送出中先顯示使用者剛選的值：等 invalidate 回來才更新的話，選單會彈回舊值看起來像沒存到
  const shown = (setLevel.isPending && setLevel.variables?.level) || level;
  if (isSelf) {
    return (
      <Meta style={{ fontSize: 11 }}>組代理指揮權：{COMMAND_LEVEL_LABEL[shown]}（自己的授權需由團隊管理員以上調整）</Meta>
    );
  }
  return (
    <div style={{ display: "grid", gap: 2, minWidth: 220 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <label className="hint" htmlFor={fieldId} style={{ margin: 0 }}>組代理指揮權</label>
        <select
          id={fieldId}
          value={shown}
          disabled={setLevel.isPending}
          style={{ width: "auto", flex: "0 1 150px" }}
          onChange={(e) => setLevel.mutate({ groupId, userId, level: e.target.value as GroupCommandLevel })}
        >
          {COMMAND_LEVEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {setLevel.isPending && <Meta>儲存中…</Meta>}
      </div>
      <Hint layer="always" style={{ margin: 0, fontSize: 11 }}>{describeCommandLevel(shown)}</Hint>
      {setLevel.error && <span className="error" style={{ marginTop: 0, fontSize: 11 }}>{setLevel.error.message}</span>}
    </div>
  );
}

/**
 * 通訊錄裡的指揮權設定列：只在「目前聚焦、且我管得到的組」出現（見 MembersPage 的 focusGroupId）。
 *
 * 現值走 quota.usage（組長以上才讀得到，與設定權限同一把尺）；同一組的多張成員卡共用同一個查詢鍵，
 * React Query 會自動去重，不會因為卡片多就打出一堆重複請求。
 */
function MembershipCommandLevel({ groupId, userId, isSelf }: { groupId: string; userId: string; isSelf: boolean }) {
  const utils = trpc.useUtils();
  const usage = trpc.quota.usage.useQuery({ groupId });
  const row = usage.data?.rows.find((r) => r.userId === userId);
  if (usage.isLoading) return <Skeleton style={{ height: 22, width: 200, borderRadius: 8 }} />;
  if (usage.error) return <Meta style={{ fontSize: 11 }}>指揮權現況載入失敗：{usage.error.message}</Meta>;
  // 讀不到這個人（剛被移出組、清單還沒重整）就不畫控制項——寧可少一個入口，也不要送出一個猜出來的等級
  if (!row) return null;
  if (row.role !== "member") return <Meta style={{ fontSize: 11 }}>組長以上恆為「可總指揮」</Meta>;
  return (
    <CommandLevelField
      groupId={groupId}
      userId={userId}
      level={row.commandLevel}
      isSelf={isSelf}
      onSaved={() => utils.quota.usage.invalidate({ groupId })}
    />
  );
}

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
  // 我管得到的組（directory.scope 只回「非純組員」身分的組，與 quota 的設定權限同一把尺）——
  // 指揮權設定只在這些組出現：對管不到的組畫出選單，使用者按了只會吃 FORBIDDEN。
  const manageableGroupIds = (scope.data?.groups ?? []).map((g) => g.groupId);
  /**
   * 就地調整指揮權的「聚焦組」：已選過濾組別時就是它；只管一個組的人不必再選一次。
   *
   * 為什麼要限定單一組而不是每段組籍都畫：現值得讀 quota.usage（含用量彙總的重查詢），
   * 管十個組的人一打開通訊錄就會同時打十支——為了一個偶爾才用的設定拖慢整頁不划算。
   */
  const focusGroupId = manageableGroupIds.includes(groupId)
    ? groupId
    : (manageableGroupIds.length === 1 ? manageableGroupIds[0] : "");

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
            <Skeleton key={i} style={{ height: 96, marginBottom: 12, borderRadius: 12 }} />
          ))}
        </div>
      ) : dir.error ? (
        // 尚無可見組別（如剛建團隊、還沒建組/加人）後端回 FORBIDDEN——對管理員是空狀態而非錯誤，給中性提示
        dir.error.data?.code === "FORBIDDEN" ? (
          <Hint layer="always">還沒有你能看到的組別成員。先到「團隊管理」建立組別、把夥伴加進來，這裡就會出現。</Hint>
        ) : (
          <p className="error" role="alert">通訊錄載入失敗：{dir.error.message}</p>
        )
      ) : members.length === 0 ? (
        <Hint layer="always">{debouncedQ.trim() || groupId ? "沒有符合條件的成員。" : "還沒有成員。"}</Hint>
      ) : (
        <>
          <Meta as="p" style={{ marginBottom: 8 }}>共 {members.length} 位</Meta>
          {/* 沒聚焦到單一組時，指揮權設定不會出現——講清楚怎麼叫出來，否則組長會以為這裡根本沒有這個設定 */}
          {!focusGroupId && manageableGroupIds.length > 1 && (
            <Hint layer="always" style={{ marginBottom: 8 }}>
              先在上方選一個組別，就能在每位組員底下直接調整他的「組代理指揮權」。
            </Hint>
          )}
          {members.map((m) => (
            <MemberCard key={m.userId} m={m} isSelf={m.userId === me.data?.user.id} focusGroupId={focusGroupId} />
          ))}
        </>
      )}
    </div>
  );
}

function MemberCard({ m, isSelf, focusGroupId }: { m: Member; isSelf: boolean; /** 目前聚焦、且我管得到的組（空字串＝不顯示指揮權設定） */ focusGroupId: string }) {
  const isLeaderSomewhere = m.memberships.some((x) => x.role === "leader");
  return (
    <Card as="section" style={{ marginBottom: 12, opacity: m.disabled ? 0.6 : 1 }}>
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
      <Meta as="div" style={{ fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 4, overflowWrap: "anywhere" }}>
        <Icon name="MessageCircle" size={12} />
        <a href={`mailto:${m.email}`} style={{ color: "inherit" }}>{m.email}</a>
      </Meta>

      {/* 所屬團隊/組別＋各組點數用量：一列一組，右邊接點數（本週用量＋個人預算） */}
      <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
        {m.memberships.map((g) => (
          <div key={g.groupId} style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <Icon name="User" size={12} />{g.teamName}・{g.groupName}
                <span style={g.role === "leader" ? ROLE_BADGE.leader : ROLE_BADGE.member}>{g.role === "leader" ? "組長" : "組員"}</span>
              </span>
              <Meta style={{ marginLeft: "auto" }}>
                本週 {g.weeklyUsed} 點
                {g.budget != null && `・個人預算 ${g.totalUsed}／${g.budget}`}
              </Meta>
            </div>
            {/* 組代理指揮權：組長就是在這裡把組員升到「可監督」以上——先前這個等級沒有任何地方設得出來 */}
            {g.groupId === focusGroupId && !m.disabled && (
              <MembershipCommandLevel groupId={g.groupId} userId={m.userId} isSelf={isSelf} />
            )}
          </div>
        ))}
      </div>

      {/* 最近活動：登入與最後操作 */}
      <Meta as="div" style={{ fontSize: 11, marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <Icon name="Clock" size={11} />最近登入 {relTime(m.lastLoginAt)}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <Icon name="CheckCircle2" size={11} />
          {m.lastActionLabel ? `最後操作「${m.lastActionLabel}」${relTime(m.lastActionAt)}` : "尚無操作紀錄"}
        </span>
      </Meta>
    </Card>
  );
}
