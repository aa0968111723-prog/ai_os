import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { companionDigest, type CompanionCard, type CompanionCardAction } from "@shared/companionDigest";
import { companionHandoffReason, type CompanionDeepLinkTarget } from "@shared/companionDeepLink";
import { deriveOrbState, isTransientOrbState, ORB_TRANSIENT_MS, type OrbState } from "@shared/companionOrb";
import { companionEventOrbSignals } from "@shared/companionRealtime";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { Button, EmptyState, Meta, Skeleton } from "../components/ui";
import { composeToAssistant, openAssistantSurface } from "../lib/assistantCompose";
import { registerAssistantPage } from "../lib/assistantContext";
import { usePhoneAssistantTurn } from "../lib/phoneAssistantBridge";
import { anchorForSection } from "../mobile/stages";
import { AiosOrb } from "./AiosOrb";
import { CompanionRetryConfirm, type RetryItem } from "./CompanionRetryConfirm";
import { useCompanionRealtime } from "./useCompanionRealtime";
import { useVoiceInput } from "./useVoiceInput";
import { openCompanionDeepLink } from "./openInBrowser";
import { enqueueCommand, listQueuedCommands, offlineAcknowledgement, subscribeQueue } from "./offlineQueue";
import { useOrbWidgetSync, widgetLabel } from "./orbWidgetBridge";

/**
 * Companion 首頁——整個 App 的主體。
 *
 * ## 首屏只有五樣東西
 *
 * 問候語 → 一句主動提示 → **Orb** → 「說說看，你今天想做什麼」→ 最多三張卡。
 *
 * 沒有 Dashboard、沒有側邊欄、沒有素材管理器、沒有分鏡編輯器、沒有時間軸。
 * 那些都在 Web 工作站裡，而且會繼續在那裡——Companion 的工作是**把人準確地
 * 送到那一段**，不是把 27 吋的東西縮到 390px。
 *
 * ## 這裡沒有第二套助手
 *
 * 送出走的是既有的 `composeToAssistant()` → `GlobalAssistantSheet` →
 * 既有的意圖判定／能力路由／確認卡／執行與驗證。這個檔案裡沒有任何 mutation、
 * 沒有 model 呼叫、沒有工具執行。卡片上的每一顆按鈕只會做三件事之一：
 * 送出一句話、打開既有面板、或開瀏覽器到一個唯讀畫面。
 *
 * ## Orb 的狀態從哪來
 *
 * 三個來源合併（見 shared/companionOrb.ts 的優先序）：
 * - 語音 hook（listening）
 * - 助手那一輪的投影（thinking／waiting_confirmation）——與手機 Web 同一條接縫
 * - WS 即時事件（executing／進度／failed）
 *
 * 沒有第四個來源，也沒有任何一處直接 setOrbState——那樣做的話，兩個地方
 * 同時寫的那一天，球會開始閃。
 */
