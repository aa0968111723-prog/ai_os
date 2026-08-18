import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { Button, EmptyState, Meta, Skeleton } from "../components/ui";
import { registerAssistantPage } from "../lib/assistantContext";
import { NEW_PROJECT_IDEA_EVENT, takePendingNewProjectIdea } from "../lib/newProjectIdea";
import { MobileAiBar } from "./MobileAiBar";
import { MobileCreateProjectSheet } from "./MobileCreateProjectSheet";
import { MOBILE_STAGES, continueAnchor, continueLabel, stageIndex, stageSentence } from "./stages";

/**
 * 手機首頁（<768px）。
 *
 * ## 首屏只有五樣東西
 *
 * 目前專案 → 做到哪裡 → [繼續製作] → AI 輸入 → 2–4 顆快捷。
 *
 * 桌面的 `Launchpad` 是專案總表：搜尋、類型篩選、排序、封存切換、卡片／列表版面、
 * 全組現況、協作游標、建立專案表單。那些在 27 吋螢幕上是「一覽」，在 390px 上是
 * 「要捲六螢才看得到自己昨天在做的那個案子」。手機首屏因此只回答一個問題：
 * **我昨天做到哪、現在按哪裡繼續**。
 *
 * 其餘入口沒有消失，只是退到第二層：底欄的「更多」面板仍是全站頁面總表，
 * 下面那條「看全部專案」把人帶到桌面版的專案列表（同一個 `/dashboard#projects` 網址）。
 *
 * ## 資料
 *
 * 一支 `phone.home`（見 server/routers/phone.ts）取代桌面首頁的五支查詢。
 * 沒有輪詢——手機在背景時輪詢只是在燒電量與流量；回到前景時 react-query 的
 * `refetchOnWindowFocus` 自然會補一次。
 */
