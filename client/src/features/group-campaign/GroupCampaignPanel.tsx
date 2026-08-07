import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { ConfirmButton } from "../../components/interactions";
import { Button, Card, Chip, Hint, Meta, Pill, type PillStatus } from "../../components/ui";
import {
  GROUP_RUN_STATUS_LABEL,
  GROUP_STEP_KIND_LABEL,
  campaignProgress,
  canRunCampaign,
  resolveCampaignWaitReason,
  type GroupCampaignStep,
  type GroupCommandLevel,
  type GroupRunStatus,
  type GroupStepKind,
  type GroupStepStatus,
} from "../../../../shared/groupAgent";

/**
 * 組代理調度計畫（L3 campaign）的前門。
 *
 * 這一層的後端整套都在——規劃、核准、背景執行器、預算閘、事件軌跡、重啟修復——
 * 但在這支元件之前**沒有任何前端呼叫它**：teamAssistant 的七個 campaign 端點在 client
 * 一個呼叫端都沒有。使用者按不到的能力等於不存在，而這正是「幫我開一個中秋活動宣傳專案」
 * 這句話唯一走得通的路（專案代理的每份 run 都綁死一個 projectId，開專案只能落在組層）。
 *
 * ## 三件刻意寫在畫面上的事
 *
 * 1. **授權額度是主角，不是進階設定**。campaign 唯一危險的地方是「在沒人看著時自動核准
 *    子計畫並花點」，那個上限就是 budgetPoints。預設 0＝每一份子計畫都要人按，
 *    比預設給了再靠人記得關安全。
 * 2. **摘要在核准之前就要說出會做什麼**（幾步、開幾個新專案、派幾件工）——專案只能封存
 *    不能刪，人該在按下去之前看見。
 * 3. **等待中的兩種成因要分開講**。人工關卡要人去做事、預算停手要人加授權；不分成因的話
 *    使用者唯一能做的就是亂按「繼續」，而預算停手時不加點就按繼續會原地彈回 waiting，
 *    看起來就像功能壞掉。
 */

const STEP_STATUS_PILL: Record<GroupStepStatus, PillStatus> = {
  pending: "neutral",
  running: "running",
  waiting: "queued",
  done: "done",
  failed: "failed",
  stopped: "neutral",
  skipped: "neutral",
};
const STEP_STATUS_LABEL: Record<GroupStepStatus, string> = {
  pending: "待辦",
  running: "進行中",
  waiting: "等人",
  done: "完成",
  failed: "失敗",
  stopped: "已停",
  skipped: "略過",
};
const RUN_STATUS_PILL: Record<GroupRunStatus, PillStatus> = {
  awaiting_approval: "queued",
  running: "running",
  waiting: "queued",
  done: "done",
  failed: "failed",
  stopped: "neutral",
  discarded: "neutral",
};
const STEP_KIND_ICON: Record<GroupStepKind, "FolderGit2" | "Sparkles" | "Search" | "User" | "Pause" | "FileText"> = {
  create_project: "FolderGit2",
  dispatch: "Sparkles",
  watch: "Search",
  assign_task: "User",
  wait_for_human: "Pause",
  report: "FileText",
};

/**
 * 授權額度的預設選項。
 *
 * 用固定幾檔而不是一個數字輸入框：手機上要人打數字本來就難，更重要的是
 * 「隨便填一個數」與「挑一個我理解的檔位」是兩種決策品質——這個數字的意思是
 * 「我允許 AI 在我不在場時花掉多少」，值得用選的。刻意不提供「無上限」。
 */
const BUDGET_CHOICES: ReadonlyArray<{ points: number; label: string; note: string }> = [
  { points: 0, label: "每份都問我", note: "AI 排完計畫就停下來，每一份子計畫都要你親自按核准" },
  { points: 60, label: "60 點內自動", note: "小額的子計畫 AI 自己核准，超過就停下來問你" },
  { points: 200, label: "200 點內自動", note: "整條線大致跑得完；超過仍會停下來問你" },
];

