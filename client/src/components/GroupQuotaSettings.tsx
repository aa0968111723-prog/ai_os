import { useRef, useState } from "react";
import { trpc } from "../api";
import { Button, Card, Chip, Hint, Meta } from "./ui";

/**
 * 組別的點數與審核設定（原本住在「選項」頁）。
 *
 * 「選項」已從選單移除（選項改成在需要的地方就地新增），但這兩張卡跟選項無關：
 * 它們是組長每天在用的「錢」設定，必須留在選單進得去的地方——
 * 因此搬到「監控與紀錄」（用量與活動紀錄），與點數消耗、模型用量放在一起。
 */

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
    <Card as="section" data-fb="成本審核門檻卡" style={{ marginBottom: 16 }}>
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
    </Card>
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
    <Card as="section" data-fb="點數分配卡" style={{ marginBottom: 16 }}>
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
    </Card>
  );
}

/** 組長的點數／審核設定（審核門檻＋點數分配）；頁面層級守門由呼叫端負責。 */
export function GroupQuotaSettings({ groupId }: { groupId: string }) {
  return (
    <>
      <ApprovalThresholdCard groupId={groupId} />
      <PointsAllocationCard groupId={groupId} />
    </>
  );
}
