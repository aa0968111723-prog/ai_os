import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUS_LABEL } from "@shared/options";
import { AUDIT_CATEGORIES, auditCategoryOf, describeAuditInput, humanizeAuditAction, summarizeAuditInput } from "@shared/auditWording";

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
      <span className="hint">空=跟全域・0=不限</span>
      {setGroupQuota.error && <span className="error" style={{ marginTop: 0 }}>{setGroupQuota.error.message}</span>}
      {saved && <span className="hint" style={{ color: "var(--success-ink)" }}>已儲存 ✓</span>}
    </div>
  );
}

/**
 * 單一組的「組預算」輸入列（累計上限）：超管/團隊管理員把總點數池分配給這個組。
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
      {/* 累計點數池：給超管看「這組發了多少、用了多少、組長分下去多少」——空=不限 */}
      <span className="hint">
        {current != null ? `已用 ${used}／${current}・已分給組員 ${allocated}` : "空=不限（累計總量）"}
      </span>
      {setGroupBudget.error && <span className="error" style={{ marginTop: 0 }}>{setGroupBudget.error.message}</span>}
      {saved && <span className="hint" style={{ color: "var(--success-ink)" }}>已儲存 ✓</span>}
    </div>
  );
}

/**
 * 成員列＋管理操作（組長切換/移出組/重設密碼）。
 * 為什麼獨立成元件：每位成員要有自己的 isPending/error/臨時密碼狀態，
 * 共用一個 mutation 會讓 A 成員的錯誤與密碼顯示到 B 成員旁邊。
 */