export function CompanionHome({
  groupId,
  userName,
  onOpenTab,
}: {
  groupId: string;
  userName?: string;
  onOpenTab?: (tab: "tasks") => void;
}) {
  const utils = trpc.useUtils();
  const [text, setText] = useState("");
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [queued, setQueued] = useState(() => listQueuedCommands().length);
  const [handoff, setHandoff] = useState<string | null>(null);
  const voice = useVoiceInput();

  /**
   * 「失敗的重跑」確認卡（任務書 B5/B8）。
   *
   * 打開＝設定目標專案；資料由 companion.failedGenerations 現抓（staleTime 0：
   * 確認卡上的筆數與點數必須是**現在的**事實，不能是 30 秒前的快取）。
   * 執行＝逐筆呼叫既有 generation.retry；這個元件不含任何生成邏輯。
   */
  const [retryTarget, setRetryTarget] = useState<{ projectId: string } | null>(null);
  const [retryRunning, setRetryRunning] = useState(false);
  const [retryOutcome, setRetryOutcome] = useState<{ succeeded: number; failed: number; firstError?: string } | null>(null);
  const failedList = trpc.companion.failedGenerations.useQuery(
    { projectId: retryTarget?.projectId ?? "" },
    { enabled: !!retryTarget, staleTime: 0 },
  );
  const retryMutation = trpc.generation.retry.useMutation();

  const digest = trpc.companion.digest.useQuery(
    { groupId },
    {
      enabled: !!groupId,
      // 30 秒內回到首頁不重打；真正的即時性由 WS 事件負責，不靠輪詢。
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      placeholderData: (previous) => previous,
    },
  );

  const resync = useCallback(() => {
    void utils.companion.digest.invalidate({ groupId });
  }, [utils, groupId]);
  const { live } = useCompanionRealtime({ groupId, enabled: !!groupId, onResync: resync });

  const projects = digest.data?.projects ?? [];
  const current = projects[0];

  /**
   * 助手頁面感知：Companion 首頁＝組級視野，但**帶著目前那個專案的身分**。
   * 與手機 Web 首頁同一個作法（見 mobile/MobileHome.tsx）——使用者心裡有一個
   * 「目前專案」，不補上去的話，「第二幕改成晚上」會不知道是哪一案的第二幕。
   */
  useEffect(
    () => registerAssistantPage({
      pageType: "home",
      ...(current ? { projectId: current.id, projectTitle: current.title } : {}),
    }),
    [current?.id, current?.title],
  );

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => subscribeQueue(() => setQueued(listQueuedCommands().length)), []);

  /**
   * 連線恢復時把待送出的話**交給使用者再確認**，而不是自動全部送出。
   *
   * 自動送的問題：離線半小時累積的三句話會在同一秒鐘一起執行，而其中兩句
   * 可能已經被第三句取代了（「重跑失敗的」→「算了先不要」）。所以連上網之後
   * 只是把最新那句填回輸入框，按不按由人決定。
   */
  useEffect(() => {
    if (!online) return;
    const pending = listQueuedCommands();
    if (!pending.length) return;
    setText((prev) => prev || pending[pending.length - 1].text);
  }, [online]);

  const turn = usePhoneAssistantTurn({ groupId });
  const [transientState, setTransientState] = useState<OrbState | null>(null);

  const orb = useMemo(() => {
    const eventSignals = companionEventOrbSignals(live);
    return deriveOrbState({
      listening: voice.status === "listening",
      thinking: !!turn?.running,
      awaitingConfirmation: (turn?.pendingProposals?.length ?? 0) > 0 || !!turn?.pendingInteraction
        || eventSignals.awaitingConfirmation,
      executing: eventSignals.executing,
      ...(typeof eventSignals.progress === "number" ? { progress: eventSignals.progress } : {}),
      failed: eventSignals.failed,
    });
  }, [live, voice.status, turn?.running, turn?.pendingProposals?.length, turn?.pendingInteraction]);

  /**
   * 一次性回饋（success／error／notification）由這裡管，不是由 deriveOrbState 管。
   *
   * `deriveOrbState` 是純投影：同一份訊號一定得到同一顆球。而「剛剛成功了」
   * 本質上帶時間——它必須在兩秒後自己消失。把時間放進純函式會讓它測不動，
   * 所以退場計時器留在元件層。
   */
  const previousRunning = useRef(false);
  useEffect(() => {
    const running = !!turn?.running;
    const finished = previousRunning.current && !running;
    previousRunning.current = running;
    if (!finished) return;
    const verified = (turn?.results?.length ?? 0) > 0;
    if (!verified) return;
    setTransientState("success");
  }, [turn?.running, turn?.results?.length]);

  useEffect(() => {
    if (!transientState || !isTransientOrbState(transientState)) return;
    const ttl = ORB_TRANSIENT_MS[transientState] ?? 2000;
    const timer = setTimeout(() => setTransientState(null), ttl);
    return () => clearTimeout(timer);
  }, [transientState]);

  const orbState: OrbState = transientState && orb.state === "idle" ? transientState : orb.state;

  /**
   * 桌面 Widget 的小球。
   *
   * **只有這裡推**，不是外殼也推一份：兩個地方各自推、各自記「上次推了什麼」的話，
   * 每一次狀態變化都會來回覆蓋（一個送泛用文案、一個送具體數字），
   * 使用者會看到桌面那顆球的文字在兩句話之間跳。
   */
  const totals = digest.data?.totals;
  useOrbWidgetSync(
    orbState,
    widgetLabel(orbState, {
      awaiting: totals?.awaiting ?? 0,
      failed: totals?.failed ?? 0,
      running: totals?.running ?? live.running,
    }),
  );

  const view = useMemo(
    () => companionDigest({
      nowHour: new Date().getHours(),
      ...(userName ? { userName } : {}),
      projects,
    }),
    [projects, userName],
  );

  /**
   * 送出一句話。
   *
   * 離線時**不假裝已執行**：排進待送出佇列，並照實說「我先記住這句」。
   */
  const send = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setText("");
    if (!navigator.onLine) {
      const pending = enqueueCommand({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: trimmed,
        ...(current ? { projectId: current.id } : {}),
      });
      setQueued(pending.length);
      setHandoff(offlineAcknowledgement(pending.length));
      return;
    }
    setHandoff(null);
    composeToAssistant(trimmed, { autoSend: true });
  }, [current?.id]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(text);
  };

  const openWeb = useCallback((target: string, projectId?: string) => {
    const deepTarget = target as CompanionDeepLinkTarget;
    const opened = openCompanionDeepLink({
      target: deepTarget,
      ...(projectId ? { projectId } : {}),
      anchorId: anchorIdFor(deepTarget),
    });
    // 開不起來要講出來——按了沒反應是最難回報的那種 bug。
    setHandoff(opened ? companionHandoffReason(deepTarget) : "瀏覽器沒有打開，請再試一次。");
  }, []);

  /**
   * 逐筆重跑、逐筆記結果——部分失敗就照實說 N 成功 M 失敗。
   * Orb 的 executing 不在這裡設：retry 讓生成翻 running 時，伺服器會發
   * generation_started 的 companion-event，球自己會轉。
   */
  const runRetry = useCallback(async () => {
    const items = failedList.data?.items ?? [];
    if (!items.length) {
      setRetryOutcome({ succeeded: 0, failed: 0 });
      return;
    }
    setRetryRunning(true);
    let succeeded = 0;
    let failed = 0;
    let firstError: string | undefined;
    for (const item of items) {
      try {
        await retryMutation.mutateAsync({ id: item.id });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        firstError ??= error instanceof Error ? error.message : String(error);
      }
    }
    setRetryRunning(false);
    setRetryOutcome({ succeeded, failed, ...(firstError ? { firstError } : {}) });
    resync();
  }, [failedList.data, retryMutation, resync]);

  const runCardAction = useCallback((card: CompanionCard, action: CompanionCardAction) => {
    if (action.kind === "compose" && action.prompt) {
      // 單一專案的重跑：語意完全確定（該案所有 failed → 逐筆 retry），
      // 走確定性確認卡而不是丟給助手。多專案聚合卡沒有 projectId → 照舊 compose。
      if (action.actionId === "retry_generation" && card.projectId) {
        setRetryOutcome(null);
        setRetryTarget({ projectId: card.projectId });
        return;
      }
      send(card.projectId ? `在「${card.title}」：${action.prompt}` : action.prompt);
      return;
    }
    if (action.kind === "open_web" && action.target) {
      openWeb(action.target, action.projectId ?? card.projectId);
      return;
    }
    if (action.kind === "open_tab" && action.tab === "tasks") onOpenTab?.("tasks");
  }, [send, openWeb, onOpenTab]);

  /**
   * 桌面捷徑／Widget 的 `?voice=1`：一進來就開麥克風。
   *
   * 只做一次，而且做完把參數從網址拿掉——不然使用者每次按返回回到首頁
   * 都會再被打開一次麥克風。用 replaceState 是刻意的：這個參數不該進入
   * 上一頁／下一頁的歷史。
   */
  const voiceIntentHandled = useRef(false);
  useEffect(() => {
    if (voiceIntentHandled.current || !voice.supported) return;
    let wanted = false;
    try {
      wanted = new URLSearchParams(window.location.search).get("voice") === "1";
    } catch {
      wanted = false;
    }
    if (!wanted) return;
    voiceIntentHandled.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("voice");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    voice.start();
  }, [voice.supported]);

  const holdStart = useCallback(() => {
    if (!voice.supported) return;
    voice.start();
  }, [voice]);

  const holdEnd = useCallback(() => {
    // stopAsync：原生辨識在 stop 之後才吐最終結果（比最後一段 partial 準），
    // 等它 ≤800ms；web 模式立即返回，行為與 #794 相同。
    void voice.stopAsync().then((said) => {
      if (said) send(said);
    });
  }, [voice, send]);

  if (!groupId) {
    return (
      <div className="companion-home">
        <EmptyState
          icon={<Icon name="Users" size={28} />}
          title="還沒有組別"
          description="到「我」分頁選一個組之後，我就能看到你的專案。"
        />
      </div>
    );
  }

  return (
    <div className="companion-home">
      <header className="companion-home__head">
        <h1 className="companion-home__greeting">{view.greeting}</h1>
        {view.nudge && <p className="companion-home__nudge">{view.nudge}</p>}
      </header>

      <div className="companion-home__orb">
        <AiosOrb
          state={orbState}
          {...(typeof orb.progress === "number" ? { progress: orb.progress } : {})}
          size={208}
          onTap={openAssistantSurface}
          {...(voice.supported ? { onHoldStart: holdStart, onHoldEnd: holdEnd } : {})}
          onSwipeUp={() => onOpenTab?.("tasks")}
          amplitude={voice.amplitude}
        />
        {/* 逐字稿：按住說話時看得到機器聽到什麼，放開才送出 */}
        {voice.status === "listening" && (
          <p className="companion-home__transcript" role="status">
            {voice.transcript || "我在聽…"}
          </p>
        )}
        {voice.status === "denied" && (
          <p className="companion-home__voice-note" role="status">
            麥克風沒有權限，先用打字的也可以。
          </p>
        )}
      </div>

      <form className="companion-home__ask" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="companion-ask">說說看，你今天想做什麼</label>
        <input
          id="companion-ask"
          className="companion-home__input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="說說看，你今天想做什麼"
          enterKeyHint="send"
          autoComplete="off"
        />
        <Button
          variant="primary"
          size="sm"
          type="submit"
          className="companion-home__send"
          disabled={!text.trim()}
          aria-label="送出給 Aios"
        >
          <Icon name="ArrowRight" size={16} />
        </Button>
      </form>

      {!online && (
        <p className="companion-home__offline" role="status">
          <Icon name="TriangleAlert" size={14} />
          目前離線{queued > 0 ? `，${queued} 句等著送出` : ""}
        </p>
      )}
      {handoff && <p className="companion-home__handoff" role="status">{handoff}</p>}

      {retryTarget && failedList.data && (
        <CompanionRetryConfirm
          projectTitle={failedList.data.projectTitle}
          items={failedList.data.items as RetryItem[]}
          totalPointsEst={failedList.data.totalPointsEst}
          running={retryRunning}
          outcome={retryOutcome}
          onConfirm={() => { void runRetry(); }}
          onCancel={() => { setRetryTarget(null); setRetryOutcome(null); }}
        />
      )}

      {digest.isLoading && !digest.data && (
        <div className="companion-home__cards">
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
      )}

      {digest.isError && !digest.data && (
        <EmptyState
          icon={<Icon name="XCircle" size={26} />}
          title="載不到你的專案"
          description={digest.error?.message ?? "連線好像不太穩，再試一次看看。"}
          action={<Button variant="primary" onClick={() => { void digest.refetch(); }}>重試</Button>}
        />
      )}

      {view.cards.length > 0 && (
        <section className="companion-home__cards" aria-label="現在需要你的事">
          {view.cards.map((card) => (
            <article key={card.id} className={`companion-card companion-card--${card.kind}`}>
              <div className="companion-card__text">
                <strong className="companion-card__title">{card.title}</strong>
                <Meta as="span" className="companion-card__line">{card.line}</Meta>
              </div>
              <div className="companion-card__actions">
                {card.actions.map((action) => (
                  <Button
                    key={`${action.kind}:${action.label}`}
                    size="sm"
                    variant={action.kind === "compose" ? "primary" : "ghost"}
                    onClick={() => runCardAction(card, action)}
                  >
                    {action.kind === "open_web" && <Icon name="Monitor" size={14} />}
                    {action.label}
                  </Button>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}

      {!digest.isLoading && projects.length === 0 && (
        <EmptyState
          icon={<Icon name="Sparkles" size={26} />}
          title="還沒有專案"
          description="跟我說你想做什麼，我幫你建起來。"
        />
      )}
    </div>
  );
}

/**
 * 專案頁區段 → 真正渲染在 DOM 上的錨點。
 *
 * 錨點字串的唯一出處是 `mobile/stages.ts`（它又從 `STORY_INLINE_SECTIONS` 推導）。
 * 在這裡自己寫 `#storyboard` 會得到一個永遠捲不到的連結，而且不會報錯——
 * 那個坑的完整記載在 stages.ts 的 `continueAnchor` 檔頭。
 */
function anchorIdFor(target: CompanionDeepLinkTarget): string | undefined {
  switch (target) {
    case "storyboard":
      return anchorForSection("storyboard");
    case "production":
      return anchorForSection("production");
    case "delivery":
      return anchorForSection("delivery");
    case "characters":
      return anchorForSection("characters");
    case "scenes":
      return anchorForSection("scenes");
    default:
      return undefined;
  }
}

export default CompanionHome;