export function GroupCampaignPanel({ groupId }: { groupId: string }) {
  const [goal, setGoal] = useState("");
  const [budgetPoints, setBudgetPoints] = useState(0);
  const utils = trpc.useUtils();

  const level = trpc.teamAssistant.commandLevel.useQuery({ groupId }, { enabled: !!groupId });
  const allowed = canRunCampaign((level.data as GroupCommandLevel | undefined) ?? "none");

  const campaigns = trpc.teamAssistant.campaigns.useQuery(
    { groupId },
    {
      enabled: !!groupId && allowed,
      // 有計畫在跑就跟上執行器的節奏（它每 8 秒推進一步）；都結束了就不再打擾伺服器
      refetchInterval: (query) =>
        (query.state.data ?? []).some((r) => r.status === "running" || r.status === "waiting") ? 8_000 : false,
    },
  );

  const invalidate = () => void utils.teamAssistant.campaigns.invalidate({ groupId });
  const plan = trpc.teamAssistant.planCampaign.useMutation({
    onSuccess: () => {
      setGoal("");
      invalidate();
    },
  });

  if (!level.isSuccess) return null;
  if (!allowed) return null;

  const runs = campaigns.data ?? [];

  return (
    <section className="campaign-panel">
      <div className="campaign-panel__head">
        <strong>AI 調度</strong>
        <Chip>整個組</Chip>
      </div>
      <Hint>
        說一個跨專案的目標，組代理會排一份多步計畫：需要的話先開新專案，再把內容派給各專案的
        AI 去做，並盯著跑完。排完會先給你過目，你按核准它才開始動。
      </Hint>

      <label className="campaign-panel__field">
        <span className="campaign-panel__label">要達成什麼</span>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="例：幫我開一個中秋活動宣傳專案，做一支 30 秒的短片，並排好誰負責什麼"
        />
      </label>

      <div className="campaign-panel__budget">
        <span className="campaign-panel__label">沒人看著時，可以自己花多少</span>
        <div className="campaign-panel__choices">
          {BUDGET_CHOICES.map((c) => (
            <Chip key={c.points} selected={budgetPoints === c.points} onClick={() => setBudgetPoints(c.points)}>
              {c.label}
            </Chip>
          ))}
        </div>
        <Meta as="p">{BUDGET_CHOICES.find((c) => c.points === budgetPoints)?.note}</Meta>
      </div>

      <Button
        variant="primary"
        disabled={goal.trim().length < 5 || plan.isPending}
        onClick={() => plan.mutate({ groupId, goal: goal.trim(), budgetPoints })}
      >
        <Icon name="Sparkles" size={14} />
        {plan.isPending ? "排計畫中…" : "排一份計畫"}
      </Button>
      {plan.error ? <Hint role="alert">{plan.error.message}</Hint> : null}

      {campaigns.isLoading ? <Meta as="p">讀取計畫中…</Meta> : null}
      {!campaigns.isLoading && runs.length === 0 ? (
        <Meta as="p">還沒有排過調度計畫。</Meta>
      ) : null}
      {runs.map((run) => (
        <CampaignCard key={run.id} run={run} onChanged={invalidate} />
      ))}
    </section>
  );
}