function MemberChip({ groupId, groupName, member, canResetPassword }: {
  groupId: string;
  groupName: string;
  member: { id?: string; name?: string; role?: "leader" | "member" };
  /** 後端會擋「超管/他團管理員」——注定失敗的重設鈕直接不畫，別讓管理員按了才吃 FORBIDDEN */
  canResetPassword: boolean;
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
  const btn = { padding: "2px 10px", fontSize: "var(--fs-12)" } as const;
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
            請把密碼傳給 {member.name} 本人；他用這組密碼登入後，可從頂欄「改密碼」換成自己的密碼。
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
          {createGroup.isPending ? "建立中…" : <><Icon name="Plus" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />建組</>}
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
          {createTeam.isPending ? "建立中…" : <><Icon name="Plus" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />建立團隊</>}
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
    <div className="card">
      <h2>系統自檢</h2>
      <p className="hint">部署後按一下，全部通過才算就緒（資料庫/模型目錄/點數/邀請/生成/交付）。</p>
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
              <span className="hint">{c.note}</span>
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
    </div>
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

/**
 * 一列操作紀錄：白話標題＋分類標籤＋歸屬（組／專案）＋可展開的逐項細節。
 * 展開狀態各列獨立（每列自己 useState），不會互相牽動。
 */
function AuditLogRow({ r, first }: { r: AuditRowData; first: boolean }) {
  const [open, setOpen] = useState(false);
  const cat = auditCategoryOf(r.action);
  const summary = summarizeAuditInput(r.input);
  const details = describeAuditInput(r.input);
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
        <span className="pill" style={{ ...catStyle, fontSize: 11, padding: "1px 8px", borderRadius: 999 }}>{cat.label}</span>
        <b>{r.actorName}</b>
        <span>{humanizeAuditAction(r.action)}</span>
        {!r.ok && <span style={{ color: "var(--danger-ink)", fontSize: 11, fontWeight: 600 }}>（失敗）</span>}
        <span className="hint" style={{ fontSize: 11, marginLeft: "auto" }}>{new Date(r.createdAt).toLocaleString("zh-TW")}</span>
      </div>
      {/* 歸屬：這筆動到哪個組／哪個專案（非技術夥伴不用去對 uuid） */}
      {(r.groupName || r.projectTitle) && (
        <div className="hint" style={{ fontSize: 11, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {r.groupName && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="User" size={11} />{r.groupName}</span>}
          {r.projectTitle && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="FileText" size={11} />{r.projectTitle}</span>}
        </div>
      )}
      {summary && (
        <div className="hint" style={{ fontSize: 12, marginTop: 2, overflowWrap: "anywhere" }}>{summary}</div>
      )}
      {r.error && (
        <div style={{ color: "var(--danger-ink)", fontSize: 12, marginTop: 2, overflowWrap: "anywhere" }}>
          {r.error.length > 120 ? `${r.error.slice(0, 120)}…` : r.error}
        </div>
      )}
      {/* 逐項細節：預設收合，需要看清楚每個欄位時才展開（含技術代碼與 id，供追查） */}
      {details.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="hint"
            style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 4px", fontSize: 11, background: "none", border: "none", cursor: "pointer" }}
          >
            <Icon name={open ? "ChevronUp" : "ChevronDown"} size={12} />{open ? "收合細節" : "看細節"}
          </button>
          {open && (
            <dl style={{ margin: "4px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontSize: 12 }}>
              {details.map((f, k) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt className="hint" style={{ whiteSpace: "nowrap" }}>{f.label}</dt>
                  <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{f.value}</dd>
                </div>
              ))}
              <div style={{ display: "contents" }}>
                <dt className="hint" style={{ whiteSpace: "nowrap" }}>操作代碼</dt>
                <dd className="mono hint" style={{ margin: 0, fontSize: 11 }}>{r.action}</dd>
              </div>
            </dl>
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
  // action 關鍵字前端 debounce 後才帶進查詢，避免每敲一鍵就打一次 API
  const [actionInput, setActionInput] = useState("");
  const [debouncedAction, setDebouncedAction] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedAction(actionInput), 300);
    return () => clearTimeout(t);
  }, [actionInput]);
  const audit = trpc.audit.list.useInfiniteQuery(
    { action: debouncedAction.trim() || undefined, category: category ?? undefined, limit: 30 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const rows = audit.data?.pages.flatMap((p) => p.items) ?? [];
  const filtering = !!debouncedAction.trim() || !!category;
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
    <div className="card" data-fb="操作紀錄卡">
      <h2>操作紀錄</h2>
      <p className="hint">誰在什麼時候做了什麼——用白話寫給每位夥伴看。能看到的範圍已按你的權限過濾（組長看自己組）。</p>
      {/* 分類 chip：白話分類，點一下只看那一類；不必先懂 admin.invite 這種代碼 */}
      <div role="group" aria-label="依分類過濾" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <button type="button" style={chip(category === null)} aria-pressed={category === null} onClick={() => setCategory(null)}>全部</button>
        {AUDIT_CATEGORIES.map((c) => (
          <button key={c.key} type="button" style={chip(category === c.key)} aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <input
        type="search"
        value={actionInput}
        onChange={(e) => setActionInput(e.target.value)}
        placeholder="進階：再用操作代碼關鍵字細找（如 invite、generation）…"
        aria-label="用操作代碼關鍵字篩選"
      />
      {audit.isLoading ? (
        <div role="status" aria-label="操作紀錄載入中">
          <div className="skeleton" style={{ height: 40, marginTop: 10 }} />
          <div className="skeleton" style={{ height: 40, marginTop: 10 }} />
        </div>
      ) : audit.error ? (
        <p className="error">操作紀錄載入失敗：{audit.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="hint" style={{ marginTop: 10 }}>
          {filtering ? "沒有符合這個條件的紀錄。" : "還沒有操作紀錄。"}
        </p>
      ) : (
        <>
          {rows.map((r, i) => (
            <AuditLogRow key={r.id} r={r} first={i === 0} />
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
    </div>
  );
}

/**
 * 點數消耗監控卡（盲點修補：無成本異常告警）。
 * 口徑＝毛消耗：只算扣點、退點不抵銷——看「實際發動了多少花費」，失敗退點才不會把異常日洗白。
 * alert 由後端統一判定（今日 > max(50, 前 7 日均值×3)），這裡只負責整行紅字呈現；
 * 長條用純 div 寬度比例（零圖表依賴、零 SVG 庫），60 秒輪詢跟上突發暴衝。
 */
function ConsumptionMonitorCard() {
  const stats = trpc.quota.consumptionStats.useQuery({}, { refetchInterval: 60_000 });
  const data = stats.data;
  // 長條相對「區間內最大值」等比縮放；max(1, ...) 避免全 0 時除以 0
  const maxPoints = data ? Math.max(1, ...data.perDay.map((d) => d.points)) : 1;
  return (
    <div className="card" data-fb="點數消耗監控卡">
      <h2>點數消耗監控</h2>
      <p className="hint">逐日毛消耗（只算扣點、退點不抵銷）；今日暴衝會整行紅字提醒。</p>
      {stats.isLoading ? (
        <div role="status" aria-label="消耗統計載入中">
          <div className="skeleton" style={{ height: 44, marginTop: 10 }} />
          <div className="skeleton" style={{ height: 120, marginTop: 10 }} />
        </div>
      ) : stats.error ? (
        <p className="error">消耗統計載入失敗：{stats.error.message}</p>
      ) : !data || data.perDay.length === 0 ? (
        // 後端對「無可管組」的團隊管理員回空資料——照實說明而不是留一張空圖
        <p className="hint" style={{ marginTop: 10 }}>沒有可監控的組。</p>
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
              <span className="hint" style={{ marginLeft: 8 }}>7 日均值 {data.avg7}</span>
            )}
          </div>
          {/* 逐日迷你長條：每列「MM/DD ▮▮▮ N」，寬度對齊區間最大值 */}
          <div style={{ marginTop: 10 }}>
            {data.perDay.map((d) => (
              <div key={d.date} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0", fontSize: 12 }}>
                <span className="hint" style={{ width: 38, flex: "none", fontFamily: "var(--mono)" }}>{d.date.slice(5).replace("-", "/")}</span>
                <div style={{ flex: 1, height: 10, background: "var(--card2)", borderRadius: 3, overflow: "hidden" }} aria-hidden>
                  <div style={{ width: `${(d.points / maxPoints) * 100}%`, height: "100%", background: "var(--primary)", borderRadius: 3 }} />
                </div>
                <span style={{ width: 52, flex: "none", textAlign: "right", fontFamily: "var(--mono)" }}>{d.points.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <h3 style={{ fontSize: "var(--fs-16)", margin: "14px 0 4px" }}>各組近 7 天</h3>
          {data.byGroup.length === 0 ? (
            <p className="hint" style={{ marginTop: 4 }}>近 7 天還沒有消耗紀錄。</p>
          ) : (
            data.byGroup.map((g, i) => (
              <div key={g.groupId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "4px 0", borderTop: i === 0 ? "none" : "1px solid var(--border-soft)" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.groupName}</span>
                <span style={{ flex: "none", fontFamily: "var(--mono)" }}>{g.weekPoints.toLocaleString()} 點</span>
              </div>
            ))
          )}
        </>
      )}
    </div>
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
        <span
          className="chip"
          style={{ margin: 0, ...catStyle, alignSelf: "start" }}
        >
          {catLabel}
        </span>
      )}
      <div style={{ fontSize: 13 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {report.screenshotPath && (
            <span className="chip" style={{ margin: 0, ...catStyle }}>{catLabel}</span>
          )}
          {report.targetLabel && <span className="chip" style={{ margin: 0 }}>標定：{report.targetLabel}</span>}
          <span className="hint" style={{ fontSize: 11 }}>
            {report.userName ?? "（未知）"}
            {report.groupName ? `・${report.groupName}` : ""}
            ・{new Date(report.createdAt).toLocaleString("zh-TW")}
          </span>
        </div>
        {pages.length > 0 && (
          <div className="hint" style={{ marginTop: 2 }}>涉及頁面：{pages.join("、")}</div>
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
              <span className="chip" style={{ margin: 0, fontSize: 11 }}>🤖 回饋代理</span>
              {report.agentSeverity && AGENT_SEVERITY_META[report.agentSeverity] && (
                <span className="chip" style={{ margin: 0, fontSize: 11, ...AGENT_SEVERITY_META[report.agentSeverity].style }}>
                  嚴重度：{AGENT_SEVERITY_META[report.agentSeverity].label}
                </span>
              )}
              {report.emailStatus && EMAIL_STATUS_LABEL[report.emailStatus] && (
                <span className="hint" style={{ fontSize: 11 }}>{EMAIL_STATUS_LABEL[report.emailStatus]}</span>
              )}
            </div>
            {report.agentSummary && <div style={{ marginTop: 3 }}>{report.agentSummary}</div>}
            {report.agentFix && (
              <div className="hint" style={{ marginTop: 3 }}>
                <span style={{ fontWeight: 600 }}>建議修復：</span>{report.agentFix}
              </div>
            )}
            {report.agentReply && (
              <div className="hint" style={{ marginTop: 3 }}>
                <span style={{ fontWeight: 600 }}>已回覆使用者：</span>{report.agentReply}
              </div>
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
          {updateStatus.isPending && <span className="hint">更新中…</span>}
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
    <section className="card" style={{ marginTop: 16 }} data-fb="元件回饋審閱">
      <h2>元件回饋（{reports.data?.length ?? 0}）</h2>
      <p className="hint">夥伴在任何頁面用右下角「回饋」浮標標定某個元件送出的意見。</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {FEEDBACK_STATUS_FILTERS.map((f) => (
          <span
            key={f.value || "all"}
            role="button"
            tabIndex={0}
            aria-pressed={statusFilter === f.value}
            className={`chip pick ${statusFilter === f.value ? "on" : ""}`}
            onClick={() => setStatusFilter(f.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStatusFilter(f.value); } }}
          >
            {f.label}
          </span>
        ))}
      </div>
      {reports.isLoading ? (
        <div role="status" aria-label="回饋載入中">
          <div className="skeleton" style={{ height: 72, marginTop: 8 }} />
          <div className="skeleton" style={{ height: 72, marginTop: 8 }} />
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
    </section>
  );
}

/** 台北時間（UTC+8）友善格式；容器跑 UTC，直接顯示會差 8 小時 */
function fmtWhen(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
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
    <section className="card" style={{ marginTop: 16 }} data-fb="回饋代理卡">
      <h2>回饋代理</h2>
      <p className="hint">
        每 3 天自動巡一次未處理的元件回饋：AI 分診嚴重度、給工程排修復方向，並寄信回覆回報者。
      </p>
      {status.isLoading ? (
        <div className="skeleton" style={{ height: 48, marginTop: 8 }} />
      ) : status.error ? (
        <p className="error">代理狀態載入失敗：{status.error.message}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <div>
            <span className="hint">巡檢週期：</span>每 {status.data?.intervalDays ?? 3} 天一次（伺服器背景）
          </div>
          <div>
            <span className="hint">信箱回覆機制：</span>
            {status.data?.emailConfigured
              ? <span style={{ color: "var(--success-ink)", fontWeight: 600 }}>已設定（會實際寄出）</span>
              : <span style={{ color: "var(--gold-ink)" }}>未設定（僅落地回覆草稿，未寄出）</span>}
          </div>
          <div>
            <span className="hint">最近一次巡檢：</span>
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
            <span className="hint">
              {runNow.data.status === "skipped"
                ? "已有一輪巡檢進行中"
                : runNow.data.status === "failed"
                  ? `失敗：${runNow.data.note}`
                  : `完成：分診 ${runNow.data.reviewedCount} 筆、寄出 ${runNow.data.emailedCount} 封`}
            </span>
          )}
          {runNow.error && <span className="error" style={{ marginTop: 0 }}>{runNow.error.message}</span>}
        </div>
      )}
    </section>
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
  const fileQuotaRef = useRef<HTMLInputElement>(null);
  const saveBudget = () => {
    const data = settings.data;
    if (!data || !totalBudgetRef.current || !weeklyRef.current || !dailyRef.current) return;
    const parse = (v: string) => (v === "" ? null : Number(v));
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
      <div className="skeleton" style={{ height: 28, width: 200, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 180 }} />
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
          <button className="btn-ghost btn-sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => overview.refetch()}>再試一次</button>
        </p>
      </div>
    );
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
            <section key={team.id} className="card" data-fb="團隊與成員卡">
              <h2>{team.name}</h2>
              <p className="hint">管理：{team.admins.map((a) => a?.name).join("、") || "—"}</p>
              {team.groups.map((g) => (
                <div key={g.id} style={{ marginTop: 10 }}>
                  <h3 style={{ fontSize: "var(--fs-16)", margin: "0 0 6px" }}>{g.name}</h3>
                  {g.members.length === 0 ? (
                    <span className="hint">（還沒有成員）</span>
                  ) : (
                    g.members.map((m) => (
                      <MemberChip
                        key={m.id}
                        groupId={g.id}
                        groupName={g.name}
                        member={m}
                        // 與後端權限階梯一致：超管重設任何人；團隊管理員不能重設超管與其他管理員（自己除外）
                        canResetPassword={
                          isSuperAdmin ||
                          (!m.isSuperAdmin && (m.id === me.data?.user.id || !team.admins.some((a) => a?.id === m.id)))
                        }
                      />
                    ))
                  )}
                  <GroupBudgetRow group={g} />
                  <GroupQuotaRow group={g} />
                </div>
              ))}
              <CreateGroupRow teamId={team.id} />
            </section>
          ))}
        </div>

        <aside className="stack">
        {/* 系統自檢只有超管的 /api/selftest 能用——非超管按了只會 403，對他們是死功能，故只對超管顯示 */}
        {isSuperAdmin && <SelfTestCard />}
        <ConsumptionMonitorCard />
        <AuditLogCard />
        {isSuperAdmin && <CreateTeamCard />}
        <div className="card" data-fb="點數與額度卡">
          <h2>點數與額度（彈性・隨時可調）</h2>
          <p className="hint">空白＝不限。總預算限開發者調整。分配樹：總預算 →（左側團隊卡）各組「組預算」由團隊管理員分配 →（組長在「選項」頁）再把組預算分給各組員。週/日上限是另一層速率限制，與累計預算並存。</p>
          {/* 載入完成才掛載輸入框：defaultValue 只在掛載時生效，先掛空欄會永遠顯示不出現值。
              三態：error（明講失敗＋重試）／data（表單）／載入中（骨架）——缺 error 分支時
              失敗會永遠停在骨架上，管理員以為還在載入而空等 */}
          {settings.error ? (
            <p className="error" role="alert">
              設定暫時讀不到——
              <button className="btn-ghost btn-sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => settings.refetch()}>再試一次</button>
            </p>
          ) : settings.data ? (
            <>
              <label htmlFor="settings-total-budget">總預算點數（全系統）{!isSuperAdmin && <span className="hint">・限開發者調整</span>}</label>
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
              <div className="skeleton" style={{ height: 40, marginTop: 10 }} />
              <div className="skeleton" style={{ height: 40, marginTop: 10 }} />
              <div className="skeleton" style={{ height: 40, marginTop: 10 }} />
            </div>
          )}
          {saveSettings.error && <p className="error">{saveSettings.error.message}</p>}
          {settingsSaved && <p className="hint" style={{ color: "var(--success-ink)" }}>已儲存 ✓</p>}
        </div>
        <div className="card" data-fb="邀請成員卡">
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
          <p className="hint" style={{ margin: "4px 0 0" }}>團隊管理員能管理整個團隊的組別、成員與額度，權限較大，請謹慎授予。</p>
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
          <div role="status" aria-label="回饋載入中">
            <div className="skeleton" style={{ height: 60, marginTop: 8 }} />
            <div className="skeleton" style={{ height: 60, marginTop: 8 }} />
          </div>
        ) : feedback.error ? (
          <div>
            <p className="error">回饋載入失敗：{feedback.error.message}</p>
            <button style={{ marginTop: 8 }} onClick={() => feedback.refetch()}>再試一次</button>
          </div>
        ) : !feedback.data?.length ? (
          <div className="empty-state">
            <h3>還沒有回饋</h3>
            <p>夥伴用頂欄「回饋」按鈕填寫。</p>
          </div>
        ) : (
          feedback.data.map((f) => (
            <div key={f.id} className="gen-row" style={{ gridTemplateColumns: "auto 1fr" }}>
              <span className="chip">{f.userName}</span>
              <div style={{ fontSize: 13 }}>
                <span className="mono" style={{ fontSize: 11 }}>
                  {Object.entries((f.scores as Record<string, number>) ?? {}).map(([k, v]) => `${k}:${v}`).join(" ")}
                </span>
                {f.best && <div><span style={{ color: "var(--success-ink)", fontWeight: 600 }}>最喜歡：</span>{f.best}</div>}
                {f.worst && <div><span style={{ color: "var(--gold-ink)", fontWeight: 600 }}>最想改：</span>{f.worst}</div>}
                {f.note && <div className="hint">{f.note}</div>}
              </div>
            </div>
          ))
        )}
      </section>

      <FeedbackAgentCard isSuperAdmin={isSuperAdmin} />

      <FeedbackReportsSection />
    </div>
  );
}
