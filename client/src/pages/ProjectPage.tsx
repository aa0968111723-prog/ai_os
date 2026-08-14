import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { trpc } from "../api";
import { DISCUSS_EVENT, flashAnchor } from "../discuss";
import { useMatchMedia } from "../lib/useMatchMedia";
import { Icon } from "../components/Icon";
import { ConfirmButton, HelpTip, useFocusTrap } from "../components/interactions";
import { parseWorldviewSafe } from "@shared/parseWorldviewSafe";
import {
  isWorldviewReady,
  worldviewFieldReaderSummary,
  hasActs,
  removesDefaultTaboos,
  toggleWorldviewChip,
  selectWorldviewStyle,
  selectWorldviewStyleFamily,
  keepPrimaryWorldviewStyle,
  promoteWorldviewChip,
  chipSoftWarnings,
  parseWorldviewStyleSlots,
  formatWorldviewStylesLabel,
  stylesForVisualInject,
  STYLE_FAMILY_ORDER,
  STYLE_FAMILY_META,
  STYLE_MEDIA_FAMILY,
  looksForFamily,
  texturesForFamily,
  CHIP_SOFT_MAX,
  isDefaultTaboosOnly,
  applyWorldviewAdvancedExample,
  parsePersonTokenForCharacter,
  type StyleMediaFamily,
  type Worldview,
} from "@shared/worldview";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "@shared/cardLimits";
import { carriedPropIdsFor } from "@shared/propOwnership";
import { SceneList } from "../components/SceneList";
import { ProjectShareCard } from "../components/ProjectShareCard";
import { FormatTag } from "../components/FormatPicker";
import { MessagePanel } from "../components/MessagePanel";
import { AssetLibrary } from "../components/AssetLibrary";
import { RecycleBin } from "../components/RecycleBin";
import { KnowledgeBase } from "../components/KnowledgeBase";
import { ProjectContextPanel } from "../features/project-context/ProjectContextPanel";
import { CharacterCards } from "../components/CharacterCards";
import { ScenePresetCards } from "../components/ScenePresetCards";
import { PropCards } from "../components/PropCards";
import {
  CostumePackSection,
  costumeTabFromTarget,
  type CostumeTab,
} from "../components/CostumePackSection";
import { StoryStage } from "../features/story-workspace/StoryStage";
import { StoryInlineSection } from "../features/story-workspace/StoryInlineSection";
import { StoryReadinessBar } from "../features/story-workspace/StoryReadinessBar";
import {
  STORY_INLINE_REVEAL_EVENT,
  sectionFromHash,
  sectionFromSelector,
  selectorForInlineSection,
  storyReadiness,
  writeInlineHash,
  type StoryInlineRevealDetail,
  type StoryInlineSectionId,
} from "../features/story-workspace/storyInlineNav";
import { DeliveryRoom } from "../features/delivery/DeliveryRoom";
import { StoryboardStage } from "../features/storyboard-center/StoryboardStage";
import { VisibleCreativeWorkspace } from "../features/visible-workspace/VisibleCreativeWorkspace";
import { usePresenterFollow } from "../features/collaboration/usePresenterFollow";
import { FollowStatusBar, PresenterBadge, PresenterInvite, PresentButton } from "../features/collaboration/PresenterBar";
import { PeerBadge, latestViewForUser, sceneLabelOf } from "../features/collaboration/PeerBadge";
import { buildViewState, detectVisibleSection, navigateToView } from "../features/collaboration/viewStateBridge";
import type { ViewSection, ViewState } from "@shared/viewState";
import { registerAssistantPage } from "../lib/assistantContext";
import { CreationWorkbench } from "../features/creation-workbench/CreationWorkbench";
import { loadDraft } from "../features/creation-workbench/creationDraft";
import {
  type DirectGenerateApplyRequest,
} from "../features/creation-workbench/modes/DirectGenerateMode";
import { projectCanEdit } from "../features/creation-workbench/generationGates";
import { revealWorkbenchAnchor, scrollToSelector } from "../features/creation-workbench/workbenchNav";
import { focusAndReveal } from "../lib/scrollIntoViewForChrome";
import {
  PROJECT_CONTEXT_REVEAL_EVENT,
  formatBringInSummary,
  revealProjectContext,
  returnFromContext,
  selectorForContextTarget,
  type ProjectContextRevealDetail,
  type ProjectContextReturnTo,
  type ProjectContextTarget,
} from "../features/project-nav/projectContextNav";
import { ProjectDatabasesCard } from "../components/ProjectDatabasesCard";
import { WorldviewPreview } from "../components/WorldviewPreview";
import { WorldviewGuide } from "../components/WorldviewGuide";
import { WorldviewExampleCard } from "../components/WorldviewExampleCard";
import { StyleVisualGallery } from "../components/StyleVisualGallery";
import { ToneVisualPalette } from "../components/ToneVisualPalette";
import { ThreeActStoryArc } from "../components/StoryFlowVisualizer";
import { Button, Card, Chip, Hint, Meta } from "../components/ui";
import { SectionErrorBoundary } from "../components/SectionErrorBoundary";
import {
  useCollab,
  CursorOverlay,
  CollabZone,
  COLLAB_ZONES,
  CollabModeBar,
  useCollabMirrorFollow,
  zoneOfPeer,
  type CollabViewMode,
} from "../realtime";

/**
 * 協作廣播的保底輪詢間隔。
 *
 * 60 秒是刻意放慢的：廣播正常時它幾乎不會派上用場，而它存在的意義是讓「訊號沒送到」
 * 退化成「慢一分鐘」而不是「永遠停在舊值」。夠慢到不浪費，夠快到不會有人真的被卡住。
 */
const COLLAB_FALLBACK_POLL_MS = 60_000;

/** 與 styles.css 單欄／平板界線對齊：≤820px 為手機減負模式 */
const PROJECT_MOBILE_MQ = "(max-width: 820px)";

type CtxSectionKey = "worldview" | "characters" | "scenes" | "props" | "knowledge" | "databases" | "assets" | "recycle";
type CtxGroupKey = "world" | "sources" | "manage";
export type ToneSubTab = "story" | "costume" | "sources" | "recycle";

/** 手機上下文卡：details 收合；桌機直接渲染 children（版面不變） */
function CtxCollapse({
  compact,
  sectionId,
  title,
  meta,
  open,
  onOpenChange,
  children,
}: {
  compact: boolean;
  sectionId: string;
  title: string;
  meta?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  if (!compact) {
    return <div id={sectionId}>{children}</div>;
  }
  return (
    <Card as="details" variant="quiet" className="project-ctx-collapse"
      id={sectionId}
      open={open}
      onToggle={(e) => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className="project-ctx-collapse__title">{title}</span>
        {meta != null && meta !== "" && <span className="meta project-ctx-collapse__meta">{meta}</span>}
        <Icon name="ChevronDown" size={14} className="details-caret" style={{ marginLeft: "auto" }} />
      </summary>
      <div className="project-ctx-collapse__body">{children}</div>
    </Card>
  );
}

/**
 * 專案上下文分組：把同層級多卡收成「世界與角色／依據與素材」兩大塊。
 * 手機：details 受控收合；桌機：固定區塊標題 + 內容全展開（內層卡仍各自獨立）。
 */
function CtxGroup({
  groupId,
  title,
  lede,
  meta,
  compact,
  open,
  onOpenChange,
  children,
}: {
  groupId: string;
  title: string;
  lede?: string;
  meta?: string;
  compact: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  if (!compact) {
    return (
      <section className="ctx-group" id={groupId} data-fb={title}>
        <header className="ctx-group__head">
          <div className="ctx-group__heading">
            <h3 className="ctx-group__title">{title}</h3>
            {lede ? <p className="ctx-group__lede">{lede}</p> : null}
          </div>
          {meta != null && meta !== "" ? <span className="meta ctx-group__meta">{meta}</span> : null}
        </header>
        <div className="ctx-group__body stack">{children}</div>
      </section>
    );
  }
  return (
    <Card
      as="details"
      variant="quiet"
      className="ctx-group ctx-group--collapse"
      id={groupId}
      open={open}
      onToggle={(e) => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}
      data-fb={title}
    >
      <summary className="ctx-group__summary">
        <span className="ctx-group__title">{title}</span>
        {meta != null && meta !== "" ? <span className="meta ctx-group__meta">{meta}</span> : null}
        <Icon name="ChevronDown" size={14} className="details-caret" style={{ marginLeft: "auto" }} />
      </summary>
      {lede ? <p className="ctx-group__lede ctx-group__lede--in">{lede}</p> : null}
      <div className="ctx-group__body stack">{children}</div>
    </Card>
  );
}

// HelpTip 已移到 components/interactions（SceneList 等元件的標題也要用），這裡從共用處匯入



/**
 * 世界觀欄位「會不會改變我的畫面」徽章。
 *
 * 原本逐欄印出整串「圖影 · 文字生成 · 助手／代理 · 導演 · 匯出（圖影不注入）」——
 * 那是給開發者看的注入矩陣，貼在每個欄位標題旁讀起來像規格書，是這一區顯得
 * 抽象的主因之一。現在只留一句人話，完整清單收進 HelpTip。
 * 單一真相仍是 shared 的 WORLDVIEW_FIELD_READERS（經 worldviewFieldReaderSummary）。
 */
function FieldReaders({ field }: { field: string }) {
  const summary = worldviewFieldReaderSummary(field);
  if (!summary) return null;
  return (
    <Meta as="span" style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, opacity: 0.88 }}>
      {summary.short}
      <HelpTip text={`完整：${summary.detail}`} />
    </Meta>
  );
}


/** 敘事人物快速新增（Enter；與 TokenListEditor 同上限） */
function NarrativePersonAdd({ onAdd, disabled }: { onAdd: (token: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const v = draft.trim().slice(0, 100);
    if (!v || disabled) return;
    onAdd(v);
    setDraft("");
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "4px 6px 4px 0" }}>
      <input
        value={draft}
        aria-label="新增敘事人物"
        placeholder={disabled ? "已達 30 項上限" : "例：安倢＝紅傘、米白外套"}
        maxLength={100}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        onBlur={submit}
        style={{ width: 240, maxWidth: "100%", fontSize: "var(--fs-13)", padding: "4px 10px" }}
      />
    </span>
  );
}

/**
 * 陣列欄位的就地編輯器（世界觀進階層：人物／參考連結／禁忌事項）：
 * chips 呈現現值（點 ✕ 移除）＋行內輸入新增（Enter 送出）。
 * 後端上限：每欄 30 項、每項 100 字（worldviewSchema），前端同步把關。
 */
function TokenListEditor({
  id,
  label,
  values,
  placeholder,
  readOnly,
  hint,
  fieldKey,
  onChange,
}: {
  id: string;
  label: string;
  values: string[];
  placeholder: string;
  readOnly: boolean;
  hint?: string;
  /** 對應 WORLDVIEW_FIELD_READERS 的鍵，顯示誰會讀 */
  fieldKey?: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().slice(0, 100);
    if (!v || values.includes(v) || values.length >= 30) return;
    onChange([...values, v]);
    setDraft("");
  };
  return (
    <>
      <label id={`${id}-label`}>
        {label}
        {fieldKey && <FieldReaders field={fieldKey} />}
        {hint && <HelpTip text={hint} />}
      </label>
      {/* token-chips：≤820 讓長 URL chip 斷行（否則 360px 上移除 ✕ 被 overflow clip 裁在畫面外） */}
      <div role="group" aria-labelledby={`${id}-label`} className="token-chips">
        {values.map((v) => (
          <Chip key={v} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {v}
            {!readOnly && (
              <button
                type="button"
                className="tag-remove"
                aria-label={`移除「${v}」`}
                title="移除"
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <Icon name="X" size={12} />
              </button>
            )}
          </Chip>
        ))}
        {values.length === 0 && readOnly && <Meta>未設定</Meta>}
        {!readOnly && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "4px 6px 4px 0" }}>
            <input
              value={draft}
              aria-label={`新增${label}`}
              placeholder={values.length >= 30 ? "已達 30 項上限" : placeholder}
              maxLength={100}
              disabled={values.length >= 30}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              onBlur={add}
              style={{ width: 220, maxWidth: "100%", fontSize: "var(--fs-13)", padding: "4px 10px" }}
            />
          </span>
        )}
      </div>
    </>
  );
}

/**
 * 生成時勾選的角色/場景 id 持久化（深度優化）：原本存 useState，重整頁面默默歸零，
 * 使用者以為還會注入定裝其實沒有。改存 localStorage（per 專案），並在清單載入後
 * 清掉已被刪除的 id（避免送出失效引用）。
 */
function usePersistedIds(key: string): [string[], (updater: (prev: string[]) => string[]) => void] {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const update = (updater: (prev: string[]) => string[]) =>
    setIds((prev) => {
      const next = updater(prev);
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* 無痕模式等：持久化只是加分 */ }
      return next;
    });
  return [ids, update];
}

/**
 * 選項就地新增（工作台一體化）：世界觀 chips 旁的「＋新增」——組長不必再繞去選項整理頁，
 * 直接在工作台加一個調性／主軸／風格選項，加完全組立即可用、並自動幫本專案勾上。
 * 後端仍走同一個 options.upsert（組長以上限定、同名防撞）。
 */
