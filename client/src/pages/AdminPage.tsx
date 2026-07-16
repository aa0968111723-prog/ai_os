import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUS_LABEL } from "@shared/options";

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
        <ConfirmButton
          triggerStyle={btn}
          disabled={pending}
          message={`把 ${member.name} 移出「${groupName}」？之後隨時可以再邀請回來。`}
          onConfirm={() => removeMember.mutate({ groupId, userId })}
        >
          移出組
        </ConfirmButton>
        {canResetPassword && (
          <ConfirmButton
            triggerStyle={btn}
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
      <p className="hint">部署後按一下，全部 ✅ 才算就緒（資料庫/模型目錄/點數/邀請/生成/交付）。</p>
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

/**
 * W3 操作紀錄人話化：action 代碼 → 創作者看得懂的動詞短語。
 * 沒對到的照顯原代碼（新端點上線不會變空白）；原代碼仍以小字保留供關鍵字篩選對照。
 */
const AUDIT_ACTION_LABEL: Record<string, string> = {
  // 生成與 AI
  "generation.submit": "送出生成",
  "generation.decideCost": "裁決待核生成",
  "generation.rename": "命名生成成品",
  "generation.toggleFavorite": "收藏／取消收藏生成",
  "scenes.generateInto": "就地生成分鏡畫面",
  "scenes.generateVoiceover": "生成分鏡配音",
  "workflows.start": "啟動工作流",
  "director.suggest": "AI 導演建議",
  "director.splitScript": "AI 拆分鏡",
  "assistant.ask": "詢問 AI 專案助手",
  "assistant.runAction": "AI 助手執行動作",
  "teamAssistant.ask": "詢問組彙總 AI",
  // 分鏡與審核
  "scenes.addFromGeneration": "把成品加入分鏡",
  "scenes.update": "編輯分鏡",
  "scenes.move": "調整分鏡順序",
  "scenes.reorder": "重排分鏡",
  "scenes.remove": "刪除分鏡（入回收桶）",
  "scenes.restore": "還原分鏡",
  "scenes.purge": "永久刪除分鏡",
  "scenes.setVisualFromGeneration": "切換分鏡現用版本",
  "approvals.submit": "送審分鏡",
  "approvals.decide": "裁決分鏡審核",
  // 專案與素材
  "projects.create": "建立專案",
  "projects.createSample": "建立範例專案",
  "projects.update": "更新專案設定",
  "projects.updateWorldview": "更新世界觀",
  "projects.setArchived": "封存／還原專案",
  "projects.setProjectRole": "調整專案權限",
  "projects.deleteAsset": "刪除素材（入回收桶）",
  "projects.restoreAsset": "還原素材",
  "projects.purgeAsset": "永久刪除素材",
  "projects.renameAsset": "素材改名",
  "projects.setAssetLock": "鎖定／解鎖素材",
  // 知識庫與卡片
  "knowledge.add": "新增知識",
  "knowledge.update": "編輯知識",
  "knowledge.remove": "刪除知識（入回收桶）",
  "knowledge.restore": "還原知識",
  "knowledge.purge": "永久刪除知識",
  "knowledge.addFromAsset": "素材轉入知識庫",
  "knowledge.describeImageAsset": "AI 描述圖片入知識庫",
  "characters.add": "新增角色定裝卡",
  "characters.update": "編輯角色定裝卡",
  "characters.remove": "刪除角色定裝卡",
  "scenePresets.add": "新增場景設定卡",
  "scenePresets.update": "編輯場景設定卡",
  "scenePresets.remove": "刪除場景設定卡",
  "prompts.save": "儲存提示詞",
  "prompts.remove": "刪除提示詞",
  // 團隊與帳號
  "auth.login": "登入",
  "auth.logout": "登出",
  "auth.changePassword": "修改密碼",
  "auth.acceptInvite": "接受邀請加入",
  "admin.invite": "邀請成員",
  "admin.removeMember": "移出成員",
  "admin.resetPassword": "重設成員密碼",
  "quota.setGroupQuota": "調整組額度",
  "quota.setTotalBudget": "調整總預算",
  "quota.setApprovalThreshold": "設定核准門檻",
  "messages.post": "留言",
  "notes.add": "新增筆記",
  "notes.update": "更新筆記",
  "notes.remove": "刪除筆記",
  "schedule.add": "新增行程",
  "schedule.remove": "刪除行程",
  "feedback.submit": "送出回饋",
  // MCP（外部 AI 客戶端）
  "mcp.list_projects": "MCP 外部客戶端：列出專案",
  "mcp.get_project_context": "MCP 外部客戶端：讀取專案",
  "mcp.find_model": "MCP 外部客戶端：查模型",
  "mcp.submit_generation": "MCP 外部客戶端：送出生成",
  "mcp.post_message": "MCP 外部客戶端：留言",
};

/** 有意義欄位的中文標籤——uuid 類識別碼一律不顯示（創作者看不懂也用不到） */
const AUDIT_FIELD_LABEL: Record<string, string> = {
  title: "標題", name: "名稱", prompt: "提示詞", message: "訊息", body: "內容",
  text: "文字", content: "內容", email: "信箱", role: "角色", decision: "裁決",
  reason: "理由", modelId: "模型", kind: "類型", locked: "鎖定", archived: "封存",
  favorite: "收藏", scriptText: "腳本", voiceover: "配音詞", durationSec: "秒數",
  direction: "方向", thresholdPoints: "門檻點數", weeklyPointsPerUser: "每人週額度",
  totalBudgetPoints: "總預算", startsAt: "開始時間",
};

const AUDIT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 審計列的 input 摘要：先試「有標籤的欄位＝人話」，一個都沒有才退回原 JSON 截 120 字 */
function auditInputSummary(input: unknown): string {
  try {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        if (v == null) continue;
        const label = AUDIT_FIELD_LABEL[k];
        if (!label) continue;
        if (typeof v === "string" && AUDIT_UUID_RE.test(v)) continue;
        const sv = typeof v === "string" ? v : typeof v === "boolean" ? (v ? "是" : "否") : JSON.stringify(v);
        parts.push(`${label}：${sv.length > 42 ? `${sv.slice(0, 42)}…` : sv}`);
        if (parts.length >= 4) break; // 一列最多四個欄位，維持流水的可掃讀性
      }
      // 物件但沒有任何可讀欄位（多半只有 uuid 識別碼）：不顯示——動作的人話標籤已足夠，
      // 硬塞一串 uuid 正是「創作者看不懂」的來源
      return parts.join("・");
    }
    const s = JSON.stringify(input);
    if (!s || s === "null" || s === "{}") return "";
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return ""; // 理論上不會發生（API 回來的都是可序列化資料），保險別讓一列壞資料炸整張卡
  }
}

