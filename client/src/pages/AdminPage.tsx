import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUS_LABEL } from "@shared/options";
import { AUDIT_ACTION_LABELS, AUDIT_CATEGORIES, auditCategoryOf, describeAuditInput, groupConsecutiveAudit, humanizeAuditAction, summarizeAuditInput } from "@shared/auditWording";
import { getModel, tierLabel } from "@shared/models";
import { toCsv } from "@shared/csv";
import { formatTwd, formatUsd, moneyFxNote } from "@shared/money";

import { Button, Card, Chip, EmptyState, Hint, Meta, Pill, Skeleton } from "../components/ui";
/** 分類配色：對應設計系統既有 accent tokens（-soft/-tint 底＋-ink 字＋對應邊，比照 .pill 安靜標籤，不搶戲、過 AA） */
const FEEDBACK_CATEGORY_STYLE: Record<string, { background: string; color: string; border: string }> = {
  bug: { background: "var(--primary-tint)", color: "var(--primary-ink)", border: "1px solid var(--primary-border)" },
  uiux: { background: "var(--gold-soft)", color: "var(--gold-ink)", border: "1px solid var(--gold)" },
  feature: { background: "var(--success-soft)", color: "var(--success-ink)", border: "1px solid var(--success)" },
  stuck: { background: "var(--healing-soft)", color: "var(--healing-ink)", border: "1px solid var(--healing)" },
  other: { background: "var(--card2)", color: "var(--fg-secondary)", border: "1px solid var(--border-soft)" },
};
const FEEDBACK_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  FEEDBACK_CATEGORIES.map((c) => [c.value, c.label]),
);

/** 回饋代理分診嚴重度：標籤＋配色（沿用既有 accent tokens） */
const AGENT_SEVERITY_META: Record<string, { label: string; style: { background: string; color: string; border: string } }> = {
  high: { label: "高", style: { background: "var(--primary-tint)", color: "var(--primary-ink)", border: "1px solid var(--primary-border)" } },
  medium: { label: "中", style: { background: "var(--gold-soft)", color: "var(--gold-ink)", border: "1px solid var(--gold)" } },
  low: { label: "低", style: { background: "var(--card2)", color: "var(--fg-secondary)", border: "1px solid var(--border-soft)" } },
};

/** 回覆信寄送狀態的人話標籤（回饋代理寄給回報者） */
const EMAIL_STATUS_LABEL: Record<string, string> = {
  sent: "已寄回覆信",
  skipped: "回覆已草擬（信箱機制未設定）",
  failed: "回覆信寄送失敗",
};

/** 狀態過濾 chips（全部＝空字串） */
const FEEDBACK_STATUS_FILTERS: Array<{ value: "" | "open" | "reviewing" | "done"; label: string }> = [
  { value: "", label: "全部" },
  { value: "open", label: FEEDBACK_STATUS_LABEL.open },
  { value: "reviewing", label: FEEDBACK_STATUS_LABEL.reviewing },
  { value: "done", label: FEEDBACK_STATUS_LABEL.done },
];

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
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 12px", fontSize: "var(--fs-12)", flex: "none" }}
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
      {copied ? <><Icon name="Check" size={12} />已複製</> : "複製"}
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
        <span className="skeleton" style={{ display: "inline-block", height: 40, width: 120, borderRadius: "var(--r-12)" }} aria-hidden="true" />
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
      <Hint as="span" layer="always">空=跟全域・0=不限</Hint>
      {setGroupQuota.error && <span className="error" style={{ marginTop: 0 }}>{setGroupQuota.error.message}</span>}
      {saved && <Meta style={{ color: "var(--success-ink)" }}>已儲存 ✓</Meta>}
    </div>
  );
}

/**
 * 單一組的「組預算」輸入列（累計上限）：開發者/團隊管理員把總點數池分配給這個組。
 * 與週額度並列在團隊卡；讀值同走 quota.usage（回傳 groupBudget/groupUsed/allocated）。
 * 只在真的有改時才送出（同 GroupQuotaRow：避免 Tab 掃過空欄把組預算誤清成「不限」）。
 */
function GroupBudgetRow({ group }: { group: { id: string; name: string } }) {
  const utils = trpc.useUtils();
  const usage = trpc.quota.usage.useQuery({ groupId: group.id });
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setGroupBudget = trpc.quota.setGroupBudget.useMutation({
    onSuccess: () => {
      utils.quota.usage.invalidate({ groupId: group.id });
      utils.quota.my.invalidate();
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    },
  });
  const current = usage.data?.groupBudget ?? null;
  const used = usage.data?.groupUsed ?? 0;
  const allocated = usage.data?.allocated ?? 0;
  const inputId = `group-budget-${group.id}`;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
      <label className="hint" htmlFor={inputId} style={{ width: 120, margin: 0 }}>{group.name} 組預算</label>
      {usage.isLoading ? (
        <span className="skeleton" style={{ display: "inline-block", height: 40, width: 120, borderRadius: "var(--r-12)" }} aria-hidden="true" />
      ) : (
        <input
          id={inputId}
          type="number"
          min={0}
          style={{ width: 120 }}
          placeholder="不限"
          defaultValue={current ?? ""}
          onBlur={(e) => {
            const next = e.target.value === "" ? null : Number(e.target.value);
            if (next !== current) setGroupBudget.mutate({ groupId: group.id, budgetPoints: next });
          }}
        />
      )}
      {/* 累計點數池：給開發者看「這組發了多少、用了多少、組長分下去多少」——空=不限 */}
      <Meta>
        {current != null ? `已用 ${used}／${current}・已分給組員 ${allocated}` : "空=不限（累計總量）"}
      </Meta>
      {setGroupBudget.error && <span className="error" style={{ marginTop: 0 }}>{setGroupBudget.error.message}</span>}
      {saved && <Meta style={{ color: "var(--success-ink)" }}>已儲存 ✓</Meta>}
    </div>
  );
}

/** 相對時間（比照通訊錄的 relTime；成員「最近登入」與專案「最近更新」用） */
function relTime(d: string | Date | null | undefined): string {
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

type GroupDetail = inferRouterOutputs<AppRouter>["admin"]["groupDetail"];
type GroupDetailMember = GroupDetail["members"][number];

/** 角色徽章（與通訊錄同語彙：超管／組長／組員） */
const ROLE_BADGE_STYLE: Record<"super" | "leader" | "member", CSSProperties> = {
  super: { background: "var(--primary-tint)", color: "var(--primary-ink)", border: "1px solid var(--primary-border)" },
  leader: { background: "var(--gold-soft)", color: "var(--gold-ink)", border: "1px solid var(--gold)" },
  member: { background: "var(--card2)", color: "var(--fg-secondary)", border: "1px solid var(--border-soft)" },
};
function RoleBadge({ kind, children }: { kind: "super" | "leader" | "member"; children: string }) {
  return (
    <Pill style={{ ...ROLE_BADGE_STYLE[kind], fontSize: 11, padding: "1px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {children}
    </Pill>
  );
}

/**
 * 單一成員的數值欄（個人預算／週額度覆寫共用）：只在真的有改時才送出
 * （同 GroupQuotaRow 的教訓——onBlur 無條件送出會讓 Tab 掃過空欄誤清設定）。
 */
function MemberNumberField({ label, current, placeholder, hint, width = 88, onSave, saving, error }: {
  label: string;
  current: number | null;
  placeholder: string;
  hint?: string;
  width?: number;
  onSave: (next: number | null) => void;
  saving: boolean;
  error?: string | null;
}) {
  return (
    <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, fontSize: 12 }}>
      {label}
      <input
        type="number"
        min={0}
        style={{ width, padding: "3px 8px", fontSize: 12 }}
        placeholder={placeholder}
        defaultValue={current ?? ""}
        disabled={saving}
        title={hint}
        onBlur={(e) => {
          const next = e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0);
          if (next !== current) onSave(next);
        }}
      />
      {error && <span className="error" style={{ marginTop: 0, fontSize: 11 }}>{error}</span>}
    </label>
  );
}

/**
 * 成員細節列（團隊管理細節補齊）：一列看完一位夥伴——
 * 角色徽章＋Email＋最近登入＋本週/累計點數，加上就地可調的個人預算、週額度覆寫、派工授權，
 * 以及既有管理操作（組長切換/移出組/重設密碼）。
 * 為什麼獨立成元件：每位成員要有自己的 isPending/error/臨時密碼狀態，
 * 共用一個 mutation 會讓 A 成員的錯誤與密碼顯示到 B 成員旁邊。
 */