function AddOptionChip({
  groupId,
  type,
  onAdded,
}: {
  groupId: string;
  type: "tone" | "theme" | "style";
  onAdded: (label: string) => void;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const add = trpc.options.upsert.useMutation({
    onSuccess: (opt) => {
      utils.options.byGroup.invalidate();
      onAdded(opt.label);
      setLabel("");
      setOpen(false);
    },
  });
  const submit = () => {
    const l = label.trim();
    if (!l || add.isPending) return;
    add.mutate({ groupId, type, label: l });
  };
  if (!open) {
    return (
      // 這顆是「打開輸入框」的動作、不是切換態，所以蓋掉 Chip 預設補的 aria-pressed
      <Chip
        title="新增一個選項（全組共用；加完自動幫本專案勾上）"
        onClick={() => setOpen(true)}
      >
        <Icon name="Plus" size={12} style={{ verticalAlign: "-2px" }} /> 新增
      </Chip>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "4px 6px 4px 0", flexWrap: "wrap" }}>
      <input
        autoFocus
        value={label}
        aria-label="新增選項名稱"
        placeholder="輸入名稱後按 Enter"
        maxLength={60}
        disabled={add.isPending}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          if (e.key === "Escape") { setOpen(false); setLabel(""); }
        }}
        style={{ width: 160, fontSize: "var(--fs-13)", padding: "4px 10px" }}
      />
      <Button size="sm" variant="primary" disabled={!label.trim() || add.isPending} onClick={submit}>
        {add.isPending ? "新增中…" : "加入"}
      </Button>
      <Button size="sm" disabled={add.isPending} onClick={() => { setOpen(false); setLabel(""); }}>
        取消
      </Button>
      {add.error && <span className="error" style={{ marginTop: 0 }}>{add.error.message}</span>}
    </span>
  );
}

/**
 * 專案頁（WB-06 頁面組裝）：三幕長頁，不承擔各創作模式的表單／成本／mutation。
 * ① 專案上下文（世界觀・定裝・知識庫・素材庫・成員權限）＝AI 的共同大腦；
 * ② AI 創作中心：單一 CreationWorkbench（問 AI／直接生成／製作範本／執行計畫＋資源抽屜）；
 * ③ 分鏡・編修・交付＝腳本進來、分鏡整理好、成品落地（SceneList）。
 * 頁面只負責：抓專案／權限、組裝三幕、把 projectId／groupId／canEdit／capabilities 傳入工作台、
 * 跨幕捲動與 TocNav。跨幕帶入（再用提示詞、選來源）走 applyPrompt / generateApply 橋接。
 */