/** 一份 campaign 的卡片：摘要、進度、步驟、以及這個狀態下唯一該按的那顆鈕 */
function CampaignCard({
  run,
  onChanged,
}: {
  run: {
    id: string;
    goal: string;
    summary: string | null;
    status: string;
    steps: unknown;
    budgetPoints: number;
    spentPoints: number;
  };
  onChanged: () => void;
}) {
  const [, navigate] = useLocation();
  const [addBudget, setAddBudget] = useState(60);
  const settled = { onSuccess: onChanged };
  const approve = trpc.teamAssistant.approveCampaign.useMutation(settled);
  const discard = trpc.teamAssistant.discardCampaign.useMutation(settled);
  const stop = trpc.teamAssistant.stopCampaign.useMutation(settled);
  const resume = trpc.teamAssistant.resumeCampaign.useMutation(settled);

  // steps 是 jsonb，tRPC 推不出型別——與伺服器同形狀，前端自己標（同 AgentCard 的做法）
  const steps = (run.steps ?? []) as GroupCampaignStep[];
  const status = run.status as GroupRunStatus;
  const { done, total } = campaignProgress(steps);
  const wait = status === "waiting" ? resolveCampaignWaitReason(steps) : null;
  const error = approve.error ?? discard.error ?? stop.error ?? resume.error;

  return (
    <Card className="campaign-card">
      <div className="campaign-card__head">
        <Pill status={RUN_STATUS_PILL[status] ?? "neutral"}>{GROUP_RUN_STATUS_LABEL[status] ?? status}</Pill>
        <strong className="campaign-card__goal">{run.goal}</strong>
      </div>
      <Meta as="p">{run.summary ?? `${total} 步`}</Meta>
      {total > 0 ? (
        <Meta as="p">
          進度 {done}/{total} 步・已自動花 {run.spentPoints}/{run.budgetPoints} 點
        </Meta>
      ) : null}

      <ol className="campaign-card__steps">
        {steps.map((s) => (
          <li key={s.id} className="campaign-card__step">
            {/* 圖示不是唯一資訊：種類名一起寫出來，讀屏與色弱使用者才知道這步是「開專案」還是「派工」 */}
            <Icon name={STEP_KIND_ICON[s.kind] ?? "FileText"} size={13} aria-hidden />
            <span className="campaign-card__step-title">
              <Meta as="span">{GROUP_STEP_KIND_LABEL[s.kind] ?? s.kind}</Meta>
              {" "}{s.title}
              {s.projectTitle ? <Meta as="span">・{s.projectTitle}</Meta> : null}
            </span>
            <Pill status={STEP_STATUS_PILL[s.status]}>{STEP_STATUS_LABEL[s.status]}</Pill>
          </li>
        ))}
      </ol>

      {/* 等待中的兩種成因解法完全不同：人工關卡要人去做事、預算停手要人加授權。
          不分成因的話使用者只會亂按「繼續」，而預算停手時不加點按繼續會原地彈回 waiting。 */}
      {wait ? (
        <Hint role="status">
          {wait.kind === "budget" ? "停下來等你加授權：" : "等你處理："}
          {wait.detail}
        </Hint>
      ) : null}

      <div className="campaign-card__actions">
        {status === "awaiting_approval" ? (
          <>
            <Button variant="primary" size="sm" disabled={approve.isPending} onClick={() => approve.mutate({ runId: run.id })}>
              {approve.isPending ? "核准中…" : "核准開跑"}
            </Button>
            <ConfirmButton
              title="放棄這份計畫？"
              message="還沒開始執行，沒有花任何點數。放棄後要重排一次。"
              confirmLabel="放棄"
              onConfirm={() => discard.mutate({ runId: run.id })}
            >
              放棄
            </ConfirmButton>
          </>
        ) : null}

        {status === "running" ? (
          <ConfirmButton
            title="停止這份調度計畫？"
            message="組代理不再下新指令。已經派出去、已經核准的子計畫不會被一併停掉——那些要到各專案自己停。"
            confirmLabel="停止"
            onConfirm={() => stop.mutate({ runId: run.id })}
          >
            <Icon name="CircleStop" size={13} />停止
          </ConfirmButton>
        ) : null}

        {status === "waiting" ? (
          <>
            {wait?.kind === "budget" ? (
              <div className="campaign-card__addbudget">
                <span className="campaign-panel__label">加多少授權</span>
                <div className="campaign-panel__choices">
                  {[0, 60, 200].map((p) => (
                    <Chip key={p} selected={addBudget === p} onClick={() => setAddBudget(p)}>
                      {p === 0 ? "不加" : `+${p} 點`}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              disabled={resume.isPending}
              onClick={() => resume.mutate({ runId: run.id, addBudgetPoints: wait?.kind === "budget" ? addBudget : 0 })}
            >
              {resume.isPending ? "繼續中…" : "繼續"}
            </Button>
            <ConfirmButton
              title="停止這份調度計畫？"
              message="組代理不再下新指令。已經派出去的子計畫不受影響。"
              confirmLabel="停止"
              onConfirm={() => stop.mutate({ runId: run.id })}
            >
              停止
            </ConfirmButton>
          </>
        ) : null}

        {/* 開出來的專案要點得進去——不然使用者只看得到「完成」，卻找不到東西在哪 */}
        {steps
          .filter((s) => s.kind === "create_project" && s.status === "done" && s.projectId)
          .map((s) => (
            <Button key={s.id} variant="ghost" size="sm" onClick={() => navigate(`/p/${s.projectId}`)}>
              <Icon name="FolderGit2" size={13} />
              前往「{s.projectTitle}」
            </Button>
          ))}
      </div>
      {error ? <Hint role="alert">{error.message}</Hint> : null}
    </Card>
  );
}
