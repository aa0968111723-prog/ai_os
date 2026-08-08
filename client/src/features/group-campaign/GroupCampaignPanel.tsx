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

export function GroupCampaignPanel({
  groupId,
  collapsible = false,
}: {
  groupId: string;
  /**
   * 收合成一列（助手 sheet 用）。
   *
   * 這張面板攤開是一整版說明＋表單＋預算選項——放在助手 sheet 最上方時，
   * 問答的輸入框被推到看不見，整張 sheet 變成一面字牆（實機截圖回報「字太多」）。
   * 收合後只剩一列「AI 調度」，有計畫等人核准／等授權時掛上計數徽章提醒展開。
   *
   * 做成 prop 而不是一律收合：工作台等寬裕版位仍可整張攤開，
   * 且既有測試（直接 render 本元件、斷言內部欄位 toBeVisible）不必每案先點一下。
   */
  collapsible?: boolean;
}) {
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
  // 等人的計畫數：awaiting_approval 等核准、waiting 等人工關卡或加授權——收合時靠徽章提醒
  const attention = runs.filter((r) => r.status === "awaiting_approval" || r.status === "waiting").length;

  const body = (
    <>
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
    </>
  );

  if (collapsible) {
    return (
      <details className="campaign-panel campaign-panel--fold">
        <summary className="campaign-panel__summary">
          <Icon name="Compass" size={15} />
          <strong>AI 調度</strong>
          <Meta as="span">說個目標，AI 排計畫、開專案、派工</Meta>
          {attention > 0 && (
            <span className="campaign-panel__attention">{attention} 份等你</span>
          )}
          <Icon name="ChevronDown" size={15} className="campaign-panel__chevron" />
        </summary>
        {body}
      </details>
    );
  }

  return (
    <section className="campaign-panel">
      <div className="campaign-panel__head">
        <strong>AI 調度</strong>
        <Chip>整個組</Chip>
      </div>
      {body}
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
            <div className="campaign-card__step-head">
              {/* 圖示不是唯一資訊：種類名一起寫出來，讀屏與色弱使用者才知道這步是「開專案」還是「派工」 */}
              <Icon name={STEP_KIND_ICON[s.kind] ?? "FileText"} size={13} aria-hidden />
              <span className="campaign-card__step-title">
                <Meta as="span">{GROUP_STEP_KIND_LABEL[s.kind] ?? s.kind}</Meta>
                {" "}{s.title}
                {s.projectTitle ? <Meta as="span">・{s.projectTitle}</Meta> : null}
              </span>
              <Pill status={STEP_STATUS_PILL[s.status]}>{STEP_STATUS_LABEL[s.status]}</Pill>
            </div>
            {/* 規劃時寫下的「這步要做什麼」。核准畫面上只有一行標題（「派工 製作回顧影片」）
                的話，人是在對一件自己看不見內容的事按核准——note 是規劃器本來就產出的欄位，
                以前只是沒渲染出來。 */}
            {s.note ? <Meta as="p" className="campaign-card__step-note">{s.note}</Meta> : null}
            {/* 執行完的實際結果。這是「它到底做了什麼」唯一的直接證據：
                沒有它，一份跑完的計畫在畫面上就只是四個「完成」字樣。 */}
            {s.result ? (
              <p className="campaign-card__step-result">
                <Icon name="Check" size={12} aria-hidden />
                {s.result}
              </p>
            ) : null}
            {s.error ? (
              <p className="campaign-card__step-error">
                <Icon name="TriangleAlert" size={12} aria-hidden />
                {s.error}
              </p>
            ) : null}
            {/* 派工／盯進度這類步驟做完之後，成果在專案裡——一行文字說「做完了」而點不進去，
                使用者仍然看不到東西本身。create_project 的落點在下方動作列（那是整份計畫的成果），
                這裡補的是每一步各自的落點。 */}
            {s.kind !== "create_project" && s.projectId && (s.status === "done" || s.status === "running") ? (
              <button
                type="button"
                className="campaign-card__step-link"
                onClick={() => navigate(`/p/${s.projectId}`)}
              >
                <Icon name="ArrowRight" size={12} aria-hidden />
                看這步的成果{s.projectTitle ? `（${s.projectTitle}）` : ""}
              </button>
            ) : null}
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

      {/* 動作紀錄放在最後：它是事後查證，不該擋在「這一刻該按哪顆」前面 */}
      <CampaignEvidence runId={run.id} />
    </Card>
  );
}

/**
 * 一份計畫的動作紀錄（誰、什麼時候、做了什麼）。
 *
 * 為什麼要單獨露出來：`group_agent_events` 從一開始就完整寫著每一道令的施為者與時間
 * （這整套裡最該被追溯的一件事），但在此之前 client **一個呼叫端都沒有**——
 * 寫得進去、讀不出來。使用者看到的只有幾顆狀態徽章，於是完全合理地問「憑什麼說它做了事」。
 *
 * 預設收合且**收合時不發查詢**（enabled 綁 open）：這是事後查證用的東西，
 * 不該讓每張卡片一渲染就多打一次 API——助手 sheet 一開可能同時有好幾張卡。
 */
function CampaignEvidence({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const detail = trpc.teamAssistant.campaign.useQuery({ runId }, { enabled: open });
  const events = detail.data?.events ?? [];

  return (
    <details className="campaign-evidence" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="campaign-evidence__summary">
        <Icon name="Clock" size={13} />
        做了什麼・動作紀錄
      </summary>
      {detail.isLoading ? <Meta as="p">讀取紀錄中…</Meta> : null}
      {detail.error ? <Hint role="alert">{detail.error.message}</Hint> : null}
      {open && !detail.isLoading && !detail.error && events.length === 0 ? (
        <Meta as="p">還沒有動作紀錄——這份計畫還沒開始執行。</Meta>
      ) : null}
      <ol className="campaign-evidence__list">
        {events.map((ev) => (
          <li key={ev.id} className="campaign-evidence__row">
            {/* 施為者要分清楚：同樣一句「核准了子計畫」，是 AI 在授權額度內自己按的，
                還是某個人親手按的，責任歸屬完全不同。 */}
            <span className={`campaign-evidence__actor is-${ev.actorType}`}>
              {ACTOR_LABEL[ev.actorType] ?? ev.actorType}
            </span>
            <span className="campaign-evidence__text">{ev.summary}</span>
            <Meta as="span">{formatEventTime(ev.createdAt)}</Meta>
          </li>
        ))}
      </ol>
    </details>
  );
}

const ACTOR_LABEL: Record<string, string> = { ai: "AI", human: "人", system: "系統" };

/** 同一天只顯示時間，跨天補上日期——動作紀錄看的是先後順序，年份是噪音 */
export function formatEventTime(at: Date | string, now: Date = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })} ${time}`;
}