export function MobileHome({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  /**
   * 「看全部專案」不是導到另一頁，而是把同一支查詢換成大 limit 重打。
   * 手機首屏只付 5 筆的錢；真的想看全部的人才付全部的錢（漸進式載入）。
   * 換 limit＝換 query key，react-query 自動去抓，且 5 筆那份仍留在快取裡。
   */
  const [showAll, setShowAll] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const create = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      void utils.projects.list.invalidate();
      void utils.phone.home.invalidate();
      setCreateOpen(false);
      navigate(`/p/${project.id}`);
    },
  });
  const home = trpc.phone.home.useQuery(
    { groupId, ...(showAll ? { limit: 100 } : {}) },
    {
      enabled: !!groupId,
      // 30 秒內回到首頁不重打：手機在專案與首頁之間來回是最常見的動線
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      /**
       * 換 limit＝換 query key＝一支全新的查詢，data 會瞬間變 undefined。
       * 沒有這行的話，按「看全部專案」會讓**整個首頁閃回骨架**——目前專案、
       * 進度、繼續製作全部消失一兩秒，連 AI 輸入列裡打到一半的字都會被卸載掉。
       * 保留前一份資料，新的到了才換上，畫面只是「多了幾列」。
       */
      placeholderData: (previous) => previous,
    },
  );

  const projects = home.data?.projects ?? [];
  const current = projects[0];
  const currentStatus = current
    ? stageSentence({
      stage: current.stage,
      shots: current.shots,
      shotsWithVisual: current.shotsWithVisual,
      awaitingGenerations: current.awaitingGenerations,
    })
    : undefined;

  /**
   * 助手頁面感知：首頁＝全站視角，但**帶著目前那個專案的身分**。
   *
   * #766 這裡註冊的是 `{ pageType: "home" }`，於是在首頁說「第二幕改成晚上」時，
   * 助手真的不知道是哪個專案的第二幕——使用者心裡有一個「目前專案」，系統沒有。
   * 補上 projectId／projectTitle 之後，上下文膠囊看得見它、`composePhoneGoal`
   * 也補得出「在「百日夢島」：…」。
   *
   * 這仍然只是**提示**：線上白名單不送 projectId，伺服器一律重新 requireGroup
   * 與專案查詢（見 lib/assistantContext 不變式 2），而助手面板的視野仍由路由決定
   * （`/dashboard` → 組級），所以快捷與視野 chip 的行為與 #766 完全相同。
   */
  useEffect(
    () => registerAssistantPage({
      pageType: "home",
      ...(current ? { projectId: current.id, projectTitle: current.title } : {}),
    }),
    [current?.id, current?.title],
  );

  const openCreate = (title = "") => {
    setCreateTitle(title);
    setCreateOpen(true);
  };

  useEffect(() => {
    const pending = takePendingNewProjectIdea();
    if (pending) openCreate(pending);
    const onIdea = (event: Event) => {
      const idea = (event as CustomEvent<{ ideaTitle?: string }>).detail?.ideaTitle?.trim() ?? "";
      takePendingNewProjectIdea();
      openCreate(idea);
    };
    window.addEventListener(NEW_PROJECT_IDEA_EVENT, onIdea);
    return () => window.removeEventListener(NEW_PROJECT_IDEA_EVENT, onIdea);
  }, []);

  if (!groupId) {
    return (
      <div className="m-home">
        <EmptyState
          icon={<Icon name="Users" size={28} />}
          title="還沒有組別"
          description="到頂欄選一個組之後，這裡會顯示你最近在做的專案。"
        />
      </div>
    );
  }

  if (home.isLoading && !home.data) {
    return (
      <div className="m-home">
        <Skeleton height={132} />
        <Skeleton height={44} />
        <Skeleton height={72} />
      </div>
    );
  }

  // 查詢失敗要講「載不到」，不能沿用空狀態——「還沒有專案」會讓使用者以為
  // 自己的專案不見了，那是最不該給的錯誤訊息。
  if (home.isError && !home.data) {
    return (
      <div className="m-home">
        <EmptyState
          icon={<Icon name="XCircle" size={28} />}
          title="載不到你的專案"
          description={home.error?.message ?? "連線好像不太穩，再試一次看看。"}
          action={<Button variant="primary" onClick={() => { void home.refetch(); }}>重試</Button>}
        />
      </div>
    );
  }

  // slice(1) 不再另外截斷：伺服器已經只回首屏該有的那幾筆，前端再砍一刀
  // 只會讓「最近」少一個專案，而使用者永遠不知道少的是哪一個。
  const others = projects.slice(1);

  return (
    <div className="m-home">
      {current ? (
        <section className="m-current" aria-label="目前專案">
          <div className="m-current__head">
            <div className="m-current__head-row">
              <Meta as="span" className="m-current__eyebrow">目前專案</Meta>
              <button type="button" className="m-current__create" onClick={() => openCreate()}>
                <Icon name="Plus" size={14} />
                建立專案
              </button>
            </div>
            <h1 className="m-current__title">{current.title}</h1>
            <p className="m-current__status">{currentStatus}</p>
          </div>

          <StageTrack stage={current.stage} />

          <Button
            variant="primary"
            className="m-current__go"
            onClick={() => navigate(`/p/${current.id}#${continueAnchor(current.stage)}`)}
          >
            <Icon name="Play" size={16} />
            {continueLabel(current.stage)}
          </Button>
        </section>
      ) : (
        <EmptyState
          icon={<Icon name="Package" size={28} />}
          title="還沒有專案"
          description="跟 Aios 說它會建起來"
          action={(
            <Button variant="primary" onClick={() => openCreate()}>
              <Icon name="Plus" size={16} />
              建立專案
            </Button>
          )}
        />
      )}

      {/* AI 是主要入口，所以放在「繼續製作」正下方、拇指區內——不是收在角落的浮標 */}
      <MobileAiBar
        /* placeholder 不放專案名：360px 上會被截成「問 Aios：禪心一炷香（剪輯…」，
           而專案名就在正上方，重複一次只是把提示詞擠掉 */
        placeholder={current ? "問 Aios 接下來做什麼？" : "想做什麼？直接跟 Aios 說"}
        lead={current
          ? { label: "接下來做什麼", prompt: `我最近在做「${current.title}」，目前${currentStatus}。接下來最該做的是什麼？請直接開始。` }
          : undefined}
        groupId={groupId}
        projectTitle={current?.title}
        statusLine={currentStatus}
      />

      {others.length > 0 && (
        <section className="m-recent" aria-label="最近的其他專案">
          <h2 className="m-section-title">{showAll ? "全部專案" : "最近"}</h2>
          <ul className="m-recent__list">
            {others.map((project) => (
              <li key={project.id}>
                <button type="button" className="m-recent__row" onClick={() => navigate(`/p/${project.id}`)}>
                  <span className="m-recent__text">
                    <strong>{project.title}</strong>
                    <small>{stageSentence({
                      stage: project.stage,
                      shots: project.shots,
                      shotsWithVisual: project.shotsWithVisual,
                      awaitingGenerations: project.awaitingGenerations,
                    })}</small>
                  </span>
                  <Icon name="ChevronRight" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 次級入口：首屏不放整份專案總表，按了才去抓 */}
      {!showAll && projects.length > 0 && (
        <button type="button" className="m-secondary-link" onClick={() => setShowAll(true)}>
          看全部專案
          <Icon name="ChevronRight" size={15} />
        </button>
      )}
      {showAll && home.isFetching && <Meta as="p" role="status">載入其餘專案…</Meta>}

      <button type="button" className="m-secondary-link" onClick={() => openCreate()}>
        <Icon name="Plus" size={15} />
        建立專案
      </button>

      {createOpen && groupId && (
        <MobileCreateProjectSheet
          groupId={groupId}
          initialTitle={createTitle}
          creating={create.isPending}
          errorMessage={create.error?.message}
          onClose={() => setCreateOpen(false)}
          onConfirm={(fields) => create.mutate({ groupId, ...fields })}
        />
      )}
    </div>
  );
}

/** 故事 → 分鏡 → 視覺 → 生成 → 交付：五格純文字，目前那格加深 */
export function StageTrack({ stage }: { stage: string }) {
  const at = stageIndex(stage);
  return (
    <ol className="m-stages" aria-label={`目前進度：${MOBILE_STAGES[at].label}`}>
      {MOBILE_STAGES.map((step, index) => (
        <li
          key={step.id}
          className={`m-stages__step${index === at ? " is-current" : index < at ? " is-done" : ""}`}
          aria-current={index === at ? "step" : undefined}
        >
          <Icon name={step.icon} size={14} />
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export default MobileHome;
