import { useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";
import { Button, Chip, Hint, Meta, Skeleton } from "./ui";
import {
  OPTION_TYPES,
  OPTION_TYPE_META,
  PLATFORM_FORMATS,
  type OptionType,
  type GroupOption,
} from "@shared/options";

/**
 * 成本審核門檻卡：組員單筆生成「預估點數」達門檻時，送出後需組長核准才會開始生成。
 * 讀值走 quota.usage 的 approvalThreshold（本頁已由 App 守門為組長以上，有權限讀）；
 * 儲存比照 AdminPage 點數卡的 defaultValue＋onBlur 模式：載入完成才掛輸入框
 * （defaultValue 只在掛載時生效，先掛空欄會永遠顯示不出現值），且只在真的有改時才送出。
 */
function ApprovalThresholdCard({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const usage = trpc.quota.usage.useQuery({ groupId });
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setThreshold = trpc.quota.setApprovalThreshold.useMutation({
    onSuccess: () => {
      utils.quota.usage.invalidate({ groupId });
      utils.quota.my.invalidate(); // 生成確認彈窗的門檻提醒讀 quota.my，改完即時同步
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    },
  });
  const current = usage.data?.approvalThreshold ?? null;
  return (
    <section className="card" data-fb="成本審核門檻卡" style={{ marginBottom: 16 }}>
      <h2>成本審核門檻</h2>
      <Hint layer="always">組員單筆生成達此點數需組長核准才會送出；空白或 0＝不啟用。</Hint>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <label className="hint" htmlFor={`approval-threshold-${groupId}`} style={{ margin: 0 }}>門檻點數</label>
        {usage.isLoading ? (
          <span className="skeleton" style={{ display: "inline-block", height: 40, width: 140, borderRadius: "var(--r-12)" }} aria-hidden="true" />
        ) : usage.error ? (
          <span className="error" style={{ marginTop: 0 }}>載入失敗：{usage.error.message}</span>
        ) : (
          <input
            id={`approval-threshold-${groupId}`}
            type="number"
            min={0}
            style={{ width: 140 }}
            placeholder="不啟用"
            defaultValue={current ?? ""}
            onBlur={(e) => {
              // 沒有變更就不送：Tab 掃過欄位不觸發無意義寫入。
              // min={0} 只約束上下鈕、擋不住手打負數／非數字——這裡自行夾成 >=0 整數，避免送出無效值。
              const raw = Number(e.target.value);
              const next = e.target.value === "" ? null : (Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : current);
              if (next !== current) setThreshold.mutate({ groupId, thresholdPoints: next });
            }}
          />
        )}
        {setThreshold.isPending && <Meta>儲存中…</Meta>}
        {setThreshold.error && <span className="error" style={{ marginTop: 0 }}>{setThreshold.error.message}</span>}
        {saved && <Meta style={{ color: "var(--success-ink)" }}>已儲存 ✓</Meta>}
      </div>
    </section>
  );
}

/**
 * 單一組員的個人預算分配列：組長把「組預算」再分給這位組員（累計上限）。
 * 每列自帶 mutation/儲存狀態，避免一位組員的錯誤或「已儲存」顯示到別人旁邊（同 AdminPage MemberChip 理由）。
 */
function MemberBudgetRow({ groupId, member }: {
  groupId: string;
  member: { userId: string; name: string; role: "leader" | "member"; total: number; budget: number | null; canDispatch: boolean };
}) {
  const utils = trpc.useUtils();
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setMemberBudget = trpc.quota.setMemberBudget.useMutation({
    onSuccess: () => {
      utils.quota.usage.invalidate({ groupId });
      utils.quota.my.invalidate();
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    },
  });
  // 團隊代理派工授權：組長以上本就有派工權（不顯示開關），只對一般組員開放授權切換
  const setDispatch = trpc.quota.setMemberDispatch.useMutation({ onSuccess: () => utils.quota.usage.invalidate({ groupId }) });
  const current = member.budget;
  const inputId = `member-budget-${member.userId}`;
  const isLeader = member.role === "leader";
  // 已用超過分配額時標紅提示（分配是累計上限，用超代表該調高或已擋下後續生成）
  const over = current != null && member.total > current;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      <Chip style={{ margin: 0 }}>{member.name}{isLeader ? "・組長" : ""}</Chip>
      <label className="hint" htmlFor={inputId} style={{ margin: 0 }}>分配</label>
      <input
        id={inputId}
        type="number"
        min={0}
        style={{ width: 110 }}
        placeholder="不限"
        defaultValue={current ?? ""}
        onBlur={(e) => {
          const raw = Number(e.target.value);
          const next = e.target.value === "" ? null : (Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : current);
          if (next !== current) setMemberBudget.mutate({ groupId, userId: member.userId, budgetPoints: next });
        }}
      />
      <Meta style={over ? { color: "var(--danger-ink)" } : undefined}>
        已用 {member.total}{current != null ? `／${current}` : "・不限"}
      </Meta>
      {/* 派工權切換：組長恆有、顯示靜態標記；組員可由組長開/關「用組彙總 AI 派工到專案」 */}
      {isLeader ? (
        <Meta title="組長以上本就有派工權">・可派工</Meta>
      ) : (
        <Button size="sm"
          type="button"
          disabled={setDispatch.isPending}
          title={member.canDispatch ? "點一下收回這位組員的團隊代理派工權" : "點一下授權這位組員用組彙總 AI 派工到專案"}
          onClick={() => setDispatch.mutate({ groupId, userId: member.userId, canDispatch: !member.canDispatch })}
          style={member.canDispatch ? { color: "var(--success-ink)" } : undefined}>
          派工權：{member.canDispatch ? "已開" : "關"}
        </Button>
      )}
      {(setMemberBudget.isPending || setDispatch.isPending) && <Meta>儲存中…</Meta>}
      {(setMemberBudget.error || setDispatch.error) && <span className="error" style={{ marginTop: 0 }}>{(setMemberBudget.error ?? setDispatch.error)!.message}</span>}
      {saved && <Meta style={{ color: "var(--success-ink)" }}>已儲存 ✓</Meta>}
    </div>
  );
}

/**
 * 點數分配卡（分配樹最底層）：組長把團隊管理員分配下來的「組預算」再分給各組員。
 * 讀 quota.usage（含 groupBudget/groupUsed/allocated 與每位組員的 budget/total）；
 * 顯示「未分配 = 組預算 − 已分給組員」，超分配時柔性提示（不硬擋——沿用彈性原則，額度隨時可調）。
 */
function PointsAllocationCard({ groupId }: { groupId: string }) {
  const usage = trpc.quota.usage.useQuery({ groupId });
  const data = usage.data;
  const groupBudget = data?.groupBudget ?? null;
  const allocated = data?.allocated ?? 0;
  const unallocated = groupBudget != null ? groupBudget - allocated : null;
  return (
    <section className="card" data-fb="點數分配卡" style={{ marginBottom: 16 }}>
      <h2>點數分配</h2>
      <Hint layer="always">把「組預算」分給各組員（累計上限，非每週重置）；空白＝不限。組預算由團隊管理員分配給你這個組。</Hint>
      {usage.isLoading ? (
        <span className="skeleton" style={{ display: "block", height: 40, borderRadius: "var(--r-12)", marginTop: 8 }} aria-hidden="true" />
      ) : usage.error ? (
        <p className="error" style={{ marginTop: 8 }}>
          載入失敗：{usage.error.message}
          <button style={{ marginLeft: 8, padding: "3px 12px", fontSize: "var(--fs-12)" }} onClick={() => usage.refetch()}>重試</button>
        </p>
      ) : (
        <>
          {/* 組預算總覽：沒設＝不限，設了就顯示已用/剩餘與分配進度 */}
          {groupBudget != null ? (
            <Meta as="div" style={{ marginTop: 4 }}>
              組預算 <b>{groupBudget}</b> 點・已用 {data!.groupUsed}・已分給組員 {allocated}・
              <span style={{ color: unallocated != null && unallocated < 0 ? "var(--danger-ink)" : undefined }}>
                {unallocated != null && unallocated < 0 ? `超分配 ${-unallocated}` : `未分配 ${unallocated}`}
              </span>
            </Meta>
          ) : (
            <Meta as="div" style={{ marginTop: 4 }}>這個組沒有設定累計組預算（不限）——仍可為個別組員設個人累計上限。</Meta>
          )}
          {unallocated != null && unallocated < 0 && (
            <Hint layer="always" style={{ color: "var(--danger-ink)", marginTop: 4 }}>
              分配給組員的總和已超過組預算——組員各自的個人上限仍有效，但整組仍受組預算擋著，請斟酌調整。
            </Hint>
          )}
          {(data!.rows.length === 0) ? (
            <Meta as="p" style={{ marginTop: 8 }}>這個組還沒有成員。</Meta>
          ) : (
            data!.rows.map((m) => <MemberBudgetRow key={m.userId} groupId={groupId} member={m} />)
          )}
        </>
      )}
    </section>
  );
}

/**
 * 組選項編輯器（R23）：讓組長／管理員自訂「這一組」建專案與生成時可挑的選項
 * （內容類型、發布平台、調性、主軸、視覺風格）。頁面層級由 App 守門，這裡專注編輯。
 */
export function GroupOptionsEditor({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  // 全失效較穩：byGroup 有 active-only 與 includeInactive 兩種快取，改動後兩份都要重讀。
  const refresh = () => utils.options.byGroup.invalidate();

  const list = trpc.options.byGroup.useQuery({ groupId, includeInactive: true });
  const upsert = trpc.options.upsert.useMutation({ onSuccess: refresh });
  const setActive = trpc.options.setActive.useMutation({ onSuccess: refresh });
  const remove = trpc.options.remove.useMutation({ onSuccess: refresh });
  const reorder = trpc.options.reorder.useMutation({ onSuccess: refresh });

  // 任一動作進行中就擋住列上的按鈕，避免連點造成排序 / 狀態打架。
  const busy = upsert.isPending || setActive.isPending || remove.isPending || reorder.isPending;
  const actionError = upsert.error ?? setActive.error ?? remove.error ?? reorder.error;

  const rowsOf = (type: OptionType) => (list.data ?? []).filter((o) => o.type === type);

  // 依「目前顯示序（active＋inactive 混排）」組 orderedIds，交換相鄰兩筆後送出。
  const move = (type: OptionType, index: number, dir: -1 | 1) => {
    const rows = rowsOf(type);
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const ids = rows.map((o) => o.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate({ groupId, type, orderedIds: ids });
  };

  // 更新既有選項：平台類一律帶回目前比例，避免只改名字時把比例清掉。
  const editOption = (o: GroupOption, patch: { label?: string; format?: string }) => {
    const isPlatform = OPTION_TYPE_META[o.type].hasFormat;
    upsert.mutate({
      groupId,
      id: o.id,
      type: o.type,
      label: patch.label ?? o.label,
      ...(isPlatform ? { format: patch.format ?? o.format ?? PLATFORM_FORMATS[0] } : {}),
    });
  };

  // 三種狀態（載入/錯誤/正常）都把「成本審核門檻」卡固定在頂部：門檻卡有自己的查詢，
  // 不因選項清單的狀態時有時無（避免載入完成後才彈出的跳動）
  if (list.isLoading) {
    return (
      <>
        <ApprovalThresholdCard groupId={groupId} />
        <PointsAllocationCard groupId={groupId} />
        <section className="card" data-fb="組選項編輯器">
          <div aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="gen-row">
                <Skeleton style={{ height: 14 }} />
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }
  if (list.error) {
    return (
      <>
        <ApprovalThresholdCard groupId={groupId} />
        <PointsAllocationCard groupId={groupId} />
        <section className="card" data-fb="組選項編輯器">
          <p className="error">
            選項載入失敗：{list.error.message}
            <button style={{ marginLeft: 8, padding: "3px 12px", fontSize: "var(--fs-12)" }} onClick={() => list.refetch()}>
              重試
            </button>
          </p>
        </section>
      </>
    );
  }

  return (
    <>
    <ApprovalThresholdCard groupId={groupId} />
    <PointsAllocationCard groupId={groupId} />
    <section className="card" data-fb="組選項編輯器">
      <h2>這一組的選項</h2>
      <Hint>
        這裡調整的是「你這個組」建專案與生成時能挑的選項；只有組長或管理員進得來，改完全組立即生效。
        停用的選項不會出現在挑選處，但保留紀錄、隨時可再啟用。
      </Hint>

      {OPTION_TYPES.map((type) => {
        const meta = OPTION_TYPE_META[type];
        const rows = rowsOf(type);
        return (
          <div key={type} style={{ marginTop: 20, borderTop: "1px solid var(--border-soft)", paddingTop: 14 }}>
            <div style={{ fontWeight: 600, fontSize: "var(--fs-15)" }}>{meta.label}</div>
            <Hint style={{ marginTop: 2 }}>{meta.hint}</Hint>

            {rows.length === 0 ? (
              <Hint layer="always" style={{ marginTop: 8 }}>還沒有選項——用下面的欄位加一個。</Hint>
            ) : (
              <div style={{ marginTop: 8 }}>
                {rows.map((o, i) => (
                  <div
                    key={o.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                      border: "1px solid var(--border-soft)",
                      borderRadius: "var(--r-12)",
                      padding: "8px 12px",
                      marginTop: 8,
                      background: o.active ? "var(--card)" : "var(--card2)",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button
                        aria-label="上移"
                        title="上移"
                        disabled={busy || i === 0}
                        onClick={() => move(type, i, -1)}
                        style={{ padding: "0 8px", fontSize: "var(--fs-12)", lineHeight: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                      >
                        <Icon name="ChevronUp" size={14} />
                      </button>
                      <button
                        aria-label="下移"
                        title="下移"
                        disabled={busy || i === rows.length - 1}
                        onClick={() => move(type, i, 1)}
                        style={{ padding: "0 8px", fontSize: "var(--fs-12)", lineHeight: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                      >
                        <Icon name="ChevronDown" size={14} />
                      </button>
                    </div>

                    <EditableLabel
                      key={o.label}
                      value={o.label}
                      onCommit={(next) => editOption(o, { label: next })}
                    />

                    {meta.hasFormat && (
                      <select
                        aria-label="畫面比例"
                        value={o.format ?? PLATFORM_FORMATS[0]}
                        disabled={busy}
                        onChange={(e) => editOption(o, { format: e.target.value })}
                        style={{ width: 92, flex: "none" }}
                      >
                        {PLATFORM_FORMATS.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    )}

                    {!o.active && <Chip>停用中</Chip>}

                    <button
                      disabled={busy}
                      onClick={() => setActive.mutate({ id: o.id, active: !o.active })}
                      style={{ padding: "3px 12px", fontSize: "var(--fs-12)", flex: "none" }}
                    >
                      {o.active ? "停用" : "啟用"}
                    </button>
                    <ConfirmButton
                      onConfirm={() => remove.mutate({ id: o.id })}
                      message={`刪除選項「${o.label}」？`}
                      confirmLabel="刪除"
                      disabled={busy}
                      triggerStyle={{ padding: "3px 12px", fontSize: "var(--fs-12)", color: "var(--danger-ink)", flex: "none" }}
                    >
                      刪除
                    </ConfirmButton>
                  </div>
                ))}
              </div>
            )}

            <AddRow groupId={groupId} type={type} onRefresh={refresh} />
          </div>
        );
      })}

      {actionError && <p className="error">動作沒完成：{actionError.message}</p>}
    </section>
    </>
  );
}

/** 單列名稱的行內編輯：改完按 Enter 或點別處就存；Esc 還原。空白或沒改不送出。 */
function EditableLabel({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };
  return (
    <input
      value={draft}
      aria-label="選項名稱"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      style={{ flex: "1 1 150px", minWidth: 120 }}
    />
  );
}

/** 每區底部的「＋新增」：自帶送出狀態，成功後清空欄位、刷新清單。 */
function AddRow({ groupId, type, onRefresh }: { groupId: string; type: OptionType; onRefresh: () => void }) {
  const meta = OPTION_TYPE_META[type];
  const [label, setLabel] = useState("");
  const [format, setFormat] = useState<string>(PLATFORM_FORMATS[0]);
  const add = trpc.options.upsert.useMutation({
    onSuccess: () => {
      onRefresh();
      setLabel("");
      setFormat(PLATFORM_FORMATS[0]);
    },
  });

  const submit = () => {
    const l = label.trim();
    if (!l || add.isPending) return;
    add.mutate({ groupId, type, label: l, ...(meta.hasFormat ? { format } : {}) });
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
      <input
        value={label}
        aria-label={`新增${meta.label}`}
        placeholder={`新增${meta.label}…`}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={{ flex: "1 1 150px", minWidth: 120 }}
      />
      {meta.hasFormat && (
        <select
          aria-label="畫面比例"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          style={{ width: 92, flex: "none" }}
        >
          {PLATFORM_FORMATS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      )}
      <button
        className="primary"
        disabled={!label.trim() || add.isPending}
        onClick={submit}
        style={{ padding: "6px 16px", fontSize: "var(--fs-13)", flex: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        {add.isPending ? "新增中…" : <><Icon name="Plus" size={14} />新增</>}
      </button>
      {add.error && <span className="error" style={{ marginTop: 0 }}>新增失敗：{add.error.message}</span>}
    </div>
  );
}