/**
 * 操作紀錄（審計）卡：誰在什麼時候做了哪些敏感操作、成功與否。
 * 管理員與開發者都看得到——後端已按呼叫者權限過濾範圍，這裡不需要 isSuperAdmin gate。
 * keyset 分頁寫法比照 GenerationList 的 listByProjectPaged（useInfiniteQuery＋nextCursor 累積）。
 */
function AuditLogCard() {
  // action 關鍵字前端 debounce 後才帶進查詢，避免每敲一鍵就打一次 API
  const [actionInput, setActionInput] = useState("");
  const [debouncedAction, setDebouncedAction] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedAction(actionInput), 300);
    return () => clearTimeout(t);
  }, [actionInput]);
  const audit = trpc.audit.list.useInfiniteQuery(
    { action: debouncedAction.trim() || undefined, limit: 30 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const rows = audit.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="card" data-fb="操作紀錄卡">
      <h2>操作紀錄（審計）</h2>
      <p className="hint">最近的管理／花點操作流水；能看到的範圍已按你的權限過濾。</p>
      <input
        type="search"
        value={actionInput}
        onChange={(e) => setActionInput(e.target.value)}
        placeholder="用操作類型關鍵字篩選（如 invite）…"
        aria-label="篩選操作類型"
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
          {debouncedAction.trim() ? "沒有符合這個關鍵字的紀錄。" : "還沒有操作紀錄。"}
        </p>
      ) : (
        <>
          {rows.map((r, i) => (
            <div key={r.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-soft)", padding: "6px 0", fontSize: 13, marginTop: i === 0 ? 8 : 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span aria-label={r.ok ? "成功" : "失敗"}>{r.ok ? "✅" : "❌"}</span>
                <b>{r.actorName}</b>
                {/* 人話動作優先（W3 回饋：全是代碼看不懂）；原代碼縮成小字，篩選關鍵字仍對得上 */}
                <span>{AUDIT_ACTION_LABEL[r.action] ?? r.action}</span>
                {AUDIT_ACTION_LABEL[r.action] && <span className="mono hint" style={{ fontSize: 10 }}>{r.action}</span>}
                <span className="hint" style={{ fontSize: 11 }}>{new Date(r.createdAt).toLocaleString("zh-TW")}</span>
              </div>
              {auditInputSummary(r.input) && (
                <div className="hint" style={{ fontSize: 11, marginTop: 2, overflowWrap: "anywhere" }}>
                  {auditInputSummary(r.input)}
                </div>
              )}
              {r.error && (
                <div style={{ color: "var(--danger-ink)", fontSize: 12, marginTop: 2, overflowWrap: "anywhere" }}>
                  {r.error.length > 120 ? `${r.error.slice(0, 120)}…` : r.error}
                </div>
              )}
            </div>
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
              <div role="alert" style={{ fontWeight: 600, marginTop: 2 }}>⚠ 今日消耗異常（7 日均值 {data.avg7}）</div>
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

  if (overview.isLoading) return (
    <div role="status" aria-label="載入中" style={{ marginTop: 24 }}>
      <div className="skeleton" style={{ height: 28, width: 200, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 180 }} />
    </div>
  );
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
          <p className="hint">空白＝不限。總預算限開發者；各組週額度由團隊管理員在左側團隊卡調整。</p>
          {/* 載入完成才掛載輸入框：defaultValue 只在掛載時生效，先掛空欄會永遠顯示不出現值 */}
          {settings.data ? (
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

      <FeedbackReportsSection />
    </div>
  );
}
