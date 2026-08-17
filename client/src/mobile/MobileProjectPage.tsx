import { Suspense, lazy, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../api";
import { Icon, type IconName } from "../components/Icon";
import { AssetImg } from "../components/MediaFallback";
import { Button, EmptyState, Meta, Skeleton } from "../components/ui";
import { registerAssistantPage } from "../lib/assistantContext";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { MobileAiBar } from "./MobileAiBar";
import { usePhoneAnimationRepair } from "./usePhoneAnimationRepair";
import { StageTrack } from "./MobileHome";
import { anchorForSection, continueAnchor, continueLabel, isProjectAnchor, stageSentence } from "./stages";

/**
 * 手機專案頁（<768px）。
 *
 * ## 為什麼不是「把桌面專案頁縮窄」
 *
 * 桌面 `ProjectPage` 是本站最大的一個 chunk（749KB raw／234KB gzip），掛載時
 * 打十一支查詢，其中兩支還在輪詢。它裝的是整套製作工作台：故事編輯器、分鏡中心、
 * 角色定裝卡、場景設定卡、道具卡、知識庫、生成執行、素材庫、留言、交付。
 *
 * 在 390px 的手機上，那 234KB 有九成是使用者這一屏看不到、也按不到的東西。
 * 所以手機版不是同一棵樹加 CSS，而是另一個入口：**先給答案，再按需要載工具**。
 *
 * 第一屏＝專案名 → 進度 → [繼續製作] → 問 AI → 最近素材。四個次級入口
 *（分鏡／素材／角色／知識）都是 `lazy` + 點了才 `import()`，桌面的工作台
 * 一行程式都沒改。
 *
 * ## 深連結相容
 *
 * 網址仍是 `/p/:id`，錨點仍是 `#story`／`#storyboard`／`#production`——
 * 通知、書籤與桌機分享過來的連結在手機上照樣落在對的地方（見 `openFull`）。
 */

/**
 * 桌面工作台本體：只有在使用者明確要求「打開完整工作台」時才 import。
 *
 * 這是整個手機重構最大的一筆節省——不點它，那 234KB gzip 永遠不會下載。
 */
const FullProjectPage = lazyWithRetry(() =>
  import("../pages/ProjectPage").then((m) => ({ default: m.ProjectPage })),
);

/** 手機素材抽屜：縮圖牆＋分頁載入，點「素材」才載 */
const MobileAssetSheet = lazy(() => import("./MobileAssetSheet"));

type SecondaryEntry = { key: string; label: string; icon: IconName; hint: string; anchor: string | null };

/**
 * 次級入口。手機首屏只放這四個，其餘（設定、歷史、成員、交付）留在完整工作台裡——
 * 每一個都是「點了才載」，不點就不下載、不掛載、不查詢。
 */
const SECONDARY: SecondaryEntry[] = [
  // anchor 一律取自 storyInlineNav 的單一出處（section id ≠ DOM id，踩過一次了）。
  // 素材走自己的抽屜，不進工作台，所以 anchor 是 null。
  { key: "storyboard", label: "分鏡", icon: "Clapperboard", hint: "看每一鏡、接著往下排", anchor: anchorForSection("storyboard") },
  { key: "assets", label: "素材", icon: "Image", hint: "這個專案的圖與影片", anchor: null },
  { key: "characters", label: "角色", icon: "Users", hint: "角色定裝與一致性", anchor: anchorForSection("characters") },
  { key: "knowledge", label: "知識", icon: "FileText", hint: "腳本、開示稿、參考資料", anchor: anchorForSection("scenes") },
];

export function MobileProjectPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [assetsOpen, setAssetsOpen] = useState(false);
  /**
   * 「打開完整工作台」是一條單向門：一旦載進來就留著（回到摘要再打開不必重抓 chunk），
   * 但**預設是關的**——第一屏永遠不付它的錢。
   */
  const [fullOpen, setFullOpen] = useState(false);

  /**
   * 深連結：`/p/:id#stage-board` 這種網址從通知、書籤或桌機分享過來時，手機不能
   * 只顯示摘要就當作到了——使用者要的是那一段。有 hash 就直接進工作台並帶著錨點。
   *
   * 只在掛載時看一次：之後的 hash 變動是 openFull 自己寫的，再讀一次會打架。
   */
  const [initialHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, ""),
  );

  const summary = trpc.phone.project.useQuery(
    { projectId: id },
    {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  );

  const project = summary.data?.project;
  const stage = summary.data?.stage ?? "story";
  const animation = usePhoneAnimationRepair({
    projectId: id,
    repairResume: summary.data?.repairResume ?? null,
  });

  // 助手頁面感知：報出專案身分，助手的快捷才會是「看進度／繼續製作／找缺漏」
  useEffect(
    () => registerAssistantPage({ pageType: "project", projectId: id, projectTitle: project?.title }),
    [id, project?.title],
  );

  /** 進完整工作台，並把錨點帶過去——深連結契約與桌面版相同 */
  const openFull = (anchor?: string) => {
    setFullOpen(true);
    if (anchor) {
      // chunk 還在下載時 getElementById 拿不到；工作台掛好後再捲（3 秒放棄，只是少捲動）
      const deadline = Date.now() + 3000;
      const tick = () => {
        const el = document.getElementById(anchor);
        if (el) el.scrollIntoView();
        else if (Date.now() < deadline) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  };

  // 帶著 hash 進來就直接開工作台（等同使用者自己按了「繼續製作」）
  useEffect(() => {
    if (initialHash && isProjectAnchor(initialHash)) openFull(initialHash);
    // openFull 是穩定的區域函式；刻意只在掛載時跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHash]);

  /**
   * 已經在這一頁時的錨點交接。
   *
   * 助手結果卡的「去裁決候選」導到 `/p/:id#stage-create`。使用者若本來就在這個
   * 專案的摘要頁，路由沒有換頁、元件沒有重掛，上面那支只跑一次的 effect 不會再跑——
   * 症狀是按了按鈕但畫面完全沒動，看起來像壞掉的按鈕而不是漏掉的監聽器。
   *
   * 這是**唯一**會自動打開完整工作台的第二條路徑，而且仍然由使用者的一次點擊
   * 觸發：卡片不會自己導航，工作台也不會因為卡片渲染就被載進來（計畫 §10／§11）。
   */
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash && isProjectAnchor(hash)) openFull(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (fullOpen) {
    return (
      <div className="m-project-full">
        <button type="button" className="m-secondary-link m-secondary-link--back" onClick={() => setFullOpen(false)}>
          <Icon name="ArrowLeft" size={15} />
          回專案摘要
        </button>
        <Suspense fallback={<Skeleton height={240} role="status" aria-label="載入完整工作台" />}>
          <FullProjectPage id={id} />
        </Suspense>
      </div>
    );
  }

  if (summary.isLoading && !summary.data) {
    return (
      <div className="m-project">
        <Skeleton height={96} />
        <Skeleton height={44} />
        <Skeleton height={72} />
      </div>
    );
  }

  const data = summary.data;
  if (summary.isError || !data || !project) {
    return (
      <div className="m-project">
        <EmptyState
          icon={<Icon name="XCircle" size={28} />}
          title="打不開這個專案"
          description={summary.error?.message ?? "可能已被封存，或你不在這個組裡。"}
          action={<Button variant="tonal" onClick={() => navigate("/dashboard")}>回首頁</Button>}
        />
      </div>
    );
  }

  const progress = data.progress;
  const statusLine = stageSentence({
    stage,
    shots: progress.shots,
    shotsWithVisual: progress.shotsWithVisual,
    awaitingGenerations: progress.awaitingGenerations,
  });

  return (
    <div className="m-project">
      <header className="m-project__head">
        <h1 className="m-project__title">{project.title}</h1>
        <p className="m-project__status">{statusLine}</p>
      </header>

      <StageTrack stage={stage} />

      <Button variant="primary" className="m-current__go" onClick={() => openFull(continueAnchor(stage))}>
        <Icon name="Play" size={16} />
        {continueLabel(stage)}
      </Button>

      {/* 「問 AI」緊接在「繼續製作」下面：不知道下一步該做什麼的人，這裡就能問 */}
      <MobileAiBar
        placeholder="問 Aios 這個專案的事"
        lead={{
          label: "接下來要做什麼？",
          prompt: `「${project.title}」目前${statusLine}。接下來最該做的是什麼？請直接幫我開始。`,
        }}
        groupId={project.groupId}
        projectId={id}
        projectTitle={project.title}
        statusLine={statusLine}
        animationCard={animation.card}
        onInterceptSend={animation.tryHandle}
        onRunCommand={(command) => {
          void animation.runCommand(command as Parameters<typeof animation.runCommand>[0]);
        }}
      />

      <section className="m-project__stats" aria-label="目前工作">
        <h2 className="m-section-title">最近工作</h2>
        <ul className="m-stats">
          <StatItem label="分鏡" value={`${progress.shotsWithVisual}／${progress.shots}`} hint="已有畫面" />
          <StatItem label="素材" value={String(progress.assets)} hint="這個專案" />
          <StatItem
            label="生成"
            value={progress.runningGenerations > 0 ? `${progress.runningGenerations} 進行中` : String(progress.generationsDone)}
            hint={progress.awaitingGenerations > 0 ? `${progress.awaitingGenerations} 待裁決` : "已完成"}
          />
        </ul>
      </section>

      {data.recentAssets.length > 0 && (
        <section className="m-project__assets" aria-label="最近素材">
          <h2 className="m-section-title">最近素材</h2>
          <ul className="m-thumbs">
            {data.recentAssets.map((asset) => (
              <li key={asset.id}>
                {/* loading="lazy" + decoding="async"：首屏不下載捲動線以下的原圖；
                    固定 aspect-ratio 讓格子在圖到位前就佔好位，不產生 layout shift */}
                <AssetImg
                  src={asset.url}
                  alt={asset.title}
                  loading="lazy"
                  decoding="async"
                  fallbackHeight="100%"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="m-entries" aria-label="這個專案的其他部分">
        {SECONDARY.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="m-entries__row"
            onClick={() => (entry.anchor === null ? setAssetsOpen(true) : openFull(entry.anchor))}
          >
            <span className="m-entries__icon"><Icon name={entry.icon} size={18} /></span>
            <span className="m-entries__text">
              <strong>{entry.label}</strong>
              <small>{entry.hint}</small>
            </span>
            <Icon name="ChevronRight" size={16} />
          </button>
        ))}
      </nav>

      <button type="button" className="m-secondary-link" onClick={() => openFull()}>
        打開完整工作台
        <Icon name="ChevronRight" size={15} />
      </button>

      {assetsOpen && (
        <Suspense fallback={null}>
          <MobileAssetSheet projectId={id} onClose={() => setAssetsOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

function StatItem({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <li className="m-stats__item">
      <Meta as="span" className="m-stats__label">{label}</Meta>
      <strong className="m-stats__value">{value}</strong>
      <Meta as="small" className="m-stats__hint">{hint}</Meta>
    </li>
  );
}

export default MobileProjectPage;