function MemberDetailRow({ groupId, groupName, member, canResetPassword, isSelf }: {
  groupId: string;
  groupName: string;
  member: GroupDetailMember;
  /** 後端會擋「開發者/他團管理員」——注定失敗的重設鈕直接不畫，別讓管理員按了才吃 FORBIDDEN */
  canResetPassword: boolean;
  isSelf: boolean;
}) {
  const utils = trpc.useUtils();
  const [tempPassword, setTempPassword] = useState("");
  const invalidate = () => {
    utils.admin.overview.invalidate();
    utils.admin.groupDetail.invalidate({ groupId });
    utils.quota.usage.invalidate({ groupId });
  };
  const setRole = trpc.admin.setGroupRole.useMutation({ onSuccess: invalidate });
  const removeMember = trpc.admin.removeFromGroup.useMutation({ onSuccess: invalidate });
  const resetPassword = trpc.admin.resetMemberPassword.useMutation({
    onSuccess: (data) => {
      setTempPassword(data.tempPassword);
      invalidate();
    },
  });
  const setBudget = trpc.quota.setMemberBudget.useMutation({ onSuccess: invalidate });
  const setOverride = trpc.quota.setMemberOverride.useMutation({ onSuccess: invalidate });
  const setDispatch = trpc.quota.setMemberDispatch.useMutation({ onSuccess: invalidate });
  const userId = member.userId;
  const isLeader = member.role === "leader";
  const pending = setRole.isPending || removeMember.isPending || resetPassword.isPending;
  const actionError = setRole.error ?? removeMember.error ?? resetPassword.error ?? setDispatch.error;
  const btn = { padding: "2px 10px", fontSize: "var(--fs-12)" } as const;
  return (
    <div style={{ borderTop: "1px solid var(--border-soft)", padding: "8px 0" }}>
      {/* 第一列：身分與管理操作 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13 }}>{member.name}</b>
        {member.isSuperAdmin && <RoleBadge kind="super">超管</RoleBadge>}
        <RoleBadge kind={isLeader ? "leader" : "member"}>{isLeader ? "組長" : "組員"}</RoleBadge>
        {member.disabled && (
          <Pill style={{ fontSize: 11, padding: "1px 8px", borderRadius: 999, color: "var(--danger-ink)", border: "1px solid var(--border-soft)" }}>已停用</Pill>
        )}
        <a className="hint" href={`mailto:${member.email}`} style={{ fontSize: 12, color: "inherit", overflowWrap: "anywhere" }}>{member.email}</a>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          <button style={btn} disabled={pending} onClick={() => setRole.mutate({ groupId, userId, role: isLeader ? "member" : "leader" })}>
            {isLeader ? "設為組員" : "設為組長"}
          </button>
          {/* 破壞性/次危險動作補全站慣例的 --danger-ink：掃視成員列時能一眼與「設為組長」等中性鈕區分 */}
          <ConfirmButton
            triggerStyle={{ ...btn, color: "var(--danger-ink)" }}
            disabled={pending}
            message={`把 ${member.name} 移出「${groupName}」？之後隨時可以再邀請回來。`}
            onConfirm={() => removeMember.mutate({ groupId, userId })}
          >
            移出組
          </ConfirmButton>
          {canResetPassword && (
            <ConfirmButton
              triggerStyle={{ ...btn, color: "var(--danger-ink)" }}
              disabled={pending}
              message={`重設 ${member.name} 的密碼？他會立刻被登出，要用新的臨時密碼重新登入。`}
              onConfirm={() => resetPassword.mutate({ userId })}
            >
              重設密碼
            </ConfirmButton>
          )}
        </span>
      </div>
      {/* 第二列：活動與點數近況 */}
      <Meta as="div" style={{ fontSize: 11, marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <Icon name="Clock" size={11} />最近登入 {relTime(member.lastLoginAt)}
        </span>
        <span>本週 {member.weekly.toLocaleString()} 點・累計 {member.total.toLocaleString()} 點{member.budget != null && `（個人預算 ${member.budget.toLocaleString()}）`}</span>
      </Meta>
      {/* 第三列：就地可調的個人額度（比照組長「選項」頁同一套 quota mutation） */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
        <MemberNumberField
          label="個人預算"
          current={member.budget}
          placeholder="不限"
          hint="從組預算再分配給這位成員的累計上限；空＝不限"
          onSave={(next) => setBudget.mutate({ groupId, userId, budgetPoints: next })}
          saving={setBudget.isPending}
          error={setBudget.error?.message ?? null}
        />
        <MemberNumberField
          label="週額度"
          current={member.weeklyOverride}
          placeholder="跟組"
          hint="個人每週點數覆寫；空＝跟組設定、0＝不限"
          onSave={(next) => setOverride.mutate({ groupId, userId, weeklyPointsOverride: next })}
          saving={setOverride.isPending}
          error={setOverride.error?.message ?? null}
        />
        {member.role === "member" ? (
          <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={member.canDispatch}
              disabled={setDispatch.isPending}
              onChange={(e) => setDispatch.mutate({ groupId, userId, canDispatch: e.target.checked })}
            />
            可派工 AI 執行計畫
          </label>
        ) : (
          <Hint as="span" style={{ fontSize: 11 }}>組長以上恆可派工 AI 執行計畫</Hint>
        )}
        {isSelf && <Meta style={{ fontSize: 11 }}>（我）</Meta>}
      </div>
      {actionError && <p className="error">{actionError.message}</p>}
      {tempPassword && (
        <div className="confirm-panel" style={{ marginTop: 8, padding: "10px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
            <span>臨時密碼（只顯示這一次）：</span>
            <b style={{ fontFamily: "var(--mono)", fontSize: 15, letterSpacing: 1 }}>{tempPassword}</b>
            <CopyButton text={tempPassword} />
          </div>
          <Hint layer="always" style={{ marginTop: 4 }}>
            請把密碼傳給 {member.name} 本人；他用這組密碼登入後，可從頂欄「改密碼」換成自己的密碼。
          </Hint>
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
          {createGroup.isPending ? "建立中…" : <><Icon name="Plus" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />建組</>}
        </button>
      </div>
      {createGroup.error && <p className="error">建組失敗：{createGroup.error.message}</p>}
    </>
  );
}

/** AI／MCP 存取等級的人話標籤（資料庫清單用；與資料庫頁同語意） */
const AGENT_ACCESS_LABEL: Record<string, string> = {
  none: "AI 不可見",
  read: "AI 唯讀",
  write: "AI 可讀寫",
};

/** 資料庫清單（組資料庫／團隊資料庫共用）：名稱＋列/文件/欄位數＋寫入與 AI 存取設定＋建立者 */
function DatabaseList({ databases }: { databases: GroupDetail["databases"] }) {
  if (databases.length === 0) {
    return <Hint layer="always" style={{ margin: "6px 0 0", fontSize: 12 }}>還沒有這個範圍的資料庫——到「資料庫」頁即可建立。</Hint>;
  }
  return (
    <div style={{ marginTop: 4 }}>
      {databases.map((d) => (
        <div key={d.id} style={{ borderTop: "1px solid var(--border-soft)", padding: "6px 0", fontSize: 12 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Icon name="Database" size={12} />
            <b>{d.name}</b>
            <Meta>{d.rowCount} 列・{d.fileCount} 份文件・{d.fieldCount} 個欄位</Meta>
            <Meta style={{ marginLeft: "auto", fontSize: 11 }}>更新 {relTime(d.updatedAt)}</Meta>
          </div>
          <Meta as="div" style={{ fontSize: 11, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span>{d.memberWritable ? "成員可寫" : "僅管理者可寫"}</span>
            <span>{AGENT_ACCESS_LABEL[d.agentAccess] ?? d.agentAccess}</span>
            <span>建立者 {d.creatorName}</span>
            {d.description && <span style={{ overflowWrap: "anywhere" }}>{d.description}</span>}
          </Meta>
        </div>
      ))}
    </div>
  );
}

/** 專案狀態白話標籤（active 之外目前只有 archived） */
const PROJECT_STATUS_LABEL: Record<string, string> = { active: "進行中", archived: "已封存" };

/**
 * 專案列＋負責人轉移。獨立成元件：每個專案要有自己的 mutation 狀態，
 * 共用會讓 A 專案的錯誤顯示到 B 專案旁邊。
 */
function ProjectOwnerRow({ groupId, project, members }: {
  groupId: string;
  project: GroupDetail["projects"][number];
  members: GroupDetail["members"];
}) {
  const utils = trpc.useUtils();
  const setOwner = trpc.projects.setOwner.useMutation({
    onSuccess: () => utils.admin.groupDetail.invalidate({ groupId }),
  });
  // 負責人可能已離組（不在成員列）：補一個唯讀選項顯示現況，避免下拉顯示成別人
  const ownerInList = members.some((m) => m.userId === project.owner.userId);
  return (
    <div style={{ borderTop: "1px solid var(--border-soft)", padding: "6px 0", fontSize: 12 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Icon name="FileText" size={12} />
        <b style={{ overflowWrap: "anywhere" }}>{project.title}</b>
        {project.status !== "active" && (
          <Pill style={{ fontSize: 11, padding: "1px 8px", borderRadius: 999, background: "var(--card2)", color: "var(--fg-secondary)", border: "1px solid var(--border-soft)" }}>
            {PROJECT_STATUS_LABEL[project.status] ?? project.status}
          </Pill>
        )}
        <Meta style={{ fontSize: 11 }}>{project.kind}・{project.platform}</Meta>
        <Meta style={{ marginLeft: "auto", fontSize: 11 }}>更新 {relTime(project.updatedAt)}</Meta>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
        <label className="hint" htmlFor={`project-owner-${project.id}`} style={{ margin: 0, fontSize: 12 }}>負責人</label>
        <select
          id={`project-owner-${project.id}`}
          style={{ width: "auto", padding: "3px 10px", fontSize: 12 }}
          value={project.owner.userId}
          disabled={setOwner.isPending}
          onChange={(e) => setOwner.mutate({ projectId: project.id, userId: e.target.value })}
        >
          {!ownerInList && (
            <option value={project.owner.userId}>
              {project.owner.name ? `${project.owner.name}（已離組）` : "（已離開的成員）"}
            </option>
          )}
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.name}{m.role === "leader" ? "・組長" : ""}</option>
          ))}
        </select>
        {setOwner.isPending && <Meta style={{ fontSize: 11 }}>轉移中…</Meta>}
        {setOwner.error && <span className="error" style={{ marginTop: 0, fontSize: 11 }}>{setOwner.error.message}</span>}
      </div>
    </div>
  );
}

/** 收合小節的共用樣式（成員之下的專案／資料庫細節；預設收合、summary 帶數量） */
function DetailBlock({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", listStyle: "none" }}>
        <Icon name="ChevronRight" size={14} className="details-caret" />
        <b>{title}</b>
        <Meta style={{ fontSize: 12 }}>（{count}）</Meta>
      </summary>
      {children}
    </details>
  );
}

/**
 * 組區塊（團隊管理細節補齊的主體）：組長組員的完整細節列、專案與負責人、這一組自己的資料庫，
 * 加上既有的組預算/週額度列。資料來自 admin.groupDetail（一組一查，後端已按團隊管理權過濾）。
 */
function GroupSection({ group, teamAdmins, isSuperAdmin, meId }: {
  group: { id: string; name: string };
  teamAdmins: Array<{ id?: string } | undefined>;
  isSuperAdmin: boolean;
  meId: string | undefined;
}) {
  const detail = trpc.admin.groupDetail.useQuery({ groupId: group.id });
  return (
    <div style={{ marginTop: 14, paddingTop: 4 }}>
      <h3 style={{ fontSize: "var(--fs-16)", margin: "0 0 2px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {group.name}
        {detail.data && (
          <Meta style={{ fontSize: 12, fontWeight: 400 }}>
            {detail.data.members.length} 位成員
            {detail.data.members.some((m) => m.role === "leader")
              ? `・組長：${detail.data.members.filter((m) => m.role === "leader").map((m) => m.name).join("、")}`
              : "・尚未指定組長"}
          </Meta>
        )}
      </h3>
      {detail.isLoading ? (
        <div role="status" aria-label="組詳情載入中">
          <Skeleton style={{ height: 48, marginTop: 8 }} />
        </div>
      ) : detail.error ? (
        <p className="error">
          組詳情載入失敗：{detail.error.message}
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => detail.refetch()}>再試一次</Button>
        </p>
      ) : detail.data ? (
        <>
          {detail.data.members.length === 0 ? (
            <Hint layer="always" style={{ margin: "4px 0 0" }}>（還沒有成員——用右側「邀請成員」把夥伴加進來）</Hint>
          ) : (
            detail.data.members.map((m) => (
              <MemberDetailRow
                key={m.userId}
                groupId={group.id}
                groupName={group.name}
                member={m}
                isSelf={m.userId === meId}
                // 與後端權限階梯一致：開發者重設任何人；團隊管理員不能重設開發者與其他管理員（自己除外）
                canResetPassword={
                  isSuperAdmin ||
                  (!m.isSuperAdmin && (m.userId === meId || !teamAdmins.some((a) => a?.id === m.userId)))
                }
              />
            ))
          )}
          <GroupBudgetRow group={group} />
          <GroupQuotaRow group={group} />
          <DetailBlock title="專案與負責人" count={detail.data.projects.length}>
            {detail.data.projects.length === 0 ? (
              <Meta as="p" style={{ margin: "6px 0 0", fontSize: 12 }}>這個組還沒有專案。</Meta>
            ) : (
              <>
                <Hint style={{ margin: "4px 0 0", fontSize: 11 }}>負責人＝專案的裁決點（可封存/還原）。人員異動時在這裡把專案交接給還在組裡的人。</Hint>
                {detail.data.projects.map((p) => (
                  <ProjectOwnerRow key={p.id} groupId={group.id} project={p} members={detail.data.members} />
                ))}
              </>
            )}
          </DetailBlock>
          <DetailBlock title="組資料庫" count={detail.data.databases.length}>
            <Meta as="p" style={{ margin: "4px 0 0", fontSize: 11 }}>
              這一組自己的資料庫（組範圍）。各成員的「個人資料庫」是私人空間、只有本人看得到，這裡不列。
            </Meta>
            <DatabaseList databases={detail.data.databases} />
          </DetailBlock>
        </>
      ) : null}
    </div>
  );
}

/**
 * 團隊層細節（admin.teamDetail）：已入團但「還沒進任何組」的成員（舊版總覽的隱形人）
 * ＋團隊範圍的資料庫。
 */
function TeamExtras({ teamId }: { teamId: string }) {
  const detail = trpc.admin.teamDetail.useQuery({ teamId });
  if (detail.isLoading || detail.error || !detail.data) return null; // 團隊層附加資訊——載不到不擋整卡（組區塊自己會報錯）
  const unassigned = detail.data.members.filter((m) => !m.inAnyGroup && m.role !== "admin");
  return (
    <>
      {unassigned.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Meta as="p" style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>已入團、尚未分組（{unassigned.length}）</Meta>
          <Hint layer="always" style={{ margin: "2px 0 4px", fontSize: 11 }}>這些夥伴看不到任何組的專案——用右側「邀請成員」輸入同一個 Email 並選好組別即可入組。</Hint>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {unassigned.map((m) => (
              <Chip key={m.userId} style={{ margin: 0, opacity: m.disabled ? 0.6 : 1 }} title={m.email}>
                {m.name}{m.disabled ? "・已停用" : ""}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {detail.data.databases.length > 0 && (
        <DetailBlock title="團隊資料庫" count={detail.data.databases.length}>
          <Hint layer="always" style={{ margin: "4px 0 0", fontSize: 11 }}>團隊範圍的資料庫：整個團隊各組都能讀。</Hint>
          <DatabaseList databases={detail.data.databases} />
        </DetailBlock>
      )}
    </>
  );
}

/**
 * 寄測試信鈕（邀請成員卡）：管理員改完信箱金鑰後一鍵驗證，不必再走一次邀請流程才發現壞掉。
 * 結果三態：sent＝綠字確認、skipped/failed＝金色警示帶人話原因（sendEmail 已翻成人話）。
 */
function TestEmailButton() {
  const test = trpc.admin.sendTestEmail.useMutation();
  return (
    <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button style={{ padding: "3px 12px", fontSize: "var(--fs-12)" }} disabled={test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? "寄送中…" : "寄測試信到我的信箱"}
      </button>
      {test.data &&
        (test.data.status === "sent" ? (
          <Meta style={{ color: "var(--success-ink)" }}>✓ 已寄出——收到即代表信箱機制正常</Meta>
        ) : (
          <Meta style={{ color: "var(--gold-ink)" }}>⚠ {test.data.detail}</Meta>
        ))}
      {test.error && <span className="error" style={{ marginTop: 0 }}>{test.error.message}</span>}
    </div>
  );
}

/** 建立團隊（開發者限定；非開發者不渲染這張卡，後端 createTeam 也會再擋一次） */
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
    <Card>
      <h2>建立團隊</h2>
      <label htmlFor="new-team-name">團隊名稱</label>
      <input id="new-team-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：影音創作團隊" />
      <div style={{ marginTop: 12 }}>
        <button className="primary" disabled={!name.trim() || createTeam.isPending} onClick={() => createTeam.mutate({ name: name.trim() })}>
          {createTeam.isPending ? "建立中…" : <><Icon name="Plus" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />建立團隊</>}
        </button>
      </div>
      {createTeam.error && <p className="error">{createTeam.error.message}</p>}
    </Card>
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
      // 403（非開發者）或任何非 2xx 回應沒有 checks 陣列——直接 .map 會整頁崩掉，先分流
      if (!res.ok || !Array.isArray(data.checks)) {
        setErrMsg(data.error ?? (res.status === 403 ? "系統自檢需要開發者帳號" : `自檢失敗（HTTP ${res.status}）`));
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
    <Card>
      <h2>系統自檢</h2>
      <Hint>部署後按一下，全部通過才算就緒（資料庫/模型目錄/點數/邀請/生成/交付）。</Hint>
      <button className="primary" disabled={running} onClick={run}>{running ? "檢查中…" : "跑系統自檢"}</button>
      {errMsg && <p className="error" role="alert" style={{ marginTop: 10 }}>{errMsg}</p>}
      {result && (
        <div style={{ marginTop: 10 }}>
          {result.checks.map((c) => (
            <div key={c.name} style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0" }}>
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                {c.ok ? <Icon name="CheckCircle2" size={14} style={{ color: "var(--success-ink)" }} /> : <Icon name="XCircle" size={14} style={{ color: "var(--danger-ink)" }} />}
              </span>
              <b style={{ minWidth: 110 }}>{c.name}</b>
              <Meta>{c.note}</Meta>
            </div>
          ))}
          <p style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
            {result.ok ? (
              <><Icon name="CheckCircle2" size={14} style={{ color: "var(--success-ink)" }} />全部通過——系統就緒</>
            ) : (
              <><Icon name="XCircle" size={14} style={{ color: "var(--danger-ink)" }} />有項目未過，把畫面截圖給智能助手</>
            )}
          </p>
        </div>
      )}
    </Card>
  );
}

/** 分類 chip 配色循環：借用設計系統既有 accent tokens，安靜不搶戲、深淺主題都過 AA */
const AUDIT_CAT_PALETTE = [
  { background: "var(--primary-tint)", color: "var(--primary-ink)", border: "1px solid var(--primary-border)" },
  { background: "var(--gold-soft)", color: "var(--gold-ink)", border: "1px solid var(--gold)" },
  { background: "var(--success-soft)", color: "var(--success-ink)", border: "1px solid var(--success)" },
  { background: "var(--accent-soft, var(--primary-tint))", color: "var(--accent-ink, var(--primary-ink))", border: "1px solid var(--border-soft)" },
];
/** 分類 key → 穩定配色（照 AUDIT_CATEGORIES 順序取色，同類永遠同色，好認） */
const AUDIT_CAT_STYLE: Record<string, { background: string; color: string; border: string }> = Object.fromEntries(
  AUDIT_CATEGORIES.map((c, i) => [c.key, AUDIT_CAT_PALETTE[i % AUDIT_CAT_PALETTE.length]]),
);

type AuditRowData = inferRouterOutputs<AppRouter>["audit"]["list"]["items"][number];

/** 逐列「就地下鑽」的回呼：點歸屬即把操作紀錄縮到那位組員／那個專案／那一組（分組員・分專案・分組別） */
type AuditDrill = {
  actor: (id: string, name: string) => void;
  project: (id: string, title: string) => void;
  group: (id: string) => void;
};

/** 已套用的下鑽過濾膠囊（組員／專案）：帶 X 一點即清，清楚示意「目前縮在這個維度」 */
const activeFilterChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  fontSize: 11,
  borderRadius: 999,
  cursor: "pointer",
  border: "1px solid var(--primary)",
  background: "var(--primary-tint)",
  color: "var(--primary-ink)",
};

/** 下鑽用的「可點歸屬」樣式：看得出可點、但安靜不搶戲（沿用 hint 色，底線示意可點） */
const DRILL_LINK: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: 2,
  textDecorationColor: "var(--border-soft)",
};

/**
 * 一列操作紀錄：白話標題＋分類標籤＋歸屬（組／專案）＋可展開的逐項細節。
 * 展開狀態各列獨立（每列自己 useState），不會互相牽動。
 * 歸屬（組員／團隊・組別／專案）皆可點：一點就把整份紀錄縮到那個維度，非技術夥伴不必先懂過濾器。
 * repeats：連續重複的同型紀錄（groupConsecutiveAudit 併好、新在前，r＝最新一筆）——
 * 標題列只佔一列並標「連續 N 次」，展開才逐筆列出時間與各自細節，重複操作不再洗版。
 */
function AuditLogRow({ r, first, drill, repeats }: { r: AuditRowData; first: boolean; drill: AuditDrill; repeats?: AuditRowData[] }) {
  const [open, setOpen] = useState(false);
  const cat = auditCategoryOf(r.action);
  const summary = summarizeAuditInput(r.input);
  const details = describeAuditInput(r.input);
  const expandable = details.length > 0 || (repeats?.length ?? 0) > 1;
  const catStyle = AUDIT_CAT_STYLE[cat.key] ?? { background: "var(--border-soft)", color: "var(--ink)", border: "1px solid var(--border-soft)" };
  return (
    <div style={{ borderTop: first ? "none" : "1px solid var(--border-soft)", padding: "8px 0", fontSize: 13, marginTop: first ? 8 : 0 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {/* 成功／失敗：單色 Icon＋語意 ink 色（跨平台渲染一致，不用滿彩 emoji） */}
        <span aria-label={r.ok ? "成功" : "失敗"} style={{ display: "inline-flex", alignItems: "center" }}>
          {r.ok
            ? <Icon name="CheckCircle2" size={14} style={{ color: "var(--success-ink)" }} />
            : <Icon name="XCircle" size={14} style={{ color: "var(--danger-ink)" }} />}
        </span>
        {/* 分類標籤：一眼分辨這筆屬於哪一類（帳號／生成／分鏡…） */}
        <Pill style={{ ...catStyle, fontSize: 11, padding: "1px 8px", borderRadius: 999 }}>{cat.label}</Pill>
        {/* 操作者：點名字＝只看這位夥伴做的事（分組員） */}
        <button
          type="button"
          onClick={() => drill.actor(r.actorId, r.actorName)}
          style={{ ...DRILL_LINK, fontWeight: 700 }}
          title={`只看 ${r.actorName} 的操作`}
        >
          {r.actorName}
        </button>
        {/* 操作者角色：一眼看出是組長還是組員做的（分組員層級） */}
        {r.actorRole && (
          <Meta style={{ fontSize: 11 }}>（{r.actorRole === "leader" ? "組長" : "組員"}）</Meta>
        )}
        <span>{humanizeAuditAction(r.action)}</span>
        {/* 連續重複合併：同一人短時間重複做同一件事只佔一列，掛上次數徽章 */}
        {repeats && repeats.length > 1 && (
          <Pill
            style={{ fontSize: 11, padding: "1px 8px", borderRadius: 999, background: "var(--primary-tint)", color: "var(--primary-ink)", border: "1px solid var(--primary)" }}
            title={`短時間內連續 ${repeats.length} 次，展開可看每一筆`}
          >
            連續 {repeats.length} 次
          </Pill>
        )}
        {!r.ok && <span style={{ color: "var(--danger-ink)", fontSize: 11, fontWeight: 600 }}>（失敗）</span>}
        <Meta style={{ fontSize: 11, marginLeft: "auto" }}>{new Date(r.createdAt).toLocaleString("zh-TW")}</Meta>
      </div>
      {/* 歸屬：這筆動到哪個團隊・組別／哪個專案（分團隊組別；非技術夥伴不用去對 uuid）。
          兩者皆可點就地下鑽：點組別＝只看那一組、點專案＝只看那個專案。 */}
      {(r.teamName || r.groupName || r.projectTitle) && (
        <Meta as="div" style={{ fontSize: 11, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(r.teamName || r.groupName) && r.groupId && (
            <button
              type="button"
              onClick={() => drill.group(r.groupId!)}
              style={{ ...DRILL_LINK, display: "inline-flex", alignItems: "center", gap: 3 }}
              title="只看這一組的操作"
            >
              <Icon name="User" size={11} />{[r.teamName, r.groupName].filter(Boolean).join("・")}
            </button>
          )}
          {/* groupId 已解析不到但仍有組名時（理論上少見）退回純文字，不硬給一個點不動的連結 */}
          {(r.teamName || r.groupName) && !r.groupId && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Icon name="User" size={11} />{[r.teamName, r.groupName].filter(Boolean).join("・")}
            </span>
          )}
          {r.projectTitle && r.projectId && (
            <button
              type="button"
              onClick={() => drill.project(r.projectId!, r.projectTitle!)}
              style={{ ...DRILL_LINK, display: "inline-flex", alignItems: "center", gap: 3 }}
              title="只看這個專案的操作"
            >
              <Icon name="FileText" size={11} />{r.projectTitle}
            </button>
          )}
        </Meta>
      )}
      {summary && (
        <Meta as="div" style={{ fontSize: 12, marginTop: 2, overflowWrap: "anywhere" }}>{summary}</Meta>
      )}
      {r.error && (
        <div style={{ color: "var(--danger-ink)", fontSize: 12, marginTop: 2, overflowWrap: "anywhere" }}>
          {r.error.length > 120 ? `${r.error.slice(0, 120)}…` : r.error}
        </div>
      )}
      {/* 逐項細節：預設收合，需要看清楚每個欄位時才展開（含技術代碼與 id，供追查）；
          合併列展開時改列出「每一筆」的時間與各自細節，追查不因合併而少資訊 */}
      {expandable && (
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="hint"
            style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 4px", fontSize: 11, background: "none", border: "none", cursor: "pointer" }}
          >
            <Icon name={open ? "ChevronUp" : "ChevronDown"} size={12} />
            {open ? "收合細節" : repeats && repeats.length > 1 ? `看每一筆（${repeats.length}）` : "看細節"}
          </button>
          {open && (
            <>
              {repeats && repeats.length > 1 ? (
                <ol style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, display: "grid", gap: 2 }}>
                  {repeats.map((rep) => {
                    const inline = describeAuditInput(rep.input)
                      .map((f) => `${f.label}：${f.value}`)
                      .join("・");
                    return (
                      <li key={rep.id} style={{ overflowWrap: "anywhere" }}>
                        <Meta>{new Date(rep.createdAt).toLocaleString("zh-TW")}</Meta>
                        {inline && <span style={{ marginLeft: 8 }}>{inline}</span>}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <dl style={{ margin: "4px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontSize: 12 }}>
                  {details.map((f, k) => (
                    <div key={k} style={{ display: "contents" }}>
                      <dt className="hint" style={{ whiteSpace: "nowrap" }}>{f.label}</dt>
                      <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <Meta as="div" style={{ marginTop: 2, fontSize: 11 }}>
                技術代碼（供工程追查）：<span className="mono">{r.action}</span>
              </Meta>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 操作紀錄（審計）卡：誰在什麼時候做了哪些敏感操作、成功與否。
 * 組長以上都看得到——後端已按呼叫者權限過濾範圍（組長只看自己組），這裡不需要 isSuperAdmin gate。
 * 提供「分類 chip＋關鍵字」雙重過濾；每列可展開看逐項白話細節。
 * keyset 分頁寫法比照 GenerationList 的 listByProjectPaged（useInfiniteQuery＋nextCursor 累積）。
 */
export function AuditLogCard() {
  // 分類過濾（chip）：null＝全部
  const [category, setCategory] = useState<string | null>(null);
  // 四個歸屬維度的過濾（分團隊／組別／組員／專案）：""／null＝不限。
  // 團隊、組別用下拉（來源＝可見範圍 scope）；組員、專案用逐列「就地下鑽」帶入（另存名稱只為了顯示可清除的膠囊）。
  const [teamId, setTeamId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [actor, setActor] = useState<{ id: string; name: string } | null>(null);
  const [project, setProject] = useState<{ id: string; title: string } | null>(null);
  const scope = trpc.directory.scope.useQuery();
  // 可見團隊清單（去重）：給「分團隊」下拉；一個團隊時不顯示（沒得分）
  const teams = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of scope.data?.groups ?? []) if (!seen.has(g.teamId)) seen.set(g.teamId, g.teamName);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [scope.data]);
  // 組別下拉：選了團隊就只列該團隊的組（分組別跟著分團隊收斂，不會列出別團隊的組）
  const groupOptions = useMemo(
    () => (scope.data?.groups ?? []).filter((g) => !teamId || g.teamId === teamId),
    [scope.data, teamId],
  );
  // action 關鍵字前端 debounce 後才帶進查詢，避免每敲一鍵就打一次 API
  const [actionInput, setActionInput] = useState("");
  const [debouncedAction, setDebouncedAction] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedAction(actionInput), 300);
    return () => clearTimeout(t);
  }, [actionInput]);
  // 中文搜尋：關鍵字先對白話字典（中文說明＋代碼都比對），命中就翻成代碼清單精確過濾——
  // 夥伴打「邀請」就找得到 admin.invite，不必先懂英文代碼；沒命中才退回原本的代碼模糊比對。
  const matchedActions = useMemo(() => {
    const q = debouncedAction.trim().toLowerCase();
    if (!q) return null;
    const codes = Object.entries(AUDIT_ACTION_LABELS)
      .filter(([code, label]) => label.toLowerCase().includes(q) || code.toLowerCase().includes(q))
      .map(([code]) => code);
    return codes.length ? codes.slice(0, 80) : null; // 80＝後端上限；超過等於沒在過濾，截斷即可
  }, [debouncedAction]);
  const audit = trpc.audit.list.useInfiniteQuery(
    {
      action: matchedActions ? undefined : debouncedAction.trim() || undefined,
      actions: matchedActions ?? undefined,
      category: category ?? undefined,
      teamId: teamId || undefined,
      groupId: groupId || undefined,
      actorId: actor?.id,
      projectId: project?.id,
      limit: 30,
    },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const rows = audit.data?.pages.flatMap((p) => p.items) ?? [];
  // 連續重複合併：同一人短時間重複同一動作（AI 助手連生 N 張、連續拖分鏡排序）併成一列
  const grouped = useMemo(() => groupConsecutiveAudit(rows), [rows]);
  const filtering = !!debouncedAction.trim() || !!category || !!teamId || !!groupId || !!actor || !!project;
  // 就地下鑽：點某位組員／某個專案／某一組即把整份紀錄縮到那個維度（AuditLogRow 呼叫）
  const drill: AuditDrill = {
    actor: (id, name) => setActor({ id, name }),
    project: (id, title) => setProject({ id, title }),
    group: (id) => setGroupId(id),
  };
  const chip = (active: boolean): CSSProperties => ({
    padding: "3px 10px",
    fontSize: 12,
    borderRadius: 999,
    cursor: "pointer",
    border: active ? "1px solid var(--primary)" : "1px solid var(--border-soft)",
    background: active ? "var(--primary-tint)" : "transparent",
    color: active ? "var(--primary-ink)" : "var(--ink)",
    fontWeight: active ? 600 : 400,
  });
  return (
    <Card data-fb="操作紀錄卡">
      <h2>操作紀錄</h2>
      <Hint>誰在什麼時候做了什麼——用白話寫給每位夥伴看。能看到的範圍已按你的權限過濾（組長看自己組）。</Hint>
      {/* 分類 chip：白話分類，點一下只看那一類；不必先懂 admin.invite 這種代碼 */}
      <div role="group" aria-label="依分類過濾" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <button type="button" style={chip(category === null)} aria-pressed={category === null} onClick={() => setCategory(null)}>全部</button>
        {AUDIT_CATEGORIES.map((c) => (
          <button key={c.key} type="button" style={chip(category === c.key)} aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      {/* 分團隊／分組別：跨多團隊時先選團隊（下拉自動收斂到該團隊的組），再選組看那組的流水 */}
      {((scope.data?.groups.length ?? 0) > 1 || teams.length > 1) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {teams.length > 1 && (
            <select
              value={teamId}
              onChange={(e) => {
                const nextTeam = e.target.value;
                setTeamId(nextTeam);
                // 換團隊後，若目前選的組不屬於新團隊就清掉，避免出現「團隊 A・組別屬 B」的矛盾條件
                if (nextTeam && groupId && !(scope.data?.groups ?? []).some((g) => g.groupId === groupId && g.teamId === nextTeam)) {
                  setGroupId("");
                }
              }}
              aria-label="依團隊過濾操作紀錄"
              style={{ flex: "1 1 200px" }}
            >
              <option value="">所有可見團隊</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {groupOptions.length > 1 && (
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              aria-label="依組別過濾操作紀錄"
              style={{ flex: "1 1 200px" }}
            >
              <option value="">所有可見組別</option>
              {groupOptions.map((g) => (
                <option key={g.groupId} value={g.groupId}>{teams.length > 1 ? g.groupName : `${g.teamName}・${g.groupName}`}</option>
              ))}
            </select>
          )}
        </div>
      )}
      {/* 分組員／分專案：這兩維由逐列「就地下鑽」帶入，選定後在此顯示可清除的膠囊，一眼看出目前縮在誰／哪個專案 */}
      {(actor || project) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
          <Meta style={{ fontSize: 11 }}>目前只看：</Meta>
          {actor && (
            <button type="button" onClick={() => setActor(null)} style={activeFilterChip} aria-label={`清除組員過濾（${actor.name}）`}>
              <Icon name="User" size={11} />組員：{actor.name}<Icon name="X" size={11} />
            </button>
          )}
          {project && (
            <button type="button" onClick={() => setProject(null)} style={activeFilterChip} aria-label={`清除專案過濾（${project.title}）`}>
              <Icon name="FileText" size={11} />專案：{project.title}<Icon name="X" size={11} />
            </button>
          )}
        </div>
      )}
      <input
        type="search"
        value={actionInput}
        onChange={(e) => setActionInput(e.target.value)}
        placeholder="搜尋操作：打中文（如「邀請」「刪除素材」）或代碼皆可…"
        aria-label="搜尋操作紀錄"
      />
      {audit.isLoading ? (
        <div role="status" aria-label="操作紀錄載入中">
          <Skeleton style={{ height: 40, marginTop: 10 }} />
          <Skeleton style={{ height: 40, marginTop: 10 }} />
        </div>
      ) : audit.error ? (
        // 尚無可見組別（剛建團隊、還沒建組/加人）後端回 FORBIDDEN——對管理員是空狀態而非錯誤
        audit.error.data?.code === "FORBIDDEN" ? (
          <Hint layer="always" style={{ marginTop: 10 }}>還沒有你能看到的組別紀錄。先建立組別、把夥伴加進來就會出現。</Hint>
        ) : (
          <p className="error">操作紀錄載入失敗：{audit.error.message}</p>
        )
      ) : rows.length === 0 ? (
        <Meta as="p" style={{ marginTop: 10 }}>
          {filtering ? "沒有符合這個條件的紀錄。" : "還沒有操作紀錄。"}
        </Meta>
      ) : (
        <>
          {grouped.map((g, i) => (
            <AuditLogRow key={g[0].id} r={g[0]} repeats={g.length > 1 ? g : undefined} first={i === 0} drill={drill} />
          ))}
          {audit.hasNextPage && (
            <div style={{ textAlign: "center", marginTop: 10 }}>
              <button type="button" disabled={audit.isFetchingNextPage} onClick={() => audit.fetchNextPage()} style={{ padding: "6px 16px", fontSize: 13 }}>
                {audit.isFetchingNextPage ? "載入中…" : "載入更多"}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ═══════════ 操作洞察卡：人員分類細節・模型使用比較・人×模型用量・提示詞流水 ═══════════ */

type InsightTab = "members" | "models" | "usage" | "prompts";

const INSIGHT_DAYS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
];

/** 生成狀態 → 白話＋語意色（洞察卡提示詞流水用；與 VALUE_LABELS 同語） */
const GEN_STATUS_META: Record<string, { label: string; color: string }> = {
  done: { label: "完成", color: "var(--success-ink)" },
  failed: { label: "失敗", color: "var(--danger-ink)" },
  rejected: { label: "退回", color: "var(--danger-ink)" },
  queued: { label: "排隊中", color: "var(--fg-secondary)" },
  running: { label: "執行中", color: "var(--fg-secondary)" },
  awaiting_approval: { label: "等待核准", color: "var(--gold-ink)" },
};

/** 成功率（生成精準度）：完成/(完成+失敗)。還沒有完結的生成時回 null（顯示 —，不好硬給 0%） */
function successRate(done: number, failed: number): number | null {
  const finished = done + failed;
  return finished === 0 ? null : Math.round((done / finished) * 100);
}

/** pg 聚合欄位（max(...)::text）的時間字串 → Date：補 T 與時區冒號，Safari 的 Date 解析才吃得下 */
function parseDbTime(s: string): Date {
  return new Date(s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
}

/** 提示詞流水的一列：預設截兩行，點一下展開全文（300 字內；全文本來就在生成紀錄） */
function PromptRow({ p }: { p: RecentPromptData }) {
  const [open, setOpen] = useState(false);
  const meta = GEN_STATUS_META[p.status] ?? { label: p.status, color: "var(--fg-secondary)" };
  const model = getModel(p.modelId);
  return (
    <div style={{ borderTop: "1px solid var(--border-soft)", padding: "8px 0", fontSize: 13 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: meta.color, fontSize: 11, fontWeight: 600 }}>{meta.label}</span>
        <b>{p.userName}</b>
        <Meta style={{ fontSize: 11 }}>{model?.label ?? p.modelId}</Meta>
        {p.points > 0 && <Meta style={{ fontSize: 11 }}>{p.points} 點</Meta>}
        <Meta style={{ fontSize: 11, marginLeft: "auto" }}>{new Date(p.createdAt).toLocaleString("zh-TW")}</Meta>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? "收合提示詞" : "展開完整提示詞"}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          cursor: "pointer",
          marginTop: 2,
          overflowWrap: "anywhere",
          ...(open ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }),
        }}
      >
        {p.prompt}
      </button>
      <Meta as="div" style={{ fontSize: 11, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {p.projectTitle && <span><Icon name="FileText" size={11} /> {p.projectTitle}</span>}
        {p.error && <span style={{ color: "var(--danger-ink)" }}>{p.error.length > 80 ? `${p.error.slice(0, 80)}…` : p.error}</span>}
      </Meta>
    </div>
  );
}

type RecentPromptData = inferRouterOutputs<AppRouter>["insights"]["recentPrompts"]["items"][number];
type UserModelStatRow = inferRouterOutputs<AppRouter>["insights"]["userModelStats"]["rows"][number];

/** 瀏覽器端下載 CSV（UTF-8 BOM 已由 toCsv 處理，Excel 可開中文） */
function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * 操作洞察卡（回饋：人員的分類細節、模型的操作與比較、人×模型用量明細、生成精準度、提示詞）。
 * 分頁共用「期間＋組別」過濾：
 * - 人員細節：每位夥伴的操作量、失敗數、最近活動、依分類攤開的次數；點人可跳到他的提示詞。
 * - 模型比較：各模型的生成次數、成功率（生成精準度）、點數、使用人數；點模型看它的提示詞。
 * - 用量明細：人 × 模型矩陣（完成數、點數、新台幣／美元估價）＋ CSV 匯出——精密成本盤點用。
 * - 提示詞：一筆筆的生成流水（誰・模型・提示詞・結果・點數），供比較與教學。
 * 可見範圍與操作紀錄相同（後端已收斂：組長看自己組），組員看不到這張卡的資料。
 */
export function InsightsCard() {
  const [tab, setTab] = useState<InsightTab>("members");
  const [days, setDays] = useState(30);
  const [groupId, setGroupId] = useState("");
  // 下鑽過濾：從「模型比較」點模型、「人員細節」點夥伴，跳到提示詞分頁時帶上
  const [modelFilter, setModelFilter] = useState<{ id: string; label: string } | null>(null);
  const [actorFilter, setActorFilter] = useState<{ id: string; name: string } | null>(null);
  const scope = trpc.directory.scope.useQuery();
  const common = { days, groupId: groupId || undefined };
  const members = trpc.insights.actorBreakdown.useQuery(common, { enabled: tab === "members" });
  const models = trpc.insights.modelStats.useQuery(common, { enabled: tab === "models" });
  const usage = trpc.insights.userModelStats.useQuery(
    { ...common, actorId: actorFilter?.id, modelId: modelFilter?.id },
    { enabled: tab === "usage" },
  );
  const prompts = trpc.insights.recentPrompts.useQuery(
    { ...common, modelId: modelFilter?.id, actorId: actorFilter?.id, limit: 30 },
    { enabled: tab === "prompts" },
  );
  const chip = (active: boolean): CSSProperties => ({
    padding: "3px 10px",
    fontSize: 12,
    borderRadius: 999,
    cursor: "pointer",
    border: active ? "1px solid var(--primary)" : "1px solid var(--border-soft)",
    background: active ? "var(--primary-tint)" : "transparent",
    color: active ? "var(--primary-ink)" : "var(--ink)",
    fontWeight: active ? 600 : 400,
  });
  const groupOptions = scope.data?.groups ?? [];

  function exportUsageCsv(rows: UserModelStatRow[], fxNote: string) {
    const header = [
      "夥伴", "userId", "模型", "modelId", "類型", "送出", "完成", "失敗", "駁回", "在途",
      "完成點數", "新台幣_NTD", "美元_USD", "目錄單次點數", "官方約略價_USD字串", "最近使用", "匯率說明",
    ];
    const body = rows.map((r) => {
      const model = getModel(r.modelId);
      return [
        r.userName,
        r.userId,
        model?.label ?? r.modelId,
        r.modelId,
        r.kind,
        r.submits,
        r.done,
        r.failed,
        r.rejected,
        r.pending,
        r.points,
        r.estTwd,
        r.estUsd,
        model?.points ?? "",
        model?.cost ?? "",
        r.lastUsedAt,
        fxNote,
      ];
    });
    const csv = toCsv([header, ...body]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`aios-用量-新台幣-${days}天-${stamp}.csv`, csv);
  }

  return (
    <Card data-fb="操作洞察卡">
      <h2>操作洞察</h2>
      <Hint>把操作紀錄整理成看得懂的統計：每位夥伴在忙哪一塊、哪個模型好用（成功率＝完成÷已完結）、人×模型用量與估價、大家的提示詞怎麼寫。</Hint>
      {/* 分頁 chips */}
      <div role="group" aria-label="洞察分頁" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <button type="button" style={chip(tab === "members")} aria-pressed={tab === "members"} onClick={() => setTab("members")}>人員細節</button>
        <button type="button" style={chip(tab === "models")} aria-pressed={tab === "models"} onClick={() => setTab("models")}>模型比較</button>
        <button type="button" style={chip(tab === "usage")} aria-pressed={tab === "usage"} onClick={() => setTab("usage")}>用量明細</button>
        <button type="button" style={chip(tab === "prompts")} aria-pressed={tab === "prompts"} onClick={() => setTab("prompts")}>提示詞</button>
      </div>
      {/* 期間＋組別過濾（三個分頁共用） */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        {INSIGHT_DAYS.map((d) => (
          <button key={d.value} type="button" style={chip(days === d.value)} aria-pressed={days === d.value} onClick={() => setDays(d.value)}>
            {d.label}
          </button>
        ))}
        {groupOptions.length > 1 && (
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="依組別過濾洞察" style={{ marginLeft: "auto", maxWidth: 220 }}>
            <option value="">所有可見組別</option>
            {groupOptions.map((g) => (
              <option key={g.groupId} value={g.groupId}>{g.teamName}・{g.groupName}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── 人員細節 ── */}
      {tab === "members" && (
        members.isLoading ? (
          <Skeleton style={{ height: 60 }} />
        ) : members.error ? (
          <p className="error">載入失敗：{members.error.message}</p>
        ) : !members.data || members.data.members.length === 0 ? (
          <Meta as="p">這段期間還沒有操作。</Meta>
        ) : (
          members.data.members.map((m) => (
            <div key={m.userId} style={{ borderTop: "1px solid var(--border-soft)", padding: "8px 0", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => { setActorFilter({ id: m.userId, name: m.name }); setTab("prompts"); }}
                  style={{ ...DRILL_LINK, fontWeight: 700 }}
                  title={`看 ${m.name} 的提示詞`}
                >
                  {m.name}
                </button>
                <Meta style={{ fontSize: 12 }}>{m.total} 筆操作</Meta>
                {m.fails > 0 && <span style={{ color: "var(--danger-ink)", fontSize: 12 }}>{m.fails} 筆失敗</span>}
                <Meta style={{ fontSize: 11, marginLeft: "auto" }}>最近 {parseDbTime(m.lastAt).toLocaleString("zh-TW")}</Meta>
              </div>
              {/* 分類細節：這位夥伴各類操作的次數，多到少 */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                {m.categories.map((c) => {
                  const style = AUDIT_CAT_STYLE[c.key] ?? { background: "var(--border-soft)", color: "var(--ink)", border: "1px solid var(--border-soft)" };
                  return (
                    <Pill key={c.key} style={{ ...style, fontSize: 11, padding: "1px 8px", borderRadius: 999 }}>
                      {c.label} {c.count}
                    </Pill>
                  );
                })}
              </div>
            </div>
          ))
        )
      )}

      {/* ── 模型比較 ── */}
      {tab === "models" && (
        models.isLoading ? (
          <Skeleton style={{ height: 60 }} />
        ) : models.error ? (
          <p className="error">載入失敗：{models.error.message}</p>
        ) : !models.data || models.data.models.length === 0 ? (
          <Meta as="p">這段期間還沒有生成。</Meta>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["模型", "次數", "成功率", "失敗", "點數", "人數", "最近使用"].map((h) => (
                    <th key={h} className="hint" style={{ textAlign: h === "模型" ? "left" : "right", padding: "4px 6px", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.data.models.map((m) => {
                  const model = getModel(m.modelId);
                  const rate = successRate(m.done, m.failed);
                  return (
                    <tr key={`${m.modelId}:${m.kind}`} style={{ borderTop: "1px solid var(--border-soft)" }}>
                      <td style={{ padding: "6px" }}>
                        <button
                          type="button"
                          onClick={() => { setModelFilter({ id: m.modelId, label: model?.label ?? m.modelId }); setTab("prompts"); }}
                          style={{ ...DRILL_LINK, fontWeight: 600 }}
                          title="看這個模型的提示詞"
                        >
                          {model?.label ?? m.modelId}
                        </button>
                        {model && <Meta style={{ fontSize: 11, marginLeft: 6 }}>{tierLabel(model.tier)}</Meta>}
                      </td>
                      <td style={{ padding: "6px", textAlign: "right" }}>{m.submits}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: rate == null ? "var(--fg-secondary)" : rate >= 90 ? "var(--success-ink)" : rate < 70 ? "var(--danger-ink)" : "var(--ink)" }}>
                        {rate == null ? "—" : `${rate}%`}
                      </td>
                      <td style={{ padding: "6px", textAlign: "right", color: m.failed > 0 ? "var(--danger-ink)" : "var(--fg-secondary)" }}>{m.failed}</td>
                      <td style={{ padding: "6px", textAlign: "right" }}>{m.points}</td>
                      <td style={{ padding: "6px", textAlign: "right" }}>{m.users}</td>
                      <td className="hint" style={{ padding: "6px", textAlign: "right", fontSize: 11, whiteSpace: "nowrap" }}>{parseDbTime(m.lastUsedAt).toLocaleDateString("zh-TW")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Hint style={{ fontSize: 11, marginTop: 6 }}>成功率＝完成 ÷（完成＋失敗）；排隊中／等待核准的生成不列入。點數只計完成的實花（失敗會退點）。</Hint>
          </div>
        )
      )}

      {/* ── 用量明細：人 × 模型 ── */}
      {tab === "usage" && (
        <>
          {(modelFilter || actorFilter) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
              <Meta style={{ fontSize: 11 }}>目前只看：</Meta>
              {modelFilter && (
                <button type="button" onClick={() => setModelFilter(null)} style={activeFilterChip} aria-label={`清除模型過濾（${modelFilter.label}）`}>
                  模型：{modelFilter.label}<Icon name="X" size={11} />
                </button>
              )}
              {actorFilter && (
                <button type="button" onClick={() => setActorFilter(null)} style={activeFilterChip} aria-label={`清除夥伴過濾（${actorFilter.name}）`}>
                  <Icon name="User" size={11} />{actorFilter.name}<Icon name="X" size={11} />
                </button>
              )}
            </div>
          )}
          {usage.isLoading ? (
            <Skeleton style={{ height: 60 }} />
          ) : usage.error ? (
            <p className="error">載入失敗：{usage.error.message}</p>
          ) : !usage.data || usage.data.rows.length === 0 ? (
            <Meta as="p">這段期間還沒有生成用量。</Meta>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                <Meta style={{ fontSize: 12 }}>
                  合計：{usage.data.totals.userCount} 人・{usage.data.totals.modelCount} 模型・
                  完成 {usage.data.totals.done.toLocaleString("zh-TW")} 次・
                  {usage.data.totals.points.toLocaleString("zh-TW")} 點・
                  <b style={{ color: "var(--ink)" }}>新台幣 {formatTwd(usage.data.totals.estTwd)}</b>
                  <span style={{ marginLeft: 6 }}>（≈ {formatUsd(usage.data.totals.estUsd)}）</span>
                </Meta>
                <Button variant="ghost" className="btn"
                  type="button"
                  style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px" }}
                  onClick={() => exportUsageCsv(usage.data!.rows, usage.data!.fx?.note ?? moneyFxNote())}
                  title="匯出人×模型用量 CSV（新台幣＋美元）">
                  <Icon name="Download" size={12} /> 匯出 CSV（新台幣）
                </Button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["夥伴", "模型", "送出", "完成", "失敗", "點數", "新台幣", "美元", "最近"].map((h) => (
                      <th
                        key={h}
                        className="hint"
                        style={{
                          textAlign: h === "夥伴" || h === "模型" ? "left" : "right",
                          padding: "4px 6px",
                          fontWeight: 600,
                          fontSize: 11,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {usage.data.rows.map((r) => {
                    const model = getModel(r.modelId);
                    return (
                      <tr key={`${r.userId}:${r.modelId}:${r.kind}`} style={{ borderTop: "1px solid var(--border-soft)" }}>
                        <td style={{ padding: "6px" }}>
                          <button
                            type="button"
                            onClick={() => { setActorFilter({ id: r.userId, name: r.userName }); setTab("prompts"); }}
                            style={{ ...DRILL_LINK, fontWeight: 600 }}
                            title={`看 ${r.userName} 的提示詞`}
                          >
                            {r.userName}
                          </button>
                        </td>
                        <td style={{ padding: "6px" }}>
                          <button
                            type="button"
                            onClick={() => { setModelFilter({ id: r.modelId, label: model?.label ?? r.modelId }); setTab("prompts"); }}
                            style={{ ...DRILL_LINK, fontWeight: 600 }}
                            title="看這個模型的提示詞"
                          >
                            {model?.label ?? r.modelId}
                          </button>
                          {model && (
                            <Meta style={{ fontSize: 11, marginLeft: 6 }} title={model.cost}>
                              {tierLabel(model.tier)}・{model.points}點/次
                            </Meta>
                          )}
                        </td>
                        <td style={{ padding: "6px", textAlign: "right" }}>{r.submits}</td>
                        <td style={{ padding: "6px", textAlign: "right" }}>{r.done}</td>
                        <td style={{ padding: "6px", textAlign: "right", color: r.failed > 0 ? "var(--danger-ink)" : "var(--fg-secondary)" }}>{r.failed}</td>
                        <td style={{ padding: "6px", textAlign: "right", fontFamily: "var(--mono)" }}>{r.points.toLocaleString("zh-TW")}</td>
                        <td style={{ padding: "6px", textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600 }} title="帳面新台幣（1 點 ≈ NT$1）">
                          {formatTwd(r.estTwd)}
                        </td>
                        <td className="hint" style={{ padding: "6px", textAlign: "right", fontFamily: "var(--mono)", fontSize: 11 }} title="帳面美元（對照 Fal 帳單）">
                          {formatUsd(r.estUsd)}
                        </td>
                        <td className="hint" style={{ padding: "6px", textAlign: "right", fontSize: 11, whiteSpace: "nowrap" }}>
                          {parseDbTime(r.lastUsedAt).toLocaleDateString("zh-TW")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Hint style={{ fontSize: 11, marginTop: 6 }}>
                金額單位為<strong>新台幣（NT$）</strong>：只計<strong>完成</strong>實花點數換算（{usage.data.fx?.note ?? moneyFxNote()}）。
                失敗多半已退點，不計入。點人名或模型可下鑽提示詞；CSV 含新台幣、美元與匯率說明。
              </Hint>
            </div>
          )}
        </>
      )}

      {/* ── 提示詞 ── */}
      {tab === "prompts" && (
        <>
          {(modelFilter || actorFilter) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
              <Meta style={{ fontSize: 11 }}>目前只看：</Meta>
              {modelFilter && (
                <button type="button" onClick={() => setModelFilter(null)} style={activeFilterChip} aria-label={`清除模型過濾（${modelFilter.label}）`}>
                  模型：{modelFilter.label}<Icon name="X" size={11} />
                </button>
              )}
              {actorFilter && (
                <button type="button" onClick={() => setActorFilter(null)} style={activeFilterChip} aria-label={`清除夥伴過濾（${actorFilter.name}）`}>
                  <Icon name="User" size={11} />{actorFilter.name}<Icon name="X" size={11} />
                </button>
              )}
            </div>
          )}
          {prompts.isLoading ? (
            <Skeleton style={{ height: 60 }} />
          ) : prompts.error ? (
            <p className="error">載入失敗：{prompts.error.message}</p>
          ) : !prompts.data || prompts.data.items.length === 0 ? (
            <Meta as="p">這段期間還沒有符合條件的生成。</Meta>
          ) : (
            prompts.data.items.map((p) => <PromptRow key={p.id} p={p} />)
          )}
        </>
      )}
    </Card>
  );
}

/** "YYYY-MM-DD"（台北日）→「週一…週日」。用 UTC 建構避開瀏覽器本地時區把日期推前/後一天 */
function weekdayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=日
  return ["週日", "週一", "週二", "週三", "週四", "週五", "週六"][wd];
}

/** 消耗監控組內細項列（成員／專案共用）：名稱＋比較長條＋點數。max＝該維度的比較基準（除以 0 防護） */
function BreakdownRow({ label, points, max }: { label: string; points: number; max: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0" }}>
      <span style={{ flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "40%" }}>{label}</span>
      <div style={{ flex: 1, height: 7, background: "var(--card2)", borderRadius: 3, overflow: "hidden" }} aria-hidden>
        <div style={{ width: `${(points / Math.max(1, max)) * 100}%`, height: "100%", background: "var(--primary)", opacity: 0.7, borderRadius: 3 }} />
      </div>
      <span style={{ flex: "none", fontFamily: "var(--mono)", color: "var(--fg-secondary)" }}>{points.toLocaleString()} 點</span>
    </div>
  );
}

/**
 * 點數消耗監控卡（盲點修補：無成本異常告警）。
 * 口徑＝毛消耗：只算扣點、退點不抵銷——看「實際發動了多少花費」，失敗退點才不會把異常日洗白。
 * alert 由後端統一判定（今日 > max(50, 前 7 日均值×3)），這裡只負責整行紅字呈現；
 * 長條用純 div 寬度比例（零圖表依賴、零 SVG 庫），60 秒輪詢跟上突發暴衝。
 * 各組可展開到「組內成員近 7 天」，組長要的細節（誰在燒點）就在這一層。
 */
export function ConsumptionMonitorCard() {
  const stats = trpc.quota.consumptionStats.useQuery({}, { refetchInterval: 60_000 });
  const data = stats.data;
  // 長條相對「區間內最大值」等比縮放；max(1, ...) 避免全 0 時除以 0
  const maxPoints = data ? Math.max(1, ...data.perDay.map((d) => d.points)) : 1;
  // 峰值日：整段區間毛消耗最高的那天——標一顆點，異常查因時一眼看到「哪天最燒」
  const peakPoints = data ? Math.max(0, ...data.perDay.map((d) => d.points)) : 0;
  // 各組長條相對「最燒的組」等比；同樣 max(1, ...) 防除以 0
  const maxGroupPoints = data ? Math.max(1, ...data.byGroup.map((g) => g.weekPoints)) : 1;
  return (
    <Card data-fb="點數消耗監控卡">
      <h2>點數消耗監控</h2>
      <Hint>逐日毛消耗（只算扣點、退點不抵銷）；今日暴衝會整行紅字提醒。</Hint>
      {stats.isLoading ? (
        <div role="status" aria-label="消耗統計載入中">
          <Skeleton style={{ height: 44, marginTop: 10 }} />
          <Skeleton style={{ height: 120, marginTop: 10 }} />
        </div>
      ) : stats.error ? (
        <p className="error">消耗統計載入失敗：{stats.error.message}</p>
      ) : !data || data.perDay.length === 0 ? (
        // 後端對「無可管組」的團隊管理員回空資料——照實說明而不是留一張空圖
        <Meta as="p" style={{ marginTop: 10 }}>沒有可監控的組。</Meta>
      ) : (
        <>
          {/* 今日大字：alert 時整行（含警語）吃紅色 */}
          <div style={{ marginTop: 8, color: data.alert ? "var(--danger-ink)" : undefined }}>
            <b style={{ fontSize: 24, fontFamily: "var(--mono)" }}>今日 {data.todayPoints.toLocaleString()} 點</b>
            {data.alert ? (
              <div role="alert" style={{ fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                <Icon name="TriangleAlert" size={14} />今日消耗異常（7 日均值 {data.avg7}）
              </div>
            ) : (
              <Meta style={{ marginLeft: 8 }}>7 日均值 {data.avg7}</Meta>
            )}
          </div>
          {/* 逐日迷你長條：每列「MM/DD 週N ▮▮▮ N」，寬度對齊區間最大值；峰值日整列點亮＋標「峰」 */}
          <div style={{ marginTop: 10 }}>
            {data.perDay.map((d) => {
              const isPeak = peakPoints > 0 && d.points === peakPoints;
              return (
                <div key={d.date} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0", fontSize: 12 }}>
                  <Meta style={{ width: 38, flex: "none", fontFamily: "var(--mono)" }}>{d.date.slice(5).replace("-", "/")}</Meta>
                  <Meta style={{ width: 26, flex: "none", fontSize: 11 }}>{weekdayLabel(d.date)}</Meta>
                  <div style={{ flex: 1, height: 10, background: "var(--card2)", borderRadius: 3, overflow: "hidden" }} aria-hidden>
                    <div style={{ width: `${(d.points / maxPoints) * 100}%`, height: "100%", background: isPeak ? "var(--primary-strong, var(--primary))" : "var(--primary)", borderRadius: 3, opacity: isPeak ? 1 : 0.82 }} />
                  </div>
                  {/* 峰值標記：整段最燒的一天，查因時直接鎖定 */}
                  <span style={{ width: 20, flex: "none", textAlign: "center", fontSize: 10, color: "var(--primary-ink)" }}>{isPeak ? "峰" : ""}</span>
                  <span style={{ width: 52, flex: "none", textAlign: "right", fontFamily: "var(--mono)", fontWeight: isPeak ? 700 : 400 }}>{d.points.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
          <h3 style={{ fontSize: "var(--fs-16)", margin: "14px 0 4px" }}>各組近 7 天</h3>
          <Hint style={{ margin: "0 0 6px", fontSize: 12 }}>點各組展開看「組裡誰在燒點」。</Hint>
          {data.byGroup.length === 0 ? (
            <Meta as="p" style={{ marginTop: 4 }}>近 7 天還沒有消耗紀錄。</Meta>
          ) : (
            data.byGroup.map((g, i) => (
              <details key={g.groupId} open={data.byGroup.length === 1} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-soft)", padding: "6px 0" }}>
                {/* summary 本身保持預設 list-item：Safari/WebKit 一旦在 <summary> 直接下 display:flex
                    或塞進 block 子元素，就會吃掉原生開合、點了沒反應——flex 版面改放到內層 div，
                    點擊事件照樣冒泡到 summary 觸發開合，各家瀏覽器（含手機 Safari）都點得動。 */}
                <summary style={{ cursor: "pointer", listStyle: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, minHeight: 32 }}>
                    <Icon name="ChevronRight" size={14} className="details-caret" />
                    <span style={{ flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "34%" }}>{g.groupName}</span>
                    {/* 組間比較長條：相對「最燒的組」等比，一眼看出占比 */}
                    <div style={{ flex: 1, height: 8, background: "var(--card2)", borderRadius: 3, overflow: "hidden" }} aria-hidden>
                      <div style={{ width: `${(g.weekPoints / maxGroupPoints) * 100}%`, height: "100%", background: "var(--primary)", borderRadius: 3 }} />
                    </div>
                    <span style={{ flex: "none", fontFamily: "var(--mono)" }}>{g.weekPoints.toLocaleString()} 點</span>
                  </div>
                </summary>
                {/* 組內兩個維度的近 7 天毛消耗（各自高到低）：成員＝誰在燒、專案＝哪個案子在燒 */}
                <div style={{ margin: "6px 0 2px", paddingLeft: 22 }}>
                  <Meta as="div" style={{ fontSize: 11, fontWeight: 600, margin: "2px 0" }}>各成員</Meta>
                  {g.members.length === 0 ? (
                    <Meta as="p" style={{ margin: 0, fontSize: 12 }}>這個組近 7 天沒有可歸戶的消耗。</Meta>
                  ) : (
                    g.members.map((m) => (
                      <BreakdownRow key={m.userId} label={m.name} points={m.weekPoints} max={g.weekPoints} />
                    ))
                  )}
                  {/* 各專案：只計得出生成歸戶的消耗，小計可能少於組總數（手動增減不歸專案） */}
                  <Meta as="div" style={{ fontSize: 11, fontWeight: 600, margin: "8px 0 2px" }}>各專案</Meta>
                  {g.projects.length === 0 ? (
                    <Meta as="p" style={{ margin: 0, fontSize: 12 }}>這個組近 7 天沒有專案生成消耗。</Meta>
                  ) : (
                    g.projects.map((p) => (
                      <BreakdownRow key={p.projectId} label={p.title} points={p.weekPoints} max={g.projects[0].weekPoints} />
                    ))
                  )}
                </div>
              </details>
            ))
          )}
        </>
      )}
    </Card>
  );
}

/**
 * 單筆元件回饋列。獨立成元件：每筆有自己的狀態下拉 mutation（isPending/error），
 * 共用一個會讓某筆的更新中/錯誤顯示到別筆旁邊。
 */
function ReportRow({ report }: {
  report: {
    id: string;
    category: string;
    pages: unknown; // jsonb → 用 asPages() 收斂成 string[]
    targetLabel?: string | null;
    note: string;
    status: string;
    screenshotPath?: string | null;
    userName?: string | null;
    groupName?: string | null;
    createdAt: string | Date;
    // 回饋代理分診結果（尚未巡到時為 null）
    agentSeverity?: string | null;
    agentSummary?: string | null;
    agentFix?: string | null;
    agentReply?: string | null;
    emailStatus?: string | null;
    agentReviewedAt?: string | Date | null;
  };
}) {
  const utils = trpc.useUtils();
  const updateStatus = trpc.feedbackReports.updateStatus.useMutation({
    onSuccess: () => utils.feedbackReports.listVisible.invalidate(),
  });
  const catStyle = FEEDBACK_CATEGORY_STYLE[report.category] ?? FEEDBACK_CATEGORY_STYLE.other;
  const catLabel = FEEDBACK_CATEGORY_LABEL[report.category] ?? report.category;
  const pages = Array.isArray(report.pages) ? (report.pages as string[]) : [];
  return (
    <div className="gen-row" style={{ gridTemplateColumns: "auto 1fr", alignItems: "start", marginTop: 8 }}>
      {report.screenshotPath ? (
        <a href={`/api/feedback/${report.id}/shot`} target="_blank" rel="noreferrer" title="點開看截圖">
          <img
            src={`/api/feedback/${report.id}/shot`}
            alt="回饋截圖縮圖"
            style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
          />
        </a>
      ) : (
        <Chip
          style={{ margin: 0, ...catStyle, alignSelf: "start" }}>
          {catLabel}
        </Chip>
      )}
      <div style={{ fontSize: 13 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {report.screenshotPath && (
            <Chip style={{ margin: 0, ...catStyle }}>{catLabel}</Chip>
          )}
          {report.targetLabel && <Chip style={{ margin: 0 }}>標定：{report.targetLabel}</Chip>}
          <Meta style={{ fontSize: 11 }}>
            {report.userName ?? "（未知）"}
            {report.groupName ? `・${report.groupName}` : ""}
            ・{new Date(report.createdAt).toLocaleString("zh-TW")}
          </Meta>
        </div>
        {pages.length > 0 && (
          <Meta as="div" style={{ marginTop: 2 }}>涉及頁面：{pages.join("、")}</Meta>
        )}
        {report.note && <div style={{ marginTop: 2 }}>{report.note}</div>}
        {report.agentReviewedAt && (
          <div
            style={{
              marginTop: 6,
              padding: "6px 10px",
              borderRadius: 8,
              background: "var(--card2)",
              border: "1px solid var(--border-soft)",
            }}
          >
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <Chip style={{ margin: 0, fontSize: 11 }}>🤖 回饋代理</Chip>
              {report.agentSeverity && AGENT_SEVERITY_META[report.agentSeverity] && (
                <Chip style={{ margin: 0, fontSize: 11, ...AGENT_SEVERITY_META[report.agentSeverity].style }}>
                  嚴重度：{AGENT_SEVERITY_META[report.agentSeverity].label}
                </Chip>
              )}
              {report.emailStatus && EMAIL_STATUS_LABEL[report.emailStatus] && (
                <Meta style={{ fontSize: 11 }}>{EMAIL_STATUS_LABEL[report.emailStatus]}</Meta>
              )}
            </div>
            {report.agentSummary && <div style={{ marginTop: 3 }}>{report.agentSummary}</div>}
            {report.agentFix && (
              <Meta as="div" style={{ marginTop: 3 }}>
                <span style={{ fontWeight: 600 }}>建議修復：</span>{report.agentFix}
              </Meta>
            )}
            {report.agentReply && (
              <Meta as="div" style={{ marginTop: 3 }}>
                <span style={{ fontWeight: 600 }}>已回覆使用者：</span>{report.agentReply}
              </Meta>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <label className="hint" htmlFor={`fb-status-${report.id}`} style={{ margin: 0 }}>狀態</label>
          <select
            id={`fb-status-${report.id}`}
            style={{ width: "auto", padding: "3px 10px" }}
            value={report.status}
            disabled={updateStatus.isPending}
            onChange={(e) => updateStatus.mutate({ id: report.id, status: e.target.value as "open" | "reviewing" | "done" })}
          >
            {(["open", "reviewing", "done"] as const).map((s) => (
              <option key={s} value={s}>{FEEDBACK_STATUS_LABEL[s]}</option>
            ))}
          </select>
          {updateStatus.isPending && <Meta>更新中…</Meta>}
          {updateStatus.error && <span className="error" style={{ marginTop: 0 }}>{updateStatus.error.message}</span>}
        </div>
      </div>
    </div>
  );
}

/** 元件回饋彙整（夥伴在任何頁面用浮標標定元件送出的回饋） */
function FeedbackReportsSection() {
  const [statusFilter, setStatusFilter] = useState<"" | "open" | "reviewing" | "done">("");
  const reports = trpc.feedbackReports.listVisible.useQuery({ status: statusFilter || undefined });
  return (
    <Card as="section" style={{ marginTop: 16 }} data-fb="元件回饋審閱">
      <h2>元件回饋（{reports.data?.length ?? 0}）</h2>
      <Hint>夥伴在任何頁面用右下角「回饋」浮標標定某個元件送出的意見。</Hint>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {FEEDBACK_STATUS_FILTERS.map((f) => (
          <Chip
            key={f.value || "all"}
            selected={statusFilter === f.value}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </Chip>
        ))}
      </div>
      {reports.isLoading ? (
        <div role="status" aria-label="回饋載入中">
          <Skeleton style={{ height: 72, marginTop: 8 }} />
          <Skeleton style={{ height: 72, marginTop: 8 }} />
        </div>
      ) : reports.error ? (
        <div>
          <p className="error">回饋載入失敗：{reports.error.message}</p>
          <button style={{ marginTop: 8 }} onClick={() => reports.refetch()}>再試一次</button>
        </div>
      ) : !reports.data?.length ? (
        <div className="empty-state">
          <h3>{statusFilter ? "這個狀態底下還沒有回饋" : "還沒有元件回饋"}</h3>
          {!statusFilter && <p>夥伴用右下角「回饋」浮標送出即可。</p>}
        </div>
      ) : (
        reports.data.map((r) => <ReportRow key={r.id} report={r} />)
      )}
    </Card>
  );
}

/** 台北時間（UTC+8）友善格式；容器跑 UTC，直接顯示會差 8 小時 */
function fmtWhen(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

/**
 * 平台 Fal 帳戶 credits（USD）——僅開發者可見。
 * 與站內點數並陳但不混用；不自動換算。錯誤態（未設 key／403／上游）完整展示。
 * 見 docs/product/fal-balance-and-personal-usage-plan.md
 */
function FalAccountCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  // 僅超管有權呼叫；enabled 避免團隊管理員白打 403
  const balance = trpc.quota.falAccountBalance.useQuery(
    {},
    { enabled: isSuperAdmin, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  // 站內總預算剩餘（點）——quota.my 已有 totalRemaining，與 Fal USD 並陳對照
  const myQuota = trpc.quota.my.useQuery(undefined, { enabled: isSuperAdmin, staleTime: 60_000 });
  if (!isSuperAdmin) return null;

  const data = balance.data;
  const systemPointsRemaining = myQuota.data?.totalRemaining ?? null;
  const fmtUsd = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Card data-fb="Fal 帳戶卡">
      <h2>Fal 帳戶</h2>
      <Hint layer="always">
        平台在 Fal.ai 的 credits 餘額（單位 <strong>USD</strong>）。與站內
        <strong>點數</strong>單位不同，僅供營運對帳，<strong>不自動換算</strong>。
      </Hint>
      {balance.isLoading ? (
        <Skeleton style={{ height: 56, marginTop: 8 }} role="status" aria-label="Fal 餘額載入中" />
      ) : balance.error ? (
        <p className="error" role="alert">
          查詢失敗：{balance.error.message}{" "}
          <Button variant="ghost" size="sm" type="button" onClick={() => balance.refetch()}>再試一次</Button>
        </p>
      ) : data && data.ok ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          <div>
            <Meta>Credits 餘額：</Meta>
            <b className="mono" style={{ fontSize: 22 }}>
              ${fmtUsd(data.balance)} {data.currency || "USD"}
            </b>
          </div>
          <div>
            <Meta>帳戶：</Meta>
            <span className="mono">{data.username}</span>
          </div>
          <Meta as="div" style={{ fontSize: 11 }}>
            更新於 {new Date(data.fetchedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
            {data.cached ? "（快取）" : ""}
          </Meta>
        </div>
      ) : data && !data.ok ? (
        <div role="status" style={{ marginTop: 4 }}>
          <Meta as="p" style={{ color: data.code === "forbidden" || data.code === "not_configured" ? "var(--gold-ink)" : "var(--fg-secondary)" }}>
            {data.code === "not_configured" && "⚠ "}
            {data.code === "forbidden" && "🔒 "}
            {data.code === "upstream_error" && "⏳ "}
            {data.message}
          </Meta>
          {data.code === "not_configured" && (
            <Hint style={{ fontSize: 11, marginTop: 4 }}>
              在部署環境設定 <code>FAL_ADMIN_KEY</code>（Admin scope）後重新整理即可。金鑰僅後端使用。
            </Hint>
          )}
        </div>
      ) : null}

      {/* 並排對照：站內總預算剩餘（點） vs Fal USD——刻意分單位標示 */}
      <div
        style={{
          marginTop: 12,
          padding: "8px 10px",
          borderRadius: 8,
          background: "var(--card2)",
          border: "1px solid var(--border-soft)",
          display: "grid",
          gap: 4,
          fontSize: 12,
        }}
      >
        <div>
          <Meta>站內總預算剩餘：</Meta>
          <span className="mono">
            {systemPointsRemaining == null ? "不限" : `${systemPointsRemaining.toLocaleString()} 點`}
          </span>
        </div>
        <div>
          <Meta>Fal credits：</Meta>
          <span className="mono">
            {data && data.ok ? `$${fmtUsd(data.balance)} ${data.currency || "USD"}` : "—"}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <Button variant="ghost" size="sm"
          type="button"
          disabled={balance.isFetching}
          onClick={() => balance.refetch()}
          title="尊重伺服器 60～120 秒快取；短時間內重按可能仍是快取">
          {balance.isFetching ? "重新整理中…" : "重新整理"}
        </Button>
      </div>
    </Card>
  );
}

/**
 * 回饋代理卡：每 3 天自動巡一次未處理回饋，分診、排修復、寄信回覆回報者。
 * 顯示排程週期／信箱機制狀態／最近一次巡檢結果；開發者可「立即巡檢」不必等排程。
 */
function FeedbackAgentCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const utils = trpc.useUtils();
  const status = trpc.feedbackReports.agentStatus.useQuery();
  const runNow = trpc.feedbackReports.runAgentNow.useMutation({
    onSuccess: () => {
      utils.feedbackReports.agentStatus.invalidate();
      utils.feedbackReports.listVisible.invalidate();
    },
  });
  const last = status.data?.lastRun;
  return (
    <Card as="section" style={{ marginTop: 16 }} data-fb="回饋代理卡">
      <h2>回饋代理</h2>
      <Hint>
        每 3 天自動巡一次未處理的元件回饋：AI 分診嚴重度、給工程排修復方向，並寄信回覆回報者。
      </Hint>
      {status.isLoading ? (
        <Skeleton style={{ height: 48, marginTop: 8 }} />
      ) : status.error ? (
        <p className="error">代理狀態載入失敗：{status.error.message}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <div>
            <Meta>巡檢週期：</Meta>每 {status.data?.intervalDays ?? 3} 天一次（伺服器背景）
          </div>
          <div>
            <Meta>信箱回覆機制：</Meta>
            {status.data?.emailConfigured
              ? <span style={{ color: "var(--success-ink)", fontWeight: 600 }}>已設定（會實際寄出）</span>
              : <span style={{ color: "var(--gold-ink)" }}>未設定（僅落地回覆草稿，未寄出）</span>}
          </div>
          <div>
            <Meta>最近一次巡檢：</Meta>
            {last
              ? `${fmtWhen(last.startedAt)}・${last.status === "done" ? "完成" : last.status === "failed" ? "失敗" : "進行中"}｜分診 ${last.reviewedCount} 筆、寄出 ${last.emailedCount} 封${last.note ? `（${last.note}）` : ""}`
              : "尚未執行過（開機後約 5 分鐘首巡）"}
          </div>
        </div>
      )}
      {isSuperAdmin && (
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={() => runNow.mutate()} disabled={runNow.isPending}>
            {runNow.isPending ? "巡檢中…" : "立即巡檢一次"}
          </button>
          {runNow.data && (
            <Meta>
              {runNow.data.status === "skipped"
                ? "已有一輪巡檢進行中"
                : runNow.data.status === "failed"
                  ? `失敗：${runNow.data.note}`
                  : `完成：分診 ${runNow.data.reviewedCount} 筆、寄出 ${runNow.data.emailedCount} 封`}
            </Meta>
          )}
          {runNow.error && <span className="error" style={{ marginTop: 0 }}>{runNow.error.message}</span>}
        </div>
      )}
    </Card>
  );
}

/** 管理頁（總管理/開發者）：組織總覽＋邀請成員（連結用 LINE 傳） */
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
  const [sendEmailInvite, setSendEmailInvite] = useState(true);
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
  const fileQuotaRef = useRef<HTMLInputElement>(null);
  const saveBudget = () => {
    const data = settings.data;
    if (!data || !totalBudgetRef.current || !weeklyRef.current || !dailyRef.current) return;
    // 夾成 >=0：min={0} 只約束上下鈕、擋不住手打負數／非數字；無效輸入視為「不限」(null)。
    const parse = (v: string) => {
      if (v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, n) : null;
    };
    const totalBudgetPoints = parse(totalBudgetRef.current.value);
    const defaultWeeklyPoints = parse(weeklyRef.current.value);
    const defaultDailyPoints = parse(dailyRef.current.value);
    // 配額以整數 GB 存（後端 z.int）：輸入 0.5 這類小數就四捨五入，不讓存檔卡在原始驗證錯誤
    const rawQuota = fileQuotaRef.current ? parse(fileQuotaRef.current.value) : (data.fileQuotaGb ?? null);
    const fileQuotaGb = rawQuota == null ? null : Math.round(rawQuota);
    // 沒有變更就不送：Tab 掃過欄位不觸發無意義寫入
    if (
      totalBudgetPoints === (data.totalBudgetPoints ?? null) &&
      defaultWeeklyPoints === (data.defaultWeeklyPoints ?? null) &&
      defaultDailyPoints === (data.defaultDailyPoints ?? null) &&
      fileQuotaGb === (data.fileQuotaGb ?? null)
    ) return;
    saveSettings.mutate({ totalBudgetPoints, defaultWeeklyPoints, defaultDailyPoints, fileQuotaGb });
  };

  if (overview.isLoading) return (
    <div role="status" aria-label="載入中" style={{ marginTop: 24 }}>
      <Skeleton style={{ height: 28, width: 200, marginBottom: 16 }} />
      <Skeleton style={{ height: 180 }} />
    </div>
  );
  // 總覽讀取失敗：保留頁標題與人話說明＋重試出口——整頁只剩一行原始錯誤會被當成「系統壞了」，
  // 且唯一恢復方式變成重新整理瀏覽器（比照 Launchpad 的錯誤＋重試模式）
  if (overview.error)
    return (
      <div>
        <h1>團隊管理</h1>
        <p className="error" role="alert">
          管理資料暫時載入不了（{overview.error.message}）——
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => overview.refetch()}>再試一次</Button>
        </p>
      </div>
    );
  const teams = overview.data ?? [];
  const selectedTeam = teams.find((t) => t.id === (inviteTeamId || teams[0]?.id));
  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <div className="page-shell secondary-page admin-page">
      <SecondaryPageHeader
        eyebrow="組織與治理"
        title="團隊管理"
        icon="User"
        badge={`${teams.length} 個團隊`}
        description={<>集中管理組別、成員、權限、點數與派工；邀請可直接寄信，也能複製 72 小時有效連結分享。</>}
      />
      <div className="cols">
        <div className="stack">
          {teams.map((team) => (
            <Card as="section" key={team.id} data-fb="團隊與成員卡">
              <h2>{team.name}</h2>
              <Meta as="p">管理：{team.admins.map((a) => a?.name).join("、") || "—"}</Meta>
              <TeamExtras teamId={team.id} />
              {team.groups.map((g) => (
                <GroupSection
                  key={g.id}
                  group={g}
                  teamAdmins={team.admins}
                  isSuperAdmin={isSuperAdmin}
                  meId={me.data?.user.id}
                />
              ))}
              <CreateGroupRow teamId={team.id} />
            </Card>
          ))}
        </div>

        <aside className="stack">
        {/* 系統自檢只有開發者的 /api/selftest 能用——非開發者按了只會 403，對他們是死功能，故只對開發者顯示 */}
        {isSuperAdmin && <SelfTestCard />}
        <ConsumptionMonitorCard />
        <InsightsCard />
        <AuditLogCard />
        {isSuperAdmin && <CreateTeamCard />}
        <Card data-fb="點數與額度卡">
          <h2>點數與額度（彈性・隨時可調）</h2>
          <Hint layer="always">空白＝不限。總預算限開發者調整。分配樹：總預算 →（左側團隊卡）各組「組預算」由團隊管理員分配 →（組長在「選項」頁）再把組預算分給各組員。週/日上限是另一層速率限制，與累計預算並存。</Hint>
          {/* 載入完成才掛載輸入框：defaultValue 只在掛載時生效，先掛空欄會永遠顯示不出現值。
              三態：error（明講失敗＋重試）／data（表單）／載入中（骨架）——缺 error 分支時
              失敗會永遠停在骨架上，管理員以為還在載入而空等 */}
          {settings.error ? (
            <p className="error" role="alert">
              設定暫時讀不到——
              <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => settings.refetch()}>再試一次</Button>
            </p>
          ) : settings.data ? (
            <>
              <label htmlFor="settings-total-budget">總預算點數（全系統）{!isSuperAdmin && <Meta>・限開發者調整</Meta>}</label>
              {/* 非開發者改總預算會被後端擋（FORBIDDEN）——直接 disable 並說明，別讓人白填才報錯 */}
              <input
                id="settings-total-budget"
                ref={totalBudgetRef}
                type="number"
                min={0}
                defaultValue={settings.data.totalBudgetPoints ?? ""}
                placeholder="不限"
                onBlur={saveBudget}
                disabled={!isSuperAdmin}
                title={isSuperAdmin ? undefined : "只有開發者能調整全系統總預算"}
              />
              <label htmlFor="settings-weekly">預設每人每週上限</label>
              <input id="settings-weekly" ref={weeklyRef} type="number" min={0} defaultValue={settings.data.defaultWeeklyPoints ?? ""} placeholder="不限" onBlur={saveBudget} disabled={!isSuperAdmin} />
              <label htmlFor="settings-daily">每人每日上限（每天重置）</label>
              <input id="settings-daily" ref={dailyRef} type="number" min={0} defaultValue={settings.data.defaultDailyPoints ?? ""} placeholder="不限" onBlur={saveBudget} disabled={!isSuperAdmin} />
              <label htmlFor="settings-filequota">資料庫文件每人儲存配額（GB；空＝預設 5、0＝不限）</label>
              <input id="settings-filequota" ref={fileQuotaRef} type="number" min={0} defaultValue={settings.data.fileQuotaGb ?? ""} placeholder="5" onBlur={saveBudget} disabled={!isSuperAdmin} />
            </>
          ) : (
            <div role="status" aria-label="設定載入中" style={{ marginTop: 12 }}>
              <Skeleton style={{ height: 40, marginTop: 10 }} />
              <Skeleton style={{ height: 40, marginTop: 10 }} />
              <Skeleton style={{ height: 40, marginTop: 10 }} />
            </div>
          )}
          {saveSettings.error && <p className="error">{saveSettings.error.message}</p>}
          {settingsSaved && <Meta as="p" style={{ color: "var(--success-ink)" }}>已儲存 ✓</Meta>}
        </Card>
        {/* Fal 帳戶（USD credits）與站內點數並陳；僅開發者 */}
        <FalAccountCard isSuperAdmin={isSuperAdmin} />
        <Card data-fb="邀請成員卡">
          <h2>邀請成員</h2>
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partner@example.com" />
          <label htmlFor="invite-team">團隊</label>
          <select
            id="invite-team"
            value={selectedTeam?.id ?? ""}
            onChange={(e) => {
              // 換團隊時角色一併歸零：殘留的「組長/團隊管理員」會被靜默帶進下一筆邀請
              setInviteTeamId(e.target.value);
              setGroupId("");
              setGroupRole("member");
              setTeamRole("member");
            }}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <label htmlFor="invite-team-role">團隊角色</label>
          <select id="invite-team-role" value={teamRole} onChange={(e) => setTeamRole(e.target.value as "admin" | "member")}>
            <option value="member">成員</option>
            <option value="admin">團隊管理員</option>
          </select>
          <Hint layer="always" style={{ margin: "4px 0 0" }}>團隊管理員能管理整個團隊的組別、成員與額度，權限較大，請謹慎授予。</Hint>
          <label htmlFor="invite-group">組別</label>
          <select
            id="invite-group"
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              // 改回「先不入組」時清掉殘留的「組長」選擇（select 只是 disabled，state 仍在）
              if (!e.target.value) setGroupRole("member");
            }}
          >
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
          {!groupId && <Hint layer="always" style={{ margin: "4px 0 0" }}>未選組時角色不生效——選了組別才需要設定。</Hint>}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={sendEmailInvite} onChange={(e) => setSendEmailInvite(e.target.checked)} style={{ width: "auto" }} />
            <span>同時把邀請連結寄到這個 Email</span>
          </label>
          <Hint layer="always" style={{ margin: "4px 0 0" }}>未設定信箱機制時會自動略過寄信，改用下方連結傳給對方即可。</Hint>
          <TestEmailButton />
          <div style={{ marginTop: 16 }}>
            <button
              className="primary"
              disabled={!emailValid || !selectedTeam || invite.isPending}
              onClick={() =>
                invite.mutate({ email: email.trim(), teamId: selectedTeam!.id, teamRole, groupId: groupId || undefined, groupRole, sendEmailInvite })
              }
            >
              {invite.isPending ? "建立中…" : sendEmailInvite ? "產生連結並寄信" : "產生邀請連結"}
            </button>
          </div>
          {invite.data && invite.data.attached && (
            <Meta as="p" style={{ marginTop: 12 }}>✓ {invite.data.message}</Meta>
          )}
          {invite.data && !invite.data.attached && invite.data.inviteUrl && (
            <div style={{ marginTop: 12 }}>
              {invite.data.emailStatus === "sent" && (
                <Meta as="p" style={{ color: "var(--success-ink)", fontWeight: 600 }}>✓ 邀請信已寄出到 {email || "對方信箱"}。也可複製下方連結備用：</Meta>
              )}
              {invite.data.emailStatus === "skipped" && (
                <Meta as="p" style={{ color: "var(--gold-ink)" }}>⚠ 尚未寄信（{invite.data.emailDetail ?? "信箱機制未設定"}）。請複製下方連結傳給對方：</Meta>
              )}
              {invite.data.emailStatus === "failed" && (
                <Meta as="p" style={{ color: "var(--gold-ink)" }}>⚠ 寄信失敗（{invite.data.emailDetail ?? "未知原因"}）。請改用下方連結傳給對方：</Meta>
              )}
              {!invite.data.emailStatus && (
                <Hint layer="always">複製這個連結傳給夥伴（{invite.data.expiresInHours} 小時內有效）：</Hint>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input readOnly value={toFullUrl(invite.data.inviteUrl)} onFocus={(e) => e.target.select()} />
                <CopyButton text={toFullUrl(invite.data.inviteUrl)} />
              </div>
            </div>
          )}
          {invite.error && <p className="error">{invite.error.message}</p>}
        </Card>
        </aside>
      </div>

      <Card as="section" style={{ marginTop: 16 }}>
        <h2>回饋彙整（{feedback.data?.length ?? 0}）</h2>
        {feedback.isLoading ? (
          <div role="status" aria-label="回饋載入中">
            <Skeleton style={{ height: 60, marginTop: 8 }} />
            <Skeleton style={{ height: 60, marginTop: 8 }} />
          </div>
        ) : feedback.error ? (
          <div>
            <p className="error">回饋載入失敗：{feedback.error.message}</p>
            <button style={{ marginTop: 8 }} onClick={() => feedback.refetch()}>再試一次</button>
          </div>
        ) : !feedback.data?.length ? (
          <EmptyState title={<>還沒有回饋</>} description={<>夥伴用頂欄「回饋」按鈕填寫。</>} />
        ) : (
          feedback.data.map((f) => (
            <div key={f.id} className="gen-row" style={{ gridTemplateColumns: "auto 1fr" }}>
              <Chip>{f.userName}</Chip>
              <div style={{ fontSize: 13 }}>
                <span className="mono" style={{ fontSize: 11 }}>
                  {Object.entries((f.scores as Record<string, number>) ?? {}).map(([k, v]) => `${k}:${v}`).join(" ")}
                </span>
                {f.best && <div><span style={{ color: "var(--success-ink)", fontWeight: 600 }}>最喜歡：</span>{f.best}</div>}
                {f.worst && <div><span style={{ color: "var(--gold-ink)", fontWeight: 600 }}>最想改：</span>{f.worst}</div>}
                {f.note && <Meta as="div">{f.note}</Meta>}
              </div>
            </div>
          ))
        )}
      </Card>

      <FeedbackAgentCard isSuperAdmin={isSuperAdmin} />

      <FeedbackReportsSection />
    </div>
  );
}