export function ProjectPage({ id }: { id: string }) {
  const utils = trpc.useUtils();
  // 不重試 FORBIDDEN/NOT_FOUND：成員點到他組或已刪專案的舊連結時，直接顯示訊息，不要卡在「載入中…」重試
  const project = trpc.projects.get.useQuery(
    { id },
    {
      retry: (count, err) => {
        const code = err.data?.code;
        return code !== "FORBIDDEN" && code !== "NOT_FOUND" && count < 2;
      },
      // 保底輪詢：協作廣播是「更快知道」，不是唯一的知道方式。
      // 全域 refetchOnWindowFocus 是 false（main.tsx），所以少了這一條，
      // 只要那則 invalidate 沒送到（WS 斷線、跨實例而沒開 Redis），世界觀可以整場停在舊值。
      refetchInterval: COLLAB_FALLBACK_POLL_MS,
    },
  );
  // 即時協作：presence／彩色游標／編輯指示／mutation 成功時廣播「有東西變了」。
  // 專案載入成功才啟用——FORBIDDEN/NOT_FOUND 頁不必開 WS 去被伺服器拒絕（hook 仍無條件呼叫，順序穩定）
  const collab = useCollab(id, !!project.data);
  // 協作視角：一般（只看 presence／游標）／鏡像跟隨（捲動跟著對方）
  const [collabMode, setCollabMode] = useState<CollabViewMode>("live");
  const [followUserId, setFollowUserId] = useState<string | null>(null);
  // 跟隨對象離房就退出鏡像。這條規則必須掛在**永遠存在**的這一層，不能只放 CollabModeBar：
  // 手機把在場面板收起來時整顆 bar 連同它那支同名 effect 一起卸載，此時對方關掉分頁，
  // followUserId 沒人歸零 → useCollabMirrorFollow 的 cleanup 不跑 → <html> 上的 collab-mirroring
  // 留到離開頁面為止（全站平滑捲動失效、.gen-row 的離屏最佳化被關掉），
  // 而取消鏡像的兩個入口（bar 的「退出鏡像」、對方的名字 chip）都已經不在畫面上了。
  // 只歸零 followUserId、不動 collabMode：與 CollabModeBar 那支同名規則一模一樣的口徑，
  // bar 還掛著時它會接手挑下一個人跟（既有行為），這裡純粹補上「bar 不在時也要有人做這件事」。
  useEffect(() => {
    if (!followUserId) return;
    if (collab.peers.some((p) => p.userId === followUserId)) return;
    setFollowUserId(null);
  }, [followUserId, collab.peers]);
  useCollabMirrorFollow(collabMode, followUserId, collab.cursorsLiveRef, collab.focusZones, collab.containerRef);
  const followZone = followUserId && collabMode === "mirror" ? zoneOfPeer(followUserId, collab.focusZones) : null;

  /* ── Presenter / 語意跟隨（Phase 2）─────────────────────────
     與上面的像素鏡像**並存而非取代**：鏡像在同尺寸桌機上更細膩，
     語意跟隨則是唯一能跨手機／桌機把人帶到同一個內容物件的方式。 */

  /**
   * 廣播「我正在看什麼」。
   *
   * 直接沿用既有的 focus zone（COLLAB_ZONES）當來源，不另外算一套「我在哪個區塊」——
   * zone 已經在跑而且準確，多一套只會多一個對不上的地方。
   * sendView 內部會比對內容，沒變就不送：viewState 是離散事件，當成輪詢送
   * 會讓整房每秒收到一堆一模一樣的封包。
   */
  const sendViewRef = useRef(collab.sendView);
  sendViewRef.current = collab.sendView;
  const selfZoneRef = useRef(collab.selfZone);
  selfZoneRef.current = collab.selfZone;
  /**
   * 助手的頁面感知搭同一班車。
   *
   * 專案頁是一條長捲軸（① 故事 → ② 分鏡 → ③ 製作 → ④ 成片），「我在哪一段」的真相
   * 就是捲動位置——而這件事上面這個 effect 已經在算了（detectVisibleSection，rAF 併批）。
   * 助手再掛第二個 IntersectionObserver 只會多一套會對不上的答案，所以直接共用這一份。
   */
  const reportAssistantSectionRef = useRef<(section: ViewSection | undefined) => void>(() => {});
  useEffect(() => {
    const report = () => {
      const visibleSection = detectVisibleSection();
      reportAssistantSectionRef.current(visibleSection);
      sendViewRef.current(buildViewState({ zone: selfZoneRef.current, visibleSection }));
    };
    report();
    // 捲動也要回報：專案頁是一條長捲軸，使用者純瀏覽時 zone 不會變，
    // 只看 zone 的話跟隨者會停在原地而畫面上看不出哪裡不對。
    // rAF 併批＋sendView 內部的內容比對，讓這條路徑不會變成每幀一個封包。
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        report();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [collab.selfZone, collab.connected]);

  /**
   * 助手頁面感知：把「哪個專案、捲到哪一段」報給助手。
   *
   * section 走上面那個 effect 算好的 detectVisibleSection（透過 ref 回傳），
   * 專案名讓助手的麵包屑寫得出「挑戰營回顧影片 · 分鏡」而不是一串 uuid。
   * 註冊本身是提示不是授權——後端一律以 requireGroup 重新驗證。
   */
  const [assistantSection, setAssistantSection] = useState<ViewSection | undefined>(undefined);
  reportAssistantSectionRef.current = setAssistantSection;
  const projectTitle = project.data?.title;
  useEffect(
    () => registerAssistantPage({
      // 捲到哪一段就是哪一段；還沒捲過任何標頭（頁首）時退回泛用的「專案」
      pageType: assistantSection ?? "project",
      projectId: id,
      projectTitle,
    }),
    [assistantSection, id, projectTitle],
  );

  /**
   * 被帶到主講者的位置。列表是非同步載入的、手機收合中的列 rect 為空，
   * 第一次找不到目標很正常——所以重試幾次再放棄，而不是安靜地什麼都沒發生。
   */
  const navigateToPresenterView = useCallback((view: ViewState) => {
    if (navigateToView(view)) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (navigateToView(view) || tries >= 20) window.clearInterval(timer);
    }, 200);
  }, []);

  const presenterFollow = usePresenterFollow({
    presenters: collab.presenters,
    peerViews: collab.peerViews,
    peers: collab.peers,
    presentEnded: collab.presentEnded,
    onNavigate: navigateToPresenterView,
  });
  /** 邀請被本地拒絕過就不再顯示（「不用了」＝這一場我不參加，不是暫時關掉） */
  const [dismissedPresenters, setDismissedPresenters] = useState<string[]>([]);
  const invitation =
    presenterFollow.invitation && !dismissedPresenters.includes(presenterFollow.invitation.connId)
      ? presenterFollow.invitation
      : null;
  /** 有幾個人跟著我（用房內 viewState 與我的位置比對太脆弱，直接數在場人數上限即可保守顯示） */
  const followerCount = collab.selfPresenting ? Math.max(0, collab.peers.length - 1) : 0;
  /** UX-M1：≤820px 手機減負（收合上下文、留言 sheet）；桌機 ≥821 行為不變 */
  const mobileCompact = useMatchMedia(PROJECT_MOBILE_MQ);
  const [presenceExpanded, setPresenceExpanded] = useState(false);
  const [messagesSheetOpen, setMessagesSheetOpen] = useState(false);
  /** ?focus=messages&mid=<id> 要捲到的那一則；MessagePanel 定位完成後清掉，避免重開時重閃 */
  const [focusMessageId, setFocusMessageId] = useState<string | undefined>(undefined);
  const [ctxOpen, setCtxOpen] = useState<Record<CtxSectionKey, boolean>>({
    worldview: true,
    characters: false,
    scenes: false,
    props: false,
    knowledge: false,
    databases: false,
    assets: false,
    recycle: false,
  });
  /** 進階設定摺疊層：引導鋪軌跳到第四步（給誰看／三幕）時要能撐開它。
      只管開合、不碰任何欄位值——鏡射欄位值的 state 會重新引入協作覆蓋 bug。 */
  const [wvAdvancedOpen, setWvAdvancedOpen] = useState(false);
  /** 兩大分組 + 管理：手機預設只開「世界與角色」，其餘收合降低同層資訊量 */
  const [ctxGroupOpen, setCtxGroupOpen] = useState<Record<CtxGroupKey, boolean>>({
    world: true,
    sources: false,
    manage: false,
  });
  /** C1：定裝三卡改 Tab；jump / 建定裝時同步切到對應 tab */
  const [costumeTab, setCostumeTab] = useState<CostumeTab>("characters");
  /** 定調中心子分頁：故事與畫風／角色與定裝／知識與素材／回收桶 */
  const [toneTab, setToneTab] = useState<ToneSubTab>("story");
  const setCtxSectionOpen = (key: CtxSectionKey, open: boolean) => {
    setCtxOpen((prev) => (prev[key] === open ? prev : { ...prev, [key]: open }));
    if (open && (key === "characters" || key === "scenes" || key === "props")) {
      setCostumeTab(key);
    }
  };
  const setCostumePackOpen = (open: boolean) => {
    setCtxOpen((prev) => {
      if (
        prev.characters === open &&
        prev.scenes === open &&
        prev.props === open
      ) {
        return prev;
      }
      return { ...prev, characters: open, scenes: open, props: open };
    });
  };
  const costumePackOpen = ctxOpen.characters || ctxOpen.scenes || ctxOpen.props;
  const setCtxGroupSectionOpen = (key: CtxGroupKey, open: boolean) =>
    setCtxGroupOpen((prev) => (prev[key] === open ? prev : { ...prev, [key]: open }));
  /** C2：從創作台／分鏡來的 returnTo——定裝區顯示「回到原處」主 CTA */
  const [contextReturnTo, setContextReturnTo] = useState<ProjectContextReturnTo | null>(null);
  /** 專案設定（二層；PE 計畫 §03）：定調拆散後的資料面收納處——非必經，需要微調才打開 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(settingsPanelRef, settingsOpen, () => setSettingsOpen(false));
  /** Story-inline：同一時間手機只開一個主要收合區；桌機也先維持單開，避免再長成四段長頁。 */
  const [openInline, setOpenInline] = useState<StoryInlineSectionId | null>(() =>
    typeof window === "undefined" ? null : sectionFromHash(window.location.hash),
  );
  const openInlineSection = useCallback((section: StoryInlineSectionId | null) => {
    setOpenInline(section);
    writeInlineHash(section);
  }, []);
  // 舊書籤／推播裡的 #stage-context（重構前的「① 定調」）→ 故事主畫面
  useEffect(() => {
    if (window.location.hash === "#stage-context") history.replaceState(null, "", "#stage-story");
  }, []);
  // Escape 關閉留言 sheet
  useEffect(() => {
    if (!messagesSheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMessagesSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [messagesSheetOpen]);

  // 通知深連結（#225／#250）：
  // - ?focus=messages：開留言（手機 sheet／桌機捲動）
  // - ?focus=scene-<id>：捲到該分鏡格＋高亮（手機收合列要等可見）
  // - ?focus=pending：捲到分鏡區（待處理彙總）
  // - ?focus=generation-<id>：開資源抽屜生成紀錄並高亮該筆
  // 列表非同步載入且手機列可能 display:none——輪詢到可見再捲，逾時放棄。
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (!focus) return;
    if (focus === "messages") {
      // mid=<messageId>：@提及推播要捲到「那一則」，不只是打開面板。
      // 白名單比照下方 scene 分支；MessagePanel 收到 prop 後自行定位（含往回翻頁）
      const mid = new URLSearchParams(window.location.search).get("mid");
      if (mid && /^[0-9a-f-]{8,64}$/i.test(mid)) setFocusMessageId(mid);
      if (mobileCompact) setMessagesSheetOpen(true);
      else scrollToSelector("#project-messages");
      return;
    }
    if (focus === "pending") {
      openInlineSection("delivery");
      scrollToSelector("#onboard-delivery");
      return;
    }
    if (/^generation-[0-9a-f-]+$/i.test(focus)) {
      openInlineSection("production");
      revealWorkbenchAnchor("#sec-generations", { projectId: id });
      let tries = 0;
      const timer = window.setInterval(() => {
        tries += 1;
        if (flashAnchor(focus) || tries >= 50) window.clearInterval(timer);
      }, 300);
      return () => window.clearInterval(timer);
    }
    if (/^scene-[0-9a-f-]+$/i.test(focus)) {
      openInlineSection("storyboard");
      let tries = 0;
      const timer = window.setInterval(() => {
        tries += 1;
        const el = document.getElementById(focus);
        // 手機收合中的列 getClientRects 為空——等 SceneList focus effect 展開後才捲
        if (el && el.getClientRects().length > 0) {
          window.clearInterval(timer);
          flashAnchor(focus);
        } else if (tries >= 50) {
          window.clearInterval(timer);
        }
      }, 300);
      return () => window.clearInterval(timer);
    }
    // focus=agent-run-* 由 CreationWorkbench／AiHub 自行處理（既有契約）
    // 掛載時讀一次網址即可；mobileCompact 變化不該重觸發深連結
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 手機「討論這個」：MessagePanel 只在 sheet 開著時 mount，事件會發進真空——
  // 這裡代收事件開 sheet，MessagePanel 掛載時再從交棒暫存補收引用卡（見 discuss.ts）
  useEffect(() => {
    if (!mobileCompact) return;
    const onDiscuss = () => setMessagesSheetOpen(true);
    window.addEventListener(DISCUSS_EVENT, onDiscuss);
    return () => window.removeEventListener(DISCUSS_EVENT, onDiscuss);
  }, [mobileCompact]);

  const me = trpc.auth.me.useQuery();
  // 世界觀三組 chips（主軸／調性／視覺風格）由本專案所屬組的自訂選項供給（組長就地新增，改名／排序才去整理頁）
  const options = trpc.options.byGroup.useQuery(
    { groupId: project.data?.groupId ?? "" },
    { enabled: !!project.data?.groupId },
  );
  /** 世界觀儲存回饋：成功後短暫顯示「已儲存 ✓」再淡出 */
  const [wvSaved, setWvSaved] = useState<"idle" | "shown" | "fading">("idle");
  /** 視覺風格：媒材家族分頁（未選時跟 styles 推斷） */
  const [styleFamilyTab, setStyleFamilyTab] = useState<StyleMediaFamily | null>(null);
  const wvTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => wvTimers.current.forEach(clearTimeout), []);
  const updateWv = trpc.projects.updateWorldview.useMutation({
    // 樂觀更新：patch 先合併進本地快取，快速連點兩個 chips 時第二下才讀得到第一下的結果
    //（否則第二下用 stale 快取算出「整條陣列」，後端合併後把第一下剛存的值蓋掉）
    onMutate: async ({ worldview }) => {
      await utils.projects.get.cancel({ id });
      utils.projects.get.setData({ id }, (old) =>
        old ? { ...old, worldview: { ...parseWorldviewSafe(old.worldview), ...worldview } } : old,
      );
    },
    // 失敗或成功都以伺服器現值對齊（失敗時等同回滾樂觀值）
    onError: () => utils.projects.get.invalidate({ id }),
    onSuccess: () => {
      utils.projects.get.invalidate({ id });
      wvTimers.current.forEach(clearTimeout);
      setWvSaved("shown");
      wvTimers.current = [setTimeout(() => setWvSaved("fading"), 2000), setTimeout(() => setWvSaved("idle"), 2600)];
    },
  });

  /** 生成時要帶入的角色定裝卡（跨鏡一致）——持久化，重整不歸零 */
  const [charIds, setCharIds] = usePersistedIds(`aios.pick.chars.${id}`);
  const toggleChar = (cid: string) =>
    setCharIds((prev) => {
      if (prev.includes(cid)) return prev.filter((x) => x !== cid);
      if (prev.length >= MAX_GENERATE_CHARACTERS) return prev; // CharacterCards 已禁用多勾；此處雙保險
      return [...prev, cid];
    });
  /** 新建角色：未滿生成上限時自動勾選，立刻能帶進下一筆生成 */
  const onCharCreated = (cid: string) =>
    setCharIds((prev) => {
      if (prev.includes(cid) || prev.length >= MAX_GENERATE_CHARACTERS) return prev;
      return [...prev, cid];
    });
  /** 生成時要帶入的場景設定卡（色板/光線一致）——持久化，重整不歸零 */
  const [sceneIds, setSceneIds] = usePersistedIds(`aios.pick.scenes.${id}`);
  const toggleScene = (sid: string) =>
    setSceneIds((prev) => {
      if (prev.includes(sid)) return prev.filter((x) => x !== sid);
      if (prev.length >= MAX_GENERATE_SCENE_PRESETS) return prev;
      return [...prev, sid];
    });
  const onSceneCreated = (sid: string) =>
    setSceneIds((prev) => {
      if (prev.includes(sid) || prev.length >= MAX_GENERATE_SCENE_PRESETS) return prev;
      return [...prev, sid];
    });
  /** 生成時要帶入的素材設定卡（道具外觀一致）——持久化，重整不歸零 */
  const [propIds, setPropIds] = usePersistedIds(`aios.pick.props.${id}`);
  const toggleProp = (pid: string) =>
    setPropIds((prev) => {
      if (prev.includes(pid)) return prev.filter((x) => x !== pid);
      if (prev.length >= MAX_GENERATE_PROPS) return prev;
      return [...prev, pid];
    });
  const onPropCreated = (pid: string) =>
    setPropIds((prev) => {
      if (prev.includes(pid) || prev.length >= MAX_GENERATE_PROPS) return prev;
      return [...prev, pid];
    });
  const assets = trpc.projects.assets.useQuery({ projectId: id }, { refetchInterval: COLLAB_FALLBACK_POLL_MS });
  // 留言未讀數（餵 TocNav ③分鏡・交付 徽章）：15 秒輪詢已夠即時，同房夥伴留言另有 WS invalidate 立即刷新
  const unread = trpc.messages.unread.useQuery({ projectId: id }, { refetchInterval: 15000 });
  // 「從這裡開始」步驟列與四段進度 hint 用：讀既有查詢判定（與子元件共用快取，不額外增負擔）
  const generations = trpc.generation.listByProject.useQuery({ projectId: id });
  const scenes = trpc.scenes.listByProject.useQuery({ projectId: id });
  // 故事狀態（與 StoryStage 共用同一快取 key，零額外請求）：判定 ① 是否完成
  const storyMeta = trpc.story.get.useQuery({ projectId: id });
  // 上下文摘要條的計數查詢：key 與各子元件內部完全相同 → 共用快取，零額外請求
  const knowledge = trpc.knowledge.list.useQuery({ projectId: id }, { refetchInterval: COLLAB_FALLBACK_POLL_MS });
  const characters = trpc.characters.list.useQuery({ projectId: id });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId: id });
  const propCards = trpc.props.list.useQuery({ projectId: id });
  /**
   * 用三幕大綱拆分鏡。
   *
   * 補的是一個真的斷點：三幕本來只以 formatWorldviewForAi 裡的一行摘要進 prompt，
   * 拆分鏡的腳本來源只認「貼上的全文」或知識庫——使用者在這裡認真填完三幕，
   * 到拆分鏡卻仍被要求再貼一份腳本，於是同一個故事被寫兩次。
   */
  const splitFromOutline = trpc.director.splitScript.useMutation({
    onSuccess: () => {
      utils.scenes.listByProject.invalidate({ projectId: id });
    },
  });
  /** 敘事人物 → 一鍵建角色定裝（外觀錨點）；成功後勾選並捲到定裝區 */
  const addCharFromPerson = trpc.characters.add.useMutation({
    onSuccess: (row) => {
      utils.characters.list.invalidate({ projectId: id });
      setCharIds((prev) => {
        if (prev.includes(row.id) || prev.length >= 6) return prev;
        return [...prev, row.id];
      });
      setCtxSectionOpen("characters", true);
      requestAnimationFrame(() => {
        scrollToSelector("#sec-characters");
      });
    },
  });
  // 勾選持久化的清理：清單載入後移除已被刪除的角色/場景 id，並夾在後端 max 內
  // （沒變就不 set，避免每次 refetch 都重渲染）
  useEffect(() => {
    const list = characters.data;
    if (!list) return;
    setCharIds((prev) => {
      const next = prev.filter((cid) => list.some((c) => c.id === cid)).slice(0, MAX_GENERATE_CHARACTERS);
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
    // setCharIds 是穩定的 setState 包裝，不入依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters.data]);
  useEffect(() => {
    const list = scenePresets.data;
    if (!list) return;
    setSceneIds((prev) => {
      const next = prev.filter((sid) => list.some((s) => s.id === sid)).slice(0, MAX_GENERATE_SCENE_PRESETS);
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenePresets.data]);
  useEffect(() => {
    const list = propCards.data;
    if (!list) return;
    setPropIds((prev) => {
      const next = prev.filter((pid) => list.some((p) => p.id === pid)).slice(0, MAX_GENERATE_PROPS);
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propCards.data]);
  /** 素材庫選中來源的高亮 id（實際來源 state 在 DirectGenerateMode） */
  const [sourceHighlightId, setSourceHighlightId] = useState<string | null>(null);
  /** 把提示詞庫／生成紀錄／分鏡／素材庫的設定送進 DirectGenerateMode（nonce 觸發） */
  const [generateApply, setGenerateApply] = useState<DirectGenerateApplyRequest | null>(null);
  /** 引導步驟列收合偏好已退役：四階段 VisualJourney 不再是主畫面。 */
  /** 世界觀範例卡「我自己填」的關閉旗標（per 專案，沿用引導列同一套 localStorage 手法） */
  const wvExampleStorageKey = `aios.wvExample.dismissed.${id}`;
  const [wvExampleDismissed, setWvExampleDismissed] = useState(() => {
    try {
      return localStorage.getItem(wvExampleStorageKey) === "1";
    } catch {
      return false;
    }
  });
  const dismissWvExample = () => {
    setWvExampleDismissed(true);
    try { localStorage.setItem(wvExampleStorageKey, "1"); } catch { /* 偏好儲存失敗不影響操作 */ }
  };
  const archiveProject = trpc.projects.setArchived.useMutation({
    onSuccess: () => { utils.projects.get.invalidate({ id }); utils.projects.list.invalidate(); },
  });

  /** 摘要 chip → 目標 section：手機時先展開所屬分組與收合卡再捲動
   *  必須定義在 early return 之前：下面的 reveal useEffect 會用到，hooks 不可在條件 return 之後。 */
  const targetToCtxKey = (target: string): CtxSectionKey | null => {
    if (target === "#onboard-worldview") return "worldview";
    if (target === "#sec-characters") return "characters";
    if (target === "#sec-scenes") return "scenes";
    if (target === "#sec-props") return "props";
    if (target === "#sec-knowledge") return "knowledge";
    if (target === "#sec-databases") return "databases";
    if (target === "#sec-assets") return "assets";
    if (target === "#sec-recyclebin") return "recycle";
    return null;
  };
  const sectionToGroup = (key: CtxSectionKey): CtxGroupKey => {
    if (key === "knowledge" || key === "databases" || key === "assets") return "sources";
    if (key === "recycle") return "manage";
    return "world";
  };
  /** 展開對應收合區或專案設定分組。角色／場景／道具現在住在故事下方，不再先打開設定 sheet。 */
  const expandContextForSelector = (target: string) => {
    const inline = sectionFromSelector(target);
    if (inline === "characters" || inline === "scenes" || inline === "props") {
      openInlineSection(inline);
      return;
    }
    if (inline === "storyboard" || inline === "production" || inline === "delivery") {
      openInlineSection(inline);
      return;
    }
    setSettingsOpen(true);
    const costume = costumeTabFromTarget(target);
    if (costume) {
      setCostumeTab(costume);
      setToneTab("costume");
    }
    if (target === "#onboard-worldview" || target === "#stage-context" || target === "#ctx-group-world") {
      setToneTab("story");
      setCtxGroupSectionOpen("world", true);
      setCtxSectionOpen("worldview", true);
      return;
    }
    if (target === "#sec-costume" || target === "#sec-characters" || target === "#sec-scenes" || target === "#sec-props") {
      setToneTab("costume");
      setCtxGroupSectionOpen("world", true);
      setCostumePackOpen(true);
      return;
    }
    if (target === "#sec-knowledge" || target === "#sec-databases" || target === "#sec-assets" || target === "#ctx-group-sources") {
      setToneTab("sources");
      setCtxGroupSectionOpen("sources", true);
      const k = targetToCtxKey(target);
      if (k) setCtxSectionOpen(k, true);
      return;
    }
    if (target === "#sec-recyclebin" || target === "#ctx-group-manage") {
      setToneTab("recycle");
      setCtxGroupSectionOpen("manage", true);
      setCtxSectionOpen("recycle", true);
      return;
    }
    const key = targetToCtxKey(target);
    if (key) {
      setCtxGroupSectionOpen(sectionToGroup(key), true);
      setCtxSectionOpen(key, true);
      if (key === "characters" || key === "scenes" || key === "props") {
        setToneTab("costume");
        setCostumePackOpen(true);
      } else if (key === "knowledge" || key === "databases" || key === "assets") {
        setToneTab("sources");
      } else if (key === "recycle") {
        setToneTab("recycle");
      } else {
        setToneTab("story");
      }
    } else if (costume) {
      setToneTab("costume");
      setCostumePackOpen(true);
    }
  };

  // C2：aios:project-context-reveal —— 展開分組／Tab、記住 returnTo（scroll/flash 由派發端延遲做）
  // ⚠️ 必須在 project.isLoading / error early return 之前：載入成功後多呼叫一個 hook 會白屏
  // （Rendered more hooks than during the previous render → ErrorBoundary「畫面出了點狀況」）
  useEffect(() => {
    const onReveal = (ev: Event) => {
      const detail = (ev as CustomEvent<ProjectContextRevealDetail>).detail;
      if (!detail?.target) return;
      if (detail.projectId && detail.projectId !== id) return;
      const selector = selectorForContextTarget(detail.target as ProjectContextTarget);
      expandContextForSelector(selector);
      if (detail.returnTo) setContextReturnTo(detail.returnTo);
    };
    window.addEventListener(PROJECT_CONTEXT_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(PROJECT_CONTEXT_REVEAL_EVENT, onReveal);
    // expand helpers close over latest open state setters (stable enough for reveal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mobileCompact]);

  useEffect(() => {
    const onReveal = (ev: Event) => {
      const detail = (ev as CustomEvent<StoryInlineRevealDetail>).detail;
      if (!detail?.section) return;
      if (detail.projectId && detail.projectId !== id) return;
      openInlineSection(detail.section);
      if (detail.scroll === false) return;
      const selector = selectorForInlineSection(detail.section);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToSelector(selector));
      });
    };
    const onHash = () => {
      const section = sectionFromHash(window.location.hash);
      if (section) setOpenInline(section);
    };
    window.addEventListener(STORY_INLINE_REVEAL_EVENT, onReveal);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener(STORY_INLINE_REVEAL_EVENT, onReveal);
      window.removeEventListener("hashchange", onHash);
    };
  }, [id, openInlineSection]);

  if (project.isLoading) return <Meta as="p">載入中…</Meta>;
  if (project.error || !project.data) {
    const code = project.error?.data?.code;
    const msg =
      code === "FORBIDDEN" ? "這個專案不屬於你的組，看不到內容。"
      : code === "NOT_FOUND" ? "找不到這個專案（可能已被刪除）。"
      : `載入失敗：${project.error?.message ?? "未知錯誤"}`;
    return (
      <p className="error">
        {msg} <Link href="/dashboard">回今日工作台</Link>
      </p>
    );
  }

  const p = project.data;
  const myRole = me.data?.groups.find((g) => g.groupId === p.groupId)?.role;
  const isLeader = myRole === "leader" || myRole === "admin";
  // 唯讀渲染路徑不得用會 throw 的 parse：legacy／畸形 worldview（超長字串、非字串陣列項）
  // 會讓整頁掉進 ErrorBoundary「畫面出了點狀況」，使用者連專案都打不開。
  const wv: Worldview = parseWorldviewSafe(p.worldview);
  // 各類型的 active 選項標籤（值＝label 字串，與世界觀寫入邏輯一致）
  const themeOpts = (options.data ?? []).filter((o) => o.type === "theme").map((o) => o.label);
  const toneOpts = (options.data ?? []).filter((o) => o.type === "tone").map((o) => o.label);
  const styleOpts = (options.data ?? []).filter((o) => o.type === "style").map((o) => o.label);
  // 已勾選但選項已被組長改名/刪除的「孤兒值」：仍在 worldview 裡且會注入生成，
  // 必須補一顆 chip 讓使用者點得掉（否則看不到、按不掉、卻持續注入）。options 尚未載入時不算孤兒。
  //
  // 內建畫風例外：畫風藝廊是直接讀 STYLE_OPTIONS 出卡，不看這組的 group_options
  // （選項只在建組時 seed 一次，之後新增的內建畫風不會回填到既有的組）。
  // 不排除掉的話，選了新畫風會同時出現在藝廊卡片與「此選項已移出清單」的孤兒提示裡，自相矛盾。
  const orphansOf = (field: "themes" | "tones" | "styles", opts: string[]) =>
    options.data
      ? wv[field].filter(
          (v) => !opts.includes(v) && !(field === "styles" && STYLE_MEDIA_FAMILY[v]),
        )
      : [];

  const isOwner = me.data?.user.id === p.ownerId;
  const canArchive = isOwner || isLeader;
  // 2.3 前端唯讀可見性：後端守衛已全面擋 viewer，這裡讓寫入控制「事前」禁用＋常駐唯讀橫幅，
  // 不再讓檢視者「按了才失敗」（走完看價確認流程最後一步才被擋是最傷的版本）
  const canEdit = projectCanEdit(p.myProjectRole);

  /** 「用這個提示詞」統一入口（AI 導演／分鏡草稿／提示詞庫「再用」／生成紀錄「再用此設定」）：
   * 避免默默蓋掉手打的提示詞；套用後切到直接生成模式、聚焦提示詞框。
   * settings（可選）＝一併還原模型與角色/場景卡勾選：提示詞庫與生成紀錄存的是「完整用法」，不只文字。
   * 陣列語義：[]＝明確清空現勾（如實還原「當時沒帶卡」）；null/undefined＝不知道，維持現勾不動 */
  /**
   * 「用這個提示詞」統一入口。
   * @returns false when user cancels overwrite confirm (nothing applied);
   *          true after settings/prompt are applied (for resource drawer close/toast).
   */
  const applyPrompt = (
    text: string,
    settings?: {
      modelId?: string | null;
      characterIds?: string[] | null;
      scenePresetIds?: string[] | null;
      propIds?: string[] | null;
      sourceAssetId?: string | null;
    },
  ): boolean => {
    // 現值：優先 DOM（工作台內表單），再退回 draft storage（可能有 debounce 延遲）
    const live = (document.getElementById("gen-prompt") as HTMLTextAreaElement | null)?.value;
    const current = (live ?? loadDraft(id).prompt ?? "").trim();
    // 這裡刻意保留原生 confirm：只在使用者已手打提示詞時才問「要覆蓋嗎」
    if (current && !window.confirm("要覆蓋你已輸入的提示詞嗎？")) return false;
    if (settings) {
      // 只還原「仍存在」的卡片 id（卡片可能已被刪除）；清單還沒載入就先原樣設定，載入後的清理 effect 會補剪
      if (settings.characterIds) {
        const list = characters.data;
        const next = list ? settings.characterIds.filter((cid) => list.some((c) => c.id === cid)) : settings.characterIds;
        setCharIds(() => next);
      }
      if (settings.scenePresetIds) {
        const list = scenePresets.data;
        const next = list ? settings.scenePresetIds.filter((sid) => list.some((s) => s.id === sid)) : settings.scenePresetIds;
        setSceneIds(() => next);
      }
      if (settings.propIds) {
        const list = propCards.data;
        const next = list ? settings.propIds.filter((pid) => list.some((p) => p.id === pid)) : settings.propIds;
        setPropIds(() => next);
      }
      if (settings.sourceAssetId) {
        const src = assets.data?.find((a) => a.id === settings.sourceAssetId);
        if (src) setSourceHighlightId(src.id);
      }
    }
    setGenerateApply((prev) => ({
      nonce: (prev?.nonce ?? 0) + 1,
      prompt: text,
      modelId: settings?.modelId,
      sourceAssetId: settings?.sourceAssetId,
    }));
    // 切到直接生成模式並露出 #sec-studio / #gen-prompt
    openInlineSection("production");
    revealWorkbenchAnchor("#sec-studio", { projectId: id });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // focusAndReveal：讓開鍵盤與 --chrome-bottom、尊重 reduced-motion
        //（block:center 以 layout viewport 置中，iOS 鍵盤彈出時會把欄位藏在鍵盤下）
        focusAndReveal(document.getElementById("gen-prompt"));
      });
    });
    return true;
  };

  const sceneCount = scenes.data?.length ?? 0;
  // typeof 守衛：hookOrder 測試以泛用 stub 餵 query 資料，content 可能不是字串——防禦性判定
  const storyContent = storyMeta.data?.story?.content;
  const storyReady = typeof storyContent === "string" && storyContent.trim().length > 0;
  const hasParsed = Boolean(storyMeta.data?.story?.lastParsedAt);
  const pendingCount = Array.isArray(storyMeta.data?.pending) ? storyMeta.data.pending.length : 0;
  const doneGenCountForReady = generations.data?.filter((g) => g.status === "done").length ?? 0;
  const readiness = storyReadiness({
    storyReady,
    hasParsed,
    pendingCount,
    sceneCount,
    doneGenerationCount: doneGenCountForReady,
  });
  const hasDeliverable = !!scenes.data?.some((s) => s.assetId);

  // 三幕標頭與摘要條的進度數字：全讀頁面既有查詢，查詢還沒回來就不顯示
  const stylePicker = (labelledBy: string) => {
    return (
      <StyleVisualGallery
        styles={wv.styles}
        styleOpts={styleOpts}
        labelledBy={labelledBy}
        canEdit={canEdit}
        isLeader={isLeader}
        styleFamilyTab={styleFamilyTab}
        onPickFamily={pickStyleFamily}
        onToggleStyle={(style) => toggle("styles", style)}
        onKeepPrimary={keepPrimaryStyle}
        renderAddOption={
          isLeader && canEdit ? (
            <AddOptionChip groupId={p.groupId} type="style" onAdded={(label) => toggle("styles", label)} />
          ) : null
        }
        orphans={orphansOf("styles", styleOpts)}
        isLoading={options.isLoading}
      />
    );
  };
  const doneGenCount = generations.data?.filter((g) => g.status === "done").length;
  const knowledgeCount = knowledge.data?.length;
  const charCount = characters.data?.length;
  const presetCount = scenePresets.data?.length;
  const propCount = propCards.data?.length;
  /** 勾了角色／場景 → 它們名下的素材卡會被自動帶入生成（伺服器同一支純函式，畫面數字不分岔） */
  const carriedPropIds = carriedPropIdsFor(propCards.data ?? [], {
    characterIds: charIds,
    scenePresetIds: sceneIds,
  });
  const assetCount = assets.data?.length;
  const wvReady = isWorldviewReady(wv);
  /** 快速層四項全空＝這個專案還沒起手，值得先給一份可照抄的範例 */
  const wvBlank = !wv.logline.trim() && !wv.message.trim() && !wv.tones.length && !wv.styles.length;

  const toggle = (field: "tones" | "themes" | "styles", value: string) => {
    if (!canEdit) return; // 檢視者：chips 不可切換（樂觀更新會先亮再彈回，比不動更誤導）
    // 風格＝家族／主風格／質感規則；主軸／調性＝可複選
    const next =
      field === "styles" ? selectWorldviewStyle(wv.styles, value) : toggleWorldviewChip(wv[field], value);
    // 只送有改的欄位；伺服器與現值合併（避免整包覆蓋造成的資料遺失）
    updateWv.mutate({ id, worldview: { [field]: next } });
  };

  /** 已選 chip 提到第一位＝主要（主軸／調性）；風格走 select 規則 */
  const promote = (field: "tones" | "themes" | "styles", value: string) => {
    if (!canEdit) return;
    if (field === "styles") {
      updateWv.mutate({ id, worldview: { styles: selectWorldviewStyle(wv.styles, value) } });
      return;
    }
    const cur = wv[field];
    if (cur[0] === value) return;
    updateWv.mutate({ id, worldview: { [field]: promoteWorldviewChip(cur, value) } });
  };

  /** 舊多選／跨家族一鍵收斂為可注入 look(+質感) */
  const keepPrimaryStyle = () => {
    if (!canEdit) return;
    const next = keepPrimaryWorldviewStyle(wv.styles);
    if (next.length === wv.styles.length && next.every((v, i) => v === wv.styles[i])) return;
    updateWv.mutate({ id, worldview: { styles: next } });
  };

  const pickStyleFamily = (family: StyleMediaFamily) => {
    if (!canEdit) {
      setStyleFamilyTab(family);
      return;
    }
    setStyleFamilyTab(family);
    const slots = parseWorldviewStyleSlots(wv.styles);
    if (slots.family === family && slots.look) return; // 已在此家族，只切分頁
    updateWv.mutate({ id, worldview: { styles: selectWorldviewStyleFamily(wv.styles, family) } });
  };

  /** 編輯指示：把某區塊接上協作狀態（誰在這裡→內框＋標籤）；鏡像時被跟隨者焦點區加粗 */
  const zoneProps = (zone: string) => ({
    zone,
    watchers: collab.focusZones[zone] ?? [],
    sendFocus: collab.sendFocus,
    mirrorActive: followZone === zone,
  });

  const chipSoftMaxLabel: Record<"themes" | "tones", string> = {
    themes: `建議 ≤${CHIP_SOFT_MAX.themes}（第一個為主）`,
    tones: `建議 ≤${CHIP_SOFT_MAX.tones}；出圖取前 2（第一個為主）`,
  };

  /** 世界觀 chips（主軸／調性）：複選；順序＝優先序；Shift+點或「改主要」升第一。 */
  const chipGroup = (field: "themes" | "tones", opts: string[], optType: "theme" | "tone", labelledBy: string) => {
    const selected = wv[field];
    const softMax = CHIP_SOFT_MAX[field];
    const overSoft = selected.length > softMax;
    const secondaries = selected.slice(1);
    const onChipActivate = (t: string, e?: { shiftKey?: boolean }) => {
      if (!canEdit) return;
      const on = selected.includes(t);
      const isPrimary = on && selected[0] === t;
      if (on && !isPrimary && e?.shiftKey) {
        promote(field, t);
        return;
      }
      toggle(field, t);
    };
    return (
      <div role="group" aria-labelledby={labelledBy}>
        {options.isLoading && !opts.length && <Meta>載入中…</Meta>}
        {opts.map((t) => {
          const on = selected.includes(t);
          const isPrimary = on && selected[0] === t;
          return (
            <Chip
              key={t}
              selected={on}
              onClick={(ev) => onChipActivate(t, ev)}
              title={
                on
                  ? isPrimary
                    ? "主要（點一下取消選取）"
                    : "已選（點一下取消；Shift+點＝設為主要）"
                  : `點選加入（${chipSoftMaxLabel[field]}）`
              }
            >
              {isPrimary && (
                <Meta as="span" style={{ marginRight: 4, fontSize: 11, fontWeight: 600, color: "var(--primary-ink)" }}>
                  主要
                </Meta>
              )}
              {t}
            </Chip>
          );
        })}
        {orphansOf(field, opts).map((t) => {
          const isPrimary = selected[0] === t;
          return (
            <Chip
              key={t}
              selected
              style={{ borderStyle: "dashed", opacity: 0.75 }}
              title="這個選項已被移出清單，點一下可從本專案移除"
              onClick={() => toggle(field, t)}
            >
              {isPrimary && (
                <Meta as="span" style={{ marginRight: 4, fontSize: 11, fontWeight: 600 }}>
                  主要
                </Meta>
              )}
              {t} <Icon name="Info" size={12} style={{ verticalAlign: "-2px" }} />
            </Chip>
          );
        })}
        {isLeader && canEdit && (
          <AddOptionChip groupId={p.groupId} type={optType} onAdded={(label) => toggle(field, label)} />
        )}
        {canEdit && secondaries.length > 0 && (
          <Meta style={{ display: "block", marginTop: 6, fontSize: 12 }}>
            改主要：
            {secondaries.map((t) => (
              <button
                key={`promo-${field}-${t}`}
                type="button"
                className="linkish"
                style={{
                  marginLeft: 6,
                  fontSize: 12,
                  border: 0,
                  background: "none",
                  cursor: "pointer",
                  color: "var(--primary-ink)",
                  textDecoration: "underline",
                }}
                onClick={() => promote(field, t)}
              >
                {t}
              </button>
            ))}
          </Meta>
        )}
        {overSoft && (
          <Hint style={{ display: "block", marginTop: 6, fontSize: 12, color: "var(--warn, #b45309)" }}>
            已選 {selected.length} 個——{chipSoftMaxLabel[field]}
          </Hint>
        )}
      </div>
    );
  };



  const wvChipWarnings = chipSoftWarnings(wv);

  const jumpToContext = (target: string) => {
    expandContextForSelector(target);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToSelector(target));
    });
  };

  /** 上下文摘要條的一顆 chip：顯示計數、點了捲到對應卡（手機一併展開） */
  // `on` 是「那一區已有內容」的視覺標示，不是按下狀態——點下去只會捲動，不會切換任何東西。
  // 所以走 className 給 .on，不傳 selected：後者會輸出 aria-pressed，把一次性動作
  // 講成「未按下的切換鈕」，對讀屏使用者謊報元件性質。
  const summaryChip = (label: string, target: string, on = false) => (
    <Chip className={on ? "on" : undefined} onClick={() => jumpToContext(target)}>
      {label}
    </Chip>
  );

  const unreadCount = unread.data?.count ?? 0;
  const unreadBadgeLabel = unread.data?.mentioned
    ? `@${Math.min(unreadCount, 99)}`
    : unreadCount > 0
      ? String(Math.min(unreadCount, 99))
      : null;
  const onlineCount = collab.peers.length;
  const showPresenceDetails = !mobileCompact || presenceExpanded || !collab.connected;

  return (
    // position:relative＋ref：游標座標（x/y 比例＋[data-fb] 錨點）與覆蓋層都以這個容器為基準
    <div
      className={`project-page${mobileCompact ? " project-page--mobile-compact" : ""}`}
      ref={collab.containerRef}
      onPointerMove={collab.onPointerMove}
      style={{ position: "relative" }}
    >
      <CursorOverlay cursors={collab.cursors} />
      {/* 麵包屑：長頁面全程可及的返回入口＋標示專案所屬組（切組後留在他組專案時，一眼看出情境） */}
      <p className="project-breadcrumb">
        <Link href="/dashboard" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Icon name="Undo2" size={13} />今日工作台
        </Link>
        {(() => {
          const g = me.data?.groups.find((x) => x.groupId === p.groupId);
          return g ? <span>・{g.teamName}・{g.groupName}</span> : null;
        })()}
      </p>
      <header className="project-hero">
      <div className="project-hero__heading">
        <h1 style={{ flex: "1 1 auto" }}>{p.title}{p.status === "archived" && <Chip style={{ marginLeft: 10 }}>已封存</Chip>}</h1>
        {/* 即時協作：連線狀態＋誰在場＋一般／鏡像跟隨模式切換
            手機預設收成「N 人在線」chip，點開才看名單／鏡像（不拿掉 WebSocket） */}
        <span
          className="project-presence"
          style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
          aria-live="polite"
        >
          {mobileCompact && collab.connected && !presenceExpanded && (
            <button
              type="button"
              className="chip project-presence-chip"
              aria-expanded={false}
              aria-controls="project-presence-details"
              onClick={() => setPresenceExpanded(true)}
              title="展開協作在場名單"
            >
              {onlineCount > 0 ? `${onlineCount} 人在線` : "即時同步已連線"}
            </button>
          )}
          {/* 「誰剛改了什麼」——別人改動時畫面不再是靜默換掉。
              刻意用既有的 Meta 而不是引入 toast 基礎設施：為了一行字長出一整套彈出訊息系統，
              之後每個人都會拿它來洗版。60 秒後自然過期（lastChange.at 是時間戳）。 */}
          {collab.lastChange && Date.now() - collab.lastChange.at < 60_000 && (
            <Meta aria-live="polite">
              {collab.lastChange.name} {collab.lastChange.label}
            </Meta>
          )}
          {showPresenceDetails && (
            <span id="project-presence-details" className="project-presence__details" style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {!collab.connected && (
                <Meta
                  title="WebSocket 未連上時，留言與生成仍會每數秒自動刷新，只是看不到即時游標與「誰在場」"
                  style={{ fontSize: 12, padding: "2px 10px", borderRadius: 999, border: "1px dashed var(--border-strong)" }}
                >
                  即時同步連線中…
                </Meta>
              )}
              {collab.connected && collab.peers.length === 0 && (
                <Meta style={{ fontSize: 12 }}>即時同步已連線</Meta>
              )}
              {/* Phase 3：名字 chip 點開小卡——「韋澔 · 在線 · 正在：分鏡 · Shot 08
                  [跟隨畫面] [傳訊息]」。「正在哪」來自語意視圖（peerViews），
                  與 Presenter 跟隨同一個真相來源，兩邊顯示的位置永遠一致。 */}
              {collab.peers.map((peer) => {
                const isMe = peer.userId === collab.self?.userId;
                const following = collabMode === "mirror" && followUserId === peer.userId;
                const view = latestViewForUser(collab.peerViews, peer.userId);
                return (
                  <PeerBadge
                    key={peer.userId}
                    peer={peer}
                    isMe={isMe}
                    view={view}
                    sceneLabel={sceneLabelOf(scenes.data, view)}
                    following={following}
                    onToggleFollow={() => {
                      if (following) {
                        setCollabMode("live");
                        setFollowUserId(null);
                      } else {
                        setCollabMode("mirror");
                        setFollowUserId(peer.userId);
                      }
                    }}
                  />
                );
              })}
              {/* 「帶大家看」：按下去只會讓房裡其他人看到一張邀請卡，
                  **不會切走任何人的畫面**。跟不跟由他們自己決定。 */}
              {collab.connected && !collab.selfPresenting && (
                <PresentButton peerCount={collab.peers.length - 1} onStart={() => collab.setPresenting(true)} />
              )}
              <CollabModeBar
                connected={collab.connected}
                mode={collabMode}
                onModeChange={(m) => {
                  setCollabMode(m);
                  if (m === "live") setFollowUserId(null);
                }}
                peers={collab.peers}
                selfId={collab.self?.userId}
                followUserId={followUserId}
                onFollowChange={setFollowUserId}
              />
              {mobileCompact && collab.connected && (
                <Button size="sm"
                  type="button"
                  aria-expanded={true}
                  onClick={() => setPresenceExpanded(false)}>
                  收合
                </Button>
              )}
            </span>
          )}
        </span>
        {collabMode === "mirror" && followUserId && (
          <Hint style={{ flexBasis: "100%", margin: "4px 0 0" }}>
            極限精準鏡像：錨點＋螢幕比例鎖定，巢狀捲動雙次校正（非螢幕串流）。
            可點「退出鏡像」或再點對方名字取消。
          </Hint>
        )}
        {/* Presenter 的三張面孔。手機與桌機共用同一組（flexBasis:100% 讓它們自成一列，
            不跟頂部 chip 擠在一起）——協作狀態在手機上尤其不能靠 hover 才看得到。 */}
        {collab.selfPresenting && (
          <div style={{ flexBasis: "100%", margin: "6px 0 0" }}>
            <PresenterBadge followerCount={followerCount} onStop={() => collab.setPresenting(false)} />
          </div>
        )}
        {invitation && (
          <div style={{ flexBasis: "100%", margin: "6px 0 0" }}>
            <PresenterInvite
              presenter={invitation}
              onJoin={() => presenterFollow.join(invitation)}
              onDismiss={() => setDismissedPresenters((prev) => [...prev, invitation.connId])}
            />
          </div>
        )}
        {presenterFollow.state.status !== "off" && (
          <div style={{ flexBasis: "100%", margin: "6px 0 0" }}>
            <FollowStatusBar
              state={presenterFollow.state}
              onResume={presenterFollow.resume}
              onLeave={presenterFollow.leave}
            />
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSettingsOpen(true)}
          title="整體風格、角色、場景、道具、知識、素材、回收桶——需要微調時才進來"
        >
          <Icon name="SlidersHorizontal" size={14} /> 專案設定
        </Button>
        {canArchive && (
          p.status === "archived" ? (
            <Button size="sm" disabled={archiveProject.isPending} onClick={() => archiveProject.mutate({ id, archived: false })}>
              還原專案
            </Button>
          ) : (
            <ConfirmButton
              triggerClassName="btn-sm"
              disabled={archiveProject.isPending}
              message={`封存「${p.title}」？封存後會從作業台隱藏，需要時可還原（不會刪除內容）。`}
              confirmLabel="封存"
              onConfirm={() => archiveProject.mutate({ id, archived: true })}
            >
              封存專案
            </ConfirmButton>
          )
        )}
      </div>
      <p className="sub project-hero__meta">
        {/* 比例改用小方框＋數字：一眼看出這支是橫的還直的（純數字對非技術夥伴不直觀） */}
        <FormatTag format={p.format} />・{p.platform}
        {wv.logline ? `・${wv.logline}` : ""}
      </p>
      </header>
      {archiveProject.error && <p className="error">{archiveProject.error.message}</p>}

      {/* 2.3 唯讀橫幅：檢視者第一眼就知道自己是唯讀＋能做什麼＋找誰解鎖（不是「系統一直壞」） */}
      {!canEdit && (
        <Card
          role="status"
          data-fb="唯讀橫幅"
          style={{ padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Icon name="Lock" size={15} style={{ flexShrink: 0, color: "var(--primary-ink)" }} />
          <span style={{ fontSize: 13 }}>
            你在此專案是<b>檢視者（唯讀）</b>——可以瀏覽、留言、下載交付；要編輯或生成，請組長把你的專案權限改成編輯者。
          </span>
        </Card>
      )}

      <div className="cols story-inline-layout">
        <div className="stack">
          <div id="stage-story" className="story-inline-legacy-anchor" />
          <SectionErrorBoundary title="故事">
            <StoryStage
              projectId={id}
              canEdit={canEdit}
              mobileCompact={mobileCompact}
              onOpenSettings={() => {
                setSettingsOpen(true);
                setToneTab("story");
              }}
              onRevealSection={openInlineSection}
            />
          </SectionErrorBoundary>
          <StoryReadinessBar
            readiness={readiness}
            canEdit={canEdit}
            primaryLabel={
              readiness.kind === "ready_to_produce"
                ? "展開製作"
                : readiness.kind === "has_result"
                  ? "觀看成果"
                  : undefined
            }
            onPrimary={
              readiness.kind === "ready_to_produce"
                ? () => openInlineSection("production")
                : readiness.kind === "has_result"
                  ? () => openInlineSection("delivery")
                  : undefined
            }
            latestLabel={hasDeliverable ? "已有成片，展開交付" : doneGenCount ? `已完成 ${doneGenCount} 次生成` : undefined}
            onOpenLatest={hasDeliverable ? () => openInlineSection("delivery") : doneGenCount ? () => openInlineSection("production") : undefined}
          />

          <div className="story-inline-rail" data-fb="故事收合列">
            <StoryInlineSection
              sectionId="characters"
              anchorId="sec-characters"
              title="角色"
              summary={charCount == null ? "載入中…" : `${charCount} 位`}
              warning={pendingCount > 0 ? `${pendingCount} 項待確認` : undefined}
              open={openInline === "characters"}
              onOpenChange={(next) => openInlineSection(next ? "characters" : null)}
            >
              <CharacterCards
                projectId={id}
                selectedIds={charIds}
                onToggle={toggleChar}
                onCreated={onCharCreated}
                readOnly={!canEdit}
              />
            </StoryInlineSection>
            <StoryInlineSection
              sectionId="scenes"
              anchorId="sec-scenes"
              title="場景"
              summary={presetCount == null ? "載入中…" : `${presetCount} 處`}
              open={openInline === "scenes"}
              onOpenChange={(next) => openInlineSection(next ? "scenes" : null)}
            >
              <ScenePresetCards
                projectId={id}
                selectedIds={sceneIds}
                onToggle={toggleScene}
                onCreated={onSceneCreated}
                readOnly={!canEdit}
              />
            </StoryInlineSection>
            <StoryInlineSection
              sectionId="props"
              anchorId="sec-props"
              title="道具"
              summary={propCount == null ? "載入中…" : `${propCount} 件`}
              open={openInline === "props"}
              onOpenChange={(next) => openInlineSection(next ? "props" : null)}
            >
              <PropCards
                projectId={id}
                selectedIds={propIds}
                onToggle={toggleProp}
                onCreated={onPropCreated}
                readOnly={!canEdit}
              />
            </StoryInlineSection>
            <StoryInlineSection
              sectionId="storyboard"
              anchorId="stage-board"
              title="分鏡"
              summary={sceneCount > 0 ? `${sceneCount} 鏡` : "尚未產生"}
              open={openInline === "storyboard"}
              onOpenChange={(next) => openInlineSection(next ? "storyboard" : null)}
            >
              <SectionErrorBoundary title="創作台">
                <VisibleCreativeWorkspace projectId={id} canEdit={canEdit} />
              </SectionErrorBoundary>
              <SectionErrorBoundary title="分鏡">
                <StoryboardStage
                  projectId={id}
                  canEdit={canEdit}
                  charIds={charIds}
                  sceneIds={sceneIds}
                  propIds={propIds}
                />
              </SectionErrorBoundary>
            </StoryInlineSection>
          </div>

          {/* 專案設定（二層；PE 計畫 §03）：舊「定調」的資料面全數收納於此——
              整體風格／角色與定裝／知識與素材／回收桶。非必經：主流程 0 個資料庫管理頁。 */}
          {settingsOpen && createPortal(
            <div className="psettings-root">
              <button
                type="button"
                className="psettings-backdrop"
                aria-label="關閉專案設定"
                onClick={() => setSettingsOpen(false)}
              />
              <div
                className="psettings-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="專案設定"
                ref={settingsPanelRef}
              >
                <div className="psettings-sheet__head">
                  <Icon name="SlidersHorizontal" size={16} />
                  <strong>專案設定</strong>
                  <Meta as="span" className="psettings-sheet__lede">全片預設——不擋創作，需要微調才進來</Meta>
                  <Button size="sm" type="button" aria-label="關閉專案設定" onClick={() => setSettingsOpen(false)}>
                    <Icon name="X" size={16} />
                  </Button>
                </div>
                <div className="psettings-sheet__body">
          {/* 總覽卡：狀態一句話 + 子分頁切換 */}
          <div className="ctx-overview" role="region" aria-label="專案上下文一覽">
            <div className="ctx-overview__head">
              <strong className="ctx-overview__title">專案大腦一覽</strong>
              {/* 就緒時不再重述「會自動注入每次生成」——下一行的帶入摘要已經把同一件事講完（去重複文案） */}
              {!wvReady && <Meta>先補「這支片長什麼樣」的基本設定，後面生成才穩</Meta>}
              {/* C2.5：與生成台帶入列同源口徑（勾選數，非庫存總數） */}
              <Meta as="p" data-testid="ctx-bring-in-summary" style={{ margin: "6px 0 0", fontSize: 12 }}>
                {formatBringInSummary({
                  wvReady,
                  characterCount: charIds.length,
                  sceneCount: sceneIds.length,
                  propCount: propIds.length,
                })}
              </Meta>
            </div>
            <div className="ctx-summary" role="group" aria-label="AI 全程共用的上下文一覽">
              {summaryChip(`設定${wvReady ? " ✓" : "（待設）"}`, "#onboard-worldview", wvReady)}
              {hasActs(wv) && summaryChip("三幕", "#onboard-worldview", true)}
              {wv.people.length > 0 && summaryChip(`人物 ${wv.people.length}`, "#onboard-worldview", true)}
              {summaryChip(`角色 ${charCount ?? "…"}`, "#sec-characters", (charCount ?? 0) > 0)}
              {summaryChip(`場景 ${presetCount ?? "…"}`, "#sec-scenes", (presetCount ?? 0) > 0)}
              {summaryChip(`道具 ${propCount ?? "…"}`, "#sec-props", (propCount ?? 0) > 0)}
              {summaryChip(`知識 ${knowledgeCount ?? "…"}`, "#sec-knowledge", (knowledgeCount ?? 0) > 0)}
              {summaryChip(`素材 ${assetCount ?? "…"}`, "#sec-assets", (assetCount ?? 0) > 0)}
            </div>
          </div>

          {/* 定調中心 Sub-Tabs 切換列 */}
          <div className="tone-studio-nav" role="tablist" aria-label="定調分頁">
            <button
              type="button"
              role="tab"
              aria-selected={toneTab === "story"}
              className={`tone-studio-tab ${toneTab === "story" ? "active" : ""}`}
              onClick={() => {
                setToneTab("story");
                setCtxGroupSectionOpen("world", true);
                setCtxSectionOpen("worldview", true);
              }}
            >
              <Icon name="Sparkles" size={15} />
              <span>整體風格</span>
              {wvReady && <span className="tone-tab-badge tone-tab-badge--success">✓</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={toneTab === "costume"}
              className={`tone-studio-tab ${toneTab === "costume" ? "active" : ""}`}
              onClick={() => {
                setToneTab("costume");
                setCtxGroupSectionOpen("world", true);
                setCostumePackOpen(true);
              }}
            >
              <Icon name="Users" size={15} />
              <span>角色與定裝</span>
              {((charCount ?? 0) + (presetCount ?? 0) + (propCount ?? 0)) > 0 && (
                <span className="tone-tab-badge">{(charCount ?? 0) + (presetCount ?? 0) + (propCount ?? 0)}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={toneTab === "sources"}
              className={`tone-studio-tab ${toneTab === "sources" ? "active" : ""}`}
              onClick={() => {
                setToneTab("sources");
                setCtxGroupSectionOpen("sources", true);
              }}
            >
              <Icon name="FolderGit2" size={15} />
              <span>知識與素材</span>
              {((knowledgeCount ?? 0) + (assetCount ?? 0)) > 0 && (
                <span className="tone-tab-badge">{(knowledgeCount ?? 0) + (assetCount ?? 0)}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={toneTab === "recycle"}
              className={`tone-studio-tab ${toneTab === "recycle" ? "active" : ""}`}
              onClick={() => {
                setToneTab("recycle");
                setCtxGroupSectionOpen("manage", true);
                setCtxSectionOpen("recycle", true);
              }}
            >
              <Icon name="Trash2" size={15} />
              <span>回收桶</span>
            </button>
          </div>

          {/* ── 定調 1：故事與畫風 ── */}
          <div style={{ display: toneTab === "story" ? "block" : "none" }}>
            <CollabZone {...zoneProps(COLLAB_ZONES.worldview)}>
            <CtxCollapse
              compact={mobileCompact}
              sectionId="onboard-worldview"
              title="這支片的固定設定"
              meta={wvReady ? "可以開始出圖" : "還差一點"}
              open={ctxOpen.worldview}
              onOpenChange={(o) => setCtxSectionOpen("worldview", o)}
            >
            <Card as="section" data-fb="世界觀卡" id="onboard-worldview-card">
              <h2>
                這支片的固定設定
                <HelpTip text="填一次就好。下面「AI 會收到什麼」可以直接看到每次生成實際送出去的字。（這一區以前叫「世界觀」）" />
                {updateWv.isPending ? (
                  <Meta style={{ marginLeft: 8, fontSize: 13, fontWeight: 400 }}>儲存中…</Meta>
                ) : wvSaved !== "idle" ? (
                  <Meta
                    style={{
                      marginLeft: 8, fontSize: 13, fontWeight: 400, color: "var(--primary-ink)",
                      opacity: wvSaved === "fading" ? 0 : 1, transition: "opacity var(--dur-slow)",
                    }}
                  >
                    已儲存 <Icon name="Check" size={13} />
                  </Meta>
                ) : null}
              </h2>
              {!canEdit && <Hint style={{ margin: "4px 0 0" }}>檢視者唯讀——這些設定可以看，不能改（打的字不會被儲存）。</Hint>}
              {/* C0 (#402)：就緒狀態一句話 + 未就緒 CTA——對齊 isWorldviewReady（一句話＋氣氛或畫風） */}
              <div
                className="wv-ready-strip"
                role="status"
                data-testid="wv-ready-strip"
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${wvReady ? "var(--border, #e5e7eb)" : "var(--warn, #b45309)"}`,
                  background: wvReady ? "var(--surface-2, transparent)" : "color-mix(in srgb, var(--warn, #b45309) 8%, transparent)",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Meta as="span" style={{ fontSize: 13, fontWeight: 600 }}>
                  {wvReady ? "基本設定就緒 ✓——每次生成會自動帶上" : "基本設定還沒齊——補一句話，再選氣氛或畫風就能出圖"}
                </Meta>
                {!wvReady ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCtxSectionOpen("worldview", true);
                      requestAnimationFrame(() => {
                        focusAndReveal(document.getElementById("wv-logline"));
                      });
                    }}
                  >
                    去填一句話
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      // 就緒後主 CTA：關掉設定、進創作台直接出圖
                      setSettingsOpen(false);
                      openInlineSection("production");
                      revealWorkbenchAnchor("#sec-studio", { projectId: id });
                    }}
                  >
                    去創作台出圖
                  </Button>
                )}
              </div>
              {/* 全空的專案：先給一份可以照抄的範例（含「套下去 AI 會收到什麼」的預覽）。
                  唯讀成員也看得到範例本身，只是沒有套用按鈕。 */}
              {wvBlank && !wvExampleDismissed && (
                <WorldviewExampleCard
                  wv={wv}
                  kind={p.kind}
                  canEdit={canEdit}
                  onApply={(patch) => updateWv.mutate({ id, worldview: patch })}
                  onApplyAndGoStudio={(patch) => {
                    // C3.2：一鍵套用範例 → 創作台（optimistic 先寫入再 reveal；設定 sheet 先關）
                    updateWv.mutate({ id, worldview: patch });
                    setSettingsOpen(false);
                    openInlineSection("production");
                    revealWorkbenchAnchor("#sec-studio", { projectId: id });
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        focusAndReveal(document.getElementById("gen-prompt"));
                      });
                    });
                  }}
                  onDismiss={dismissWvExample}
                />
              )}
              {/* 引導鋪軌：只讀 wv、不持有任何欄位值 */}
              <WorldviewGuide
                wv={wv}
                onJump={(anchor, stepId) => {
                  if (stepId === "narrative") setWvAdvancedOpen(true);
                  scrollToSelector(anchor);
                }}
              />
              {/* 這裡刻意不再放「故事定盤星視覺藍圖」摘要卡：它顯示的一句話／金句／畫風
                  就是正下方欄位的原字，同一屏會上下重複一次。摘要留給收合後的區塊標題與
                  下方「AI 會收到什麼」預覽即可。 */}
              {/* C0 主路徑：會進生成的最少欄位——一句話／訊息、氣氛、畫風、禁忌；其餘進 details */}
              <label htmlFor="wv-logline">
                這支片在講什麼？
                <FieldReaders field="logline" />
                <HelpTip text="一句話就好。會截成 80 字接在每次出圖的提示詞後面。" />
              </label>
              <input
                key={`logline-${wv.logline}`}
                id="wv-logline"
                defaultValue={wv.logline}
                readOnly={!canEdit}
                maxLength={500}
                placeholder="例：陳師姐從憂鬱低谷透過印心佛法走出重生"
                onBlur={(e) => canEdit && e.target.value !== wv.logline && updateWv.mutate({ id, worldview: { logline: e.target.value } })}
              />
              <label htmlFor="wv-message">
                看完要記得哪一句？
                <FieldReaders field="message" />
                <HelpTip text="一支片只講一件事。這句會原封不動送進出圖和文字 AI。" />
              </label>
              <input
                key={`message-${wv.message}`}
                id="wv-message"
                defaultValue={wv.message}
                readOnly={!canEdit}
                maxLength={500}
                placeholder="例：把心交給佛，煩惱就交給了光"
                onBlur={(e) => canEdit && e.target.value !== wv.message && updateWv.mutate({ id, worldview: { message: e.target.value } })}
              />
              <label id="wv-tones">
                氣氛調性
                <FieldReaders field="tones" />
                <HelpTip text="畫面給人的感覺。挑 1～2 個合得來的（如溫暖＋真誠）。第一個為主；出圖只取前 2 個。點「設主要」可改優先序。" />
              </label>
              <ToneVisualPalette
                tones={wv.tones}
                options={toneOpts}
                labelledBy="wv-tones"
                canEdit={canEdit}
                onToggle={(tone) => toggle("tones", tone)}
                onPromote={(tone) => promote("tones", tone)}
                renderAddOption={
                  isLeader && canEdit ? (
                    <AddOptionChip groupId={p.groupId} type="tone" onAdded={(label) => toggle("tones", label)} />
                  ) : null
                }
                orphans={orphansOf("tones", toneOpts)}
                isLoading={options.isLoading}
              />
              <label id="wv-styles" style={{ marginTop: 12, display: "block" }}>
                出圖畫風
                <FieldReaders field="styles" />
                <Meta as="span" style={{ marginLeft: 6, fontSize: 12, fontWeight: 400 }}>每張圖看起來像什麼——這一項最有效</Meta>
                <HelpTip text="先選畫法（寫實／插畫／3D），再選一個主風格；同家族可加一個質感（如膠片）。跨畫法不會混進同一張圖。" />
              </label>
              {stylePicker("wv-styles")}
              {wvChipWarnings.length > 0 && (
                <Hint role="status" style={{ marginTop: 8, fontSize: 12, color: "var(--warn, #b45309)" }}>
                  {wvChipWarnings.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </Hint>
              )}
              {isLeader && (
                <Hint style={{ marginTop: 8, fontSize: 12 }}>
                  選項可直接按各列的「＋新增」加；改名／停用／排序在 <Link href="/options">選項整理頁</Link>。
                  實際會注入哪些，下方「AI 會收到什麼」直接看得到。
                </Hint>
              )}
              {/* C0：禁忌會進生成負向／避免——留在主路徑；預設禁語仍可摺疊調整 */}
              <div
                style={{
                  marginTop: 12,
                  marginBottom: 4,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border, #e5e7eb)",
                }}
              >
                <Meta style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  不能出現的東西
                  <FieldReaders field="taboos" />
                </Meta>
                {isDefaultTaboosOnly(wv.taboos) ? (
                  <details>
                    <summary style={{ cursor: "pointer", fontSize: 13 }}>
                      合規保護已開啟 ✓（預設禁語；點此展開調整）
                    </summary>
                    <div style={{ marginTop: 8 }}>
                      <TokenListEditor
                        id="wv-taboos"
                        label="不能講、不能出現的"
                        fieldKey="taboos"
                        hint="圖影走負向（模型需支援）；文字與助手走「避免」。刪預設前會確認。"
                        values={wv.taboos}
                        placeholder="例：不得出現可讀文字（Enter 加入）"
                        readOnly={!canEdit}
                        onChange={(next) => {
                          if (removesDefaultTaboos(wv.taboos, next)) {
                            const ok = window.confirm(
                              "你正在移除預設的弘法禁語（醫療宣稱／影射真人／開示須審核）。確定要關閉這層合規保護嗎？",
                            );
                            if (!ok) return;
                          }
                          updateWv.mutate({ id, worldview: { taboos: next } });
                        }}
                      />
                    </div>
                  </details>
                ) : (
                  <TokenListEditor
                    id="wv-taboos"
                    label="不能講、不能出現的"
                    fieldKey="taboos"
                    hint="圖影走負向（模型需支援）；文字與助手走「避免」。刪預設前會確認。"
                    values={wv.taboos}
                    placeholder="例：不得出現可讀文字（Enter 加入）"
                    readOnly={!canEdit}
                    onChange={(next) => {
                      if (removesDefaultTaboos(wv.taboos, next)) {
                        const ok = window.confirm(
                          "你正在移除預設的弘法禁語（醫療宣稱／影射真人／開示須審核）。確定要關閉這層合規保護嗎？",
                        );
                        if (!ok) return;
                      }
                      updateWv.mutate({ id, worldview: { taboos: next } });
                    }}
                  />
                )}
              </div>
              {/* 注入預覽：必須在進階摺疊層「之上」。C0：預設收合，縮短首屏高度。 */}
              <WorldviewPreview
                wv={wv}
                cardCounts={{ characters: charIds.length, scenes: sceneIds.length, props: propIds.length }}
                defaultOpen={false}
              />
              {/* 進階層：故事走向 + 敘事 AI + 交接備註（出圖不吃）；禁忌已提升至主路徑 */}
              <details
                style={{ marginTop: 10 }}
                open={
                  wvAdvancedOpen ||
                  hasActs(wv) ||
                  !!wv.audience.trim() ||
                  wv.people.length > 0 ||
                  wv.themes.length > 0
                }
                onToggle={(e) => setWvAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary style={{ cursor: "pointer", fontSize: 13 }}>
                  進階：故事走向、給寫字的 AI、交接備註（可以晚點再填）
                </summary>
                <div style={{ marginTop: 8 }}>
                  <Hint style={{ marginBottom: 12, fontSize: 12 }}>
                    <strong>上面填完就能出圖。</strong>
                    這裡填了，寫腳本／拆分鏡／問助手會更準；
                    <strong>直接出圖不吃</strong>故事走向／觀眾／三幕／人物（畫面請用畫風＋角色定裝卡）。
                  </Hint>

                  <label id="wv-themes">
                    故事走向
                    <FieldReaders field="themes" />
                    <HelpTip text="可略過。只給寫腳本／拆分鏡的 AI 看，出圖不吃。建議 1～2 個，第一個為主。" />
                  </label>
                  {chipGroup("themes", themeOpts, "theme", "wv-themes")}

                  {/* ① 給敘事 AI */}
                  <div
                    style={{
                      marginTop: 12,
                      marginBottom: 14,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border, #e5e7eb)",
                      background: "var(--surface-2, transparent)",
                    }}
                  >
                    <Meta style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                      ① 寫腳本、拆分鏡時會用到
                      <Meta as="span" style={{ fontWeight: 400, marginLeft: 6, fontSize: 11, opacity: 0.85 }}>
                        出圖不吃這一段
                      </Meta>
                    </Meta>
                    {canEdit && (
                      <Meta style={{ display: "block", marginBottom: 10, fontSize: 12 }}>
                        <button
                          type="button"
                          className="linkish"
                          style={{
                            border: 0,
                            background: "none",
                            cursor: "pointer",
                            color: "var(--primary-ink)",
                            textDecoration: "underline",
                            fontSize: 12,
                            fontWeight: 600,
                            padding: 0,
                          }}
                          onClick={() => {
                            const patch = applyWorldviewAdvancedExample(wv, p.kind, true);
                            if (!Object.keys(patch).length) return;
                            updateWv.mutate({ id, worldview: patch });
                          }}
                        >
                          空白欄帶入範例
                        </button>
                        <span style={{ opacity: 0.5 }}> · </span>
                        <button
                          type="button"
                          className="linkish"
                          style={{
                            border: 0,
                            background: "none",
                            cursor: "pointer",
                            color: "var(--primary-ink)",
                            textDecoration: "underline",
                            fontSize: 12,
                            padding: 0,
                          }}
                          onClick={() => {
                            if (!window.confirm("要用範例覆寫目前的觀眾、三幕與敘事人物嗎？（禁忌與參考連結不動）")) return;
                            const patch = applyWorldviewAdvancedExample(wv, p.kind, false);
                            updateWv.mutate({ id, worldview: patch });
                          }}
                        >
                          整段換成範例
                        </button>
                        <span style={{ marginLeft: 6, opacity: 0.75 }}>（依本專案類型微調，可再改）</span>
                      </Meta>
                    )}

                    <label htmlFor="wv-audience">
                      這支片給誰看？
                      <FieldReaders field="audience" />
                      <HelpTip text="給誰看。會進助手／代理、文字生成、導演；不會塞進圖影正向 prompt。" />
                    </label>
                    <input
                      key={`audience-${wv.audience}`}
                      id="wv-audience"
                      defaultValue={wv.audience}
                      readOnly={!canEdit}
                      maxLength={500}
                      placeholder="例：想在忙碌生活裡找片刻安定的年輕人與家庭"
                      onBlur={(e) => canEdit && e.target.value !== wv.audience && updateWv.mutate({ id, worldview: { audience: e.target.value } })}
                    />

                    <ThreeActStoryArc
                      acts={wv.acts}
                      canEdit={canEdit}
                      onChange={(field, value) => {
                        updateWv.mutate({ id, worldview: { acts: { ...wv.acts, [field]: value } } });
                      }}
                      sceneCount={scenes.data?.length ?? 0}
                      onSplitFromOutline={
                        canEdit
                          ? () => splitFromOutline.mutate({ projectId: id, fromOutline: true })
                          : undefined
                      }
                      splitting={splitFromOutline.isPending}
                      splitError={splitFromOutline.error?.message ?? null}
                      onSeeScenes={() => {
                        setSettingsOpen(false);
                        scrollToSelector("#stage-deliver");
                      }}
                    />

                    <label style={{ marginTop: 10, display: "block" }} id="wv-people-label">
                      故事裡有誰（純文字）
                      <FieldReaders field="people" />
                      <HelpTip text="故事裡有誰（文字）。要畫得像請按「建定裝」→ 角色定裝卡，生成時勾選。" />
                    </label>
                    <div role="group" aria-labelledby="wv-people-label">
                      {wv.people.map((token) => {
                        const parsed = parsePersonTokenForCharacter(token);
                        const existing = characters.data?.find((c) => c.name === parsed.name);
                        return (
                          <Chip key={token} style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "4px 6px 4px 0" }}>
                            <span>{token}</span>
                            {canEdit && (
                              <>
                                {existing ? (
                                  <button
                                    type="button"
                                    className="linkish"
                                    style={{
                                      border: 0,
                                      background: "none",
                                      cursor: "pointer",
                                      color: "var(--primary-ink)",
                                      textDecoration: "underline",
                                      fontSize: 11,
                                      padding: 0,
                                    }}
                                    title="已有同名定裝，捲到角色定裝並勾選"
                                    onClick={() => {
                                      setCharIds((prev) => {
                                        if (prev.includes(existing.id) || prev.length >= 6) return prev;
                                        return [...prev, existing.id];
                                      });
                                      setCtxSectionOpen("characters", true);
                                      setToneTab("costume");
                                      requestAnimationFrame(() => {
                                        scrollToSelector("#sec-characters");
                                      });
                                    }}
                                  >
                                    已有定裝
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="linkish"
                                    style={{
                                      border: 0,
                                      background: "none",
                                      cursor: "pointer",
                                      color: "var(--primary-ink)",
                                      textDecoration: "underline",
                                      fontSize: 11,
                                      fontWeight: 600,
                                      padding: 0,
                                    }}
                                    disabled={addCharFromPerson.isPending}
                                    title="建立角色定裝卡（外觀可再改）"
                                    onClick={() => {
                                      addCharFromPerson.mutate({
                                        projectId: id,
                                        name: parsed.name,
                                        appearance: parsed.appearance,
                                        notes: parsed.notes,
                                        clientRequestId: crypto.randomUUID(),
                                      });
                                    }}
                                  >
                                    建定裝
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="tag-remove"
                                  aria-label={`移除「${token}」`}
                                  title="移除"
                                  onClick={() => updateWv.mutate({ id, worldview: { people: wv.people.filter((x) => x !== token) } })}
                                >
                                  <Icon name="X" size={12} />
                                </button>
                              </>
                            )}
                          </Chip>
                        );
                      })}
                      {wv.people.length === 0 && !canEdit && <Meta>未設定</Meta>}
                      {canEdit && (
                        <NarrativePersonAdd
                          onAdd={(token) => {
                            if (wv.people.includes(token) || wv.people.length >= 30) return;
                            updateWv.mutate({ id, worldview: { people: [...wv.people, token] } });
                          }}
                          disabled={wv.people.length >= 30}
                        />
                      )}
                    </div>
                    {canEdit && wv.people.length > 0 && (charCount === 0 || charCount == null) && (
                      <Hint style={{ marginTop: 6, fontSize: 12, color: "var(--warn, #b45309)" }}>
                        已有敘事人物、尚無角色定裝——出圖外觀可能不穩。點人物旁「建定裝」或到下方角色定裝建卡。
                      </Hint>
                    )}
                    {addCharFromPerson.error && (
                      <p className="error" style={{ marginTop: 6 }}>{addCharFromPerson.error.message}</p>
                    )}
                    <Hint style={{ margin: "6px 0 0", fontSize: 12 }}>
                      寫法可用「名字＝外觀」（例：安倢＝紅傘、米白外套），建定裝會拆成名與外觀。
                    </Hint>
                  </div>

                  {/* ② 交接備註（禁忌已提升至主路徑） */}
                  <div
                    style={{
                      marginBottom: 8,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px dashed var(--border, #e5e7eb)",
                    }}
                  >
                    <Meta style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                      ② 給人看的備註（AI 不會讀）
                      <FieldReaders field="references" />
                    </Meta>
                    <Hint style={{ marginBottom: 8, fontSize: 12 }}>
                      只寫進交付鏡頭表給人看；不會影響生成或導演。
                    </Hint>
                    <TokenListEditor
                      id="wv-references"
                      label="參考連結"
                      fieldKey="references"
                      hint="剪輯／企劃交接用網址。"
                      values={wv.references}
                      placeholder="貼上參考影片/文章網址（Enter 加入）"
                      readOnly={!canEdit}
                      onChange={(next) => updateWv.mutate({ id, worldview: { references: next } })}
                    />
                  </div>
                </div>
              </details>

              {updateWv.error && <p className="error">設定儲存失敗：{updateWv.error.message}</p>}
            </Card>
            </CtxCollapse>
            </CollabZone>
          </div>

          {/* ── 定調 2：角色與場景定裝 ── */}
          <div style={{ display: toneTab === "costume" ? "block" : "none" }}>
            {/* 定裝是「分鏡改完會不會前後不一致」的源頭——SceneList 的 SceneCardBinding 直接吃這些卡，
                改一張角色卡就等於同時改了所有綁它的分鏡，而這裡原本是全頁唯一沒有協作訊號的區塊。
                zone 名字全站唯一（一個 zone 一個 CtxCollapse，比照世界觀／素材庫），
                鏡像跟隨的 `document.querySelector('[data-collab-zone=…]')` 才不會抓錯人。
                已知限制：定調的子分頁是 display:none 切換的，看的人得停在同一個子分頁才看得到這個
                訊號；跟隨端拿到的隱藏元素 rect 全 0，由 useCollabMirrorFollow 的 0-rect 守衛擋掉。
                要讓訊號在分頁收起時也看得見，得把 zone 狀態接到上面四顆子分頁鈕上——那是另一件事。 */}
            <CollabZone {...zoneProps(COLLAB_ZONES.cards)}>
            <CtxCollapse
              compact={mobileCompact}
              sectionId="sec-costume"
              title="定裝"
              meta={[
                charCount != null ? `角${charCount}` : null,
                presetCount != null ? `景${presetCount}` : null,
                propCount != null ? `道${propCount}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined}
              open={costumePackOpen}
              onOpenChange={setCostumePackOpen}
            >
              <CostumePackSection
                omitLegacyAnchors
                tab={costumeTab}
                onTabChange={(t) => {
                  setCostumeTab(t);
                  setCtxSectionOpen(t, true);
                }}
                counts={{
                  characters: charCount,
                  scenes: presetCount,
                  props: propCount,
                }}
                carriedHint={
                  <>
                    勾選角色／場景後，歸屬在它們名下的道具會在生成時
                    <strong>自動帶入</strong>
                    （與創作台數字同源；手動勾選優先）。目前預覽會多帶{" "}
                    {carriedPropIds.filter((pid) => !propIds.includes(pid)).length} 件。
                  </>
                }
                panels={{
                  characters: (
                    <CharacterCards
                      projectId={id}
                      selectedIds={charIds}
                      onToggle={toggleChar}
                      onCreated={onCharCreated}
                      readOnly={!canEdit}
                    />
                  ),
                  scenes: (
                    <ScenePresetCards
                      projectId={id}
                      selectedIds={sceneIds}
                      onToggle={toggleScene}
                      onCreated={onSceneCreated}
                      readOnly={!canEdit}
                    />
                  ),
                  props: (
                    <PropCards
                      projectId={id}
                      selectedIds={propIds}
                      onToggle={toggleProp}
                      onCreated={onPropCreated}
                      readOnly={!canEdit}
                    />
                  ),
                }}
              />
              {/* C2.3：回到原處——主 CTA 依 returnTo；無記憶時兩鈕並列次要 */}
              <div
                className="context-return-bar"
                data-testid="context-return-bar"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: "1px solid var(--border-soft)",
                  position: "sticky",
                  bottom: 0,
                  background: "var(--card, var(--bg))",
                  zIndex: 1,
                }}
              >
                <Button
                  type="button"
                  size="sm"
                  // C2.3：僅在從該站來時 primary；null（直開頁）時兩鈕皆 ghost
                  variant={contextReturnTo === "studio" ? "primary" : "ghost"}
                  onClick={() => {
                    setSettingsOpen(false);
                    openInlineSection("production");
                    returnFromContext("studio", { projectId: id });
                    setContextReturnTo(null);
                  }}
                >
                  回到創作台
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={contextReturnTo === "scenes" ? "primary" : "ghost"}
                  onClick={() => {
                    setSettingsOpen(false);
                    openInlineSection("delivery");
                    returnFromContext("scenes", { projectId: id });
                    setContextReturnTo(null);
                  }}
                >
                  回到分鏡
                </Button>
                {contextReturnTo ? (
                  <Meta as="span" style={{ fontSize: 12, alignSelf: "center" }}>
                    {contextReturnTo === "studio" ? "從創作台來——改完可回生成" : "從分鏡來——改完可回交付"}
                  </Meta>
                ) : null}
              </div>
            </CtxCollapse>
            </CollabZone>
          </div>

          {/* ── 定調 3：依據與素材（知識庫／資料表／素材庫） ── */}
          <div style={{ display: toneTab === "sources" ? "block" : "none" }}>
            <CtxGroup
              groupId="ctx-group-sources"
              title="依據與素材"
              lede="知識庫、專案資料表、上傳素材——給 AI 可引用的事實與來源"
              meta={[
                ...(knowledgeCount != null ? [`知${knowledgeCount}`] : []),
                ...(assetCount != null ? [`材${assetCount}`] : []),
              ].join(" · ") || undefined}
              compact={mobileCompact}
              open={ctxGroupOpen.sources}
              onOpenChange={(o) => setCtxGroupSectionOpen("sources", o)}
            >
            {/* 專案脈絡（Context Engine）：這個專案在用哪些資料、各自扮演什麼角色。
                知識庫／素材庫／資料表繼續是資料的真相；這一區回答的是另一件事——
                「AI 生成與問答時，優先該用誰」。加入的是引用，不複製任何原始檔案。 */}
            <div id="sec-project-context" data-fb="專案資料">
              <ProjectContextPanel projectId={id} canEdit={canEdit} />
            </div>

            {/* 專案知識庫：AI 讀得懂上傳的開示/見證/腳本（願景核心「真的懂我們」）。
                補 collab zone 的理由與素材庫同一條：這裡是 AI 引用的事實來源，
                兩個人同時整理（一個刪、一個補）會互相蓋掉，而原本連「有人在這裡」都看不到。 */}
            <CollabZone {...zoneProps(COLLAB_ZONES.knowledge)}>
            <CtxCollapse
              compact={mobileCompact}
              sectionId="sec-knowledge"
              title="知識庫"
              meta={knowledgeCount != null ? `${knowledgeCount} 份` : undefined}
              open={ctxOpen.knowledge}
              onOpenChange={(o) => setCtxSectionOpen("knowledge", o)}
            >
              <KnowledgeBase projectId={id} readOnly={!canEdit} />
            </CtxCollapse>
            </CollabZone>

            {/* 專案資料：AI 可引用狀態 + 一鍵建表；手機受控預設收合，桌機維持展開 */}
            <ProjectDatabasesCard
              projectId={id}
              canEdit={canEdit}
              open={mobileCompact ? ctxOpen.databases : undefined}
              onOpenChange={mobileCompact ? (o) => setCtxSectionOpen("databases", o) : undefined}
            />

            {/* 素材庫屬①上下文；「用作來源」切到工作台直接生成模式並帶入來源 */}
            <CollabZone {...zoneProps(COLLAB_ZONES.assets)}>
              <div data-fb="上傳素材">
                <CtxCollapse
                  compact={mobileCompact}
                  sectionId="sec-assets"
                  title="素材庫"
                  meta={assetCount != null ? `${assetCount}` : undefined}
                  open={ctxOpen.assets}
                  onOpenChange={(o) => setCtxSectionOpen("assets", o)}
                >
                  <AssetLibrary
                    projectId={id}
                    selectedSourceId={sourceHighlightId}
                    onPickSource={(a) => {
                      setSourceHighlightId(a.id);
                      setGenerateApply((prev) => ({
                        nonce: (prev?.nonce ?? 0) + 1,
                        sourceAsset: a,
                      }));
                      setSettingsOpen(false);
                      openInlineSection("production");
                      revealWorkbenchAnchor("#sec-studio", { projectId: id });
                    }}
                  />
                </CtxCollapse>
              </div>
            </CollabZone>
            </CtxGroup>
          </div>

          {/* ── 分組 C：管理（回收桶）——預設收合 ── */}
          <div style={{ display: toneTab === "recycle" ? "block" : "none" }}>
            <CtxGroup
              groupId="ctx-group-manage"
              title="回收桶"
              lede="已刪除的分鏡與素材——需要時可在此還原"
              compact={mobileCompact}
              open={ctxGroupOpen.manage}
              onOpenChange={(o) => setCtxGroupSectionOpen("manage", o)}
            >
              <CtxCollapse
                compact={mobileCompact}
                sectionId="sec-recyclebin"
                title="回收桶"
                open={ctxOpen.recycle}
                onOpenChange={(o) => setCtxSectionOpen("recycle", o)}
              >
                <RecycleBin projectId={id} />
              </CtxCollapse>
            </CtxGroup>
          </div>
                </div>
              </div>
            </div>,
            document.body,
          )}

          <div className="story-inline-rail">
            <StoryInlineSection
              sectionId="production"
              anchorId="stage-create"
              title="製作"
              summary={doneGenCount != null ? `已完成 ${doneGenCount} 次` : "載入中…"}
              open={openInline === "production"}
              onOpenChange={(next) => openInlineSection(next ? "production" : null)}
            >
              <SectionErrorBoundary title="製作">
                <CreationWorkbench
                  projectId={id}
                  canEdit={canEdit}
                  isLeader={isLeader}
                  groupId={p.groupId}
                  myRole={myRole}
                  projectFormat={p.format}
                  worldview={{
                    logline: wv.logline,
                    message: wv.message,
                    tones: wv.tones,
                    styles: wv.styles,
                    taboos: wv.taboos,
                  }}
                  wvReady={wvReady}
                  characterIds={charIds}
                  scenePresetIds={sceneIds}
                  propIds={propIds}
                  carriedPropIds={carriedPropIds}
                  generateApplyRequest={generateApply}
                  onReuseGenerate={applyPrompt}
                  onGenerateSourceChange={setSourceHighlightId}
                  studioCollab={zoneProps(COLLAB_ZONES.studio)}
                />
              </SectionErrorBoundary>
            </StoryInlineSection>
            <StoryInlineSection
              sectionId="delivery"
              anchorId="stage-deliver"
              title="交付"
              summary={sceneCount > 0 ? `${sceneCount} 鏡` : "尚無分鏡"}
              open={openInline === "delivery"}
              onOpenChange={(next) => openInlineSection(next ? "delivery" : null)}
            >
              <SectionErrorBoundary title="交付">
                <DeliveryRoom
                  projectId={id}
                  canEdit={canEdit}
                  onOpenShot={(shotId) => {
                    openInlineSection("storyboard");
                    requestAnimationFrame(() => scrollToSelector(`#board-shot-${shotId}`));
                  }}
                />
              </SectionErrorBoundary>
              <CollabZone {...zoneProps(COLLAB_ZONES.scenes)}>
                <div data-fb="打包下載" id="onboard-delivery">
                  <SceneList projectId={id} canEdit={canEdit} charIds={charIds} sceneIds={sceneIds} propIds={propIds} format={p.format} anchorPeers={collab.anchorPeers} />
                </div>
              </CollabZone>
              <ProjectShareCard projectId={id} canEdit={canEdit} />
            </StoryInlineSection>
          </div>
        </div>

        {/* 組內留言：桌機側欄；手機改 FAB → bottom sheet（不進主長流，避免佔捲動高度）。
            id 供 ?focus=messages 通知深連結捲動定位——這個錨點已被平行 PR 弄丟兩次
            （#246、#251），別再拿掉。 */}
        {!mobileCompact && (
          <CollabZone {...zoneProps(COLLAB_ZONES.messages)}>
            <div id="project-messages">
              <MessagePanel
                projectId={id}
                groupId={p.groupId}
                isLeader={isLeader}
                canEdit={canEdit}
                focusMessageId={focusMessageId}
                onFocusHandled={() => setFocusMessageId(undefined)}
              />
            </div>
          </CollabZone>
        )}
      </div>

      {mobileCompact && (
        <>
          <button
            type="button"
            className="project-messages-fab"
            aria-label={unreadBadgeLabel ? `組內留言，未讀 ${unreadBadgeLabel}` : "組內留言"}
            aria-haspopup="dialog"
            aria-expanded={messagesSheetOpen}
            onClick={() => setMessagesSheetOpen(true)}
          >
            <Icon name="MessageCircle" size={20} />
            <span>留言</span>
            {unreadBadgeLabel && (
              <span className="project-messages-fab__badge" aria-hidden>{unreadBadgeLabel}</span>
            )}
          </button>
          {messagesSheetOpen && createPortal(
            <div className="project-messages-sheet-root">
              <button
                type="button"
                className="project-messages-sheet-backdrop"
                aria-label="關閉留言"
                onClick={() => setMessagesSheetOpen(false)}
              />
              <div
                className="project-messages-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="組內留言"
              >
                <div className="project-messages-sheet__head">
                  <strong>組內留言</strong>
                  <Button size="sm"
                    type="button"
                    aria-label="關閉"
                    onClick={() => setMessagesSheetOpen(false)}>
                    <Icon name="X" size={16} />
                  </Button>
                </div>
                <div className="project-messages-sheet__body">
                  <CollabZone {...zoneProps(COLLAB_ZONES.messages)}>
                    <MessagePanel
                      projectId={id}
                      groupId={p.groupId}
                      isLeader={isLeader}
                      canEdit={canEdit}
                      bare
                      focusMessageId={focusMessageId}
                      onFocusHandled={() => setFocusMessageId(undefined)}
                    />
                  </CollabZone>
                </div>
              </div>
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}
