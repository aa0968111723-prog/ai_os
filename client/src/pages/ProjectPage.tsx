import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { trpc } from "../api";
import { DISCUSS_EVENT, flashAnchor } from "../discuss";
import { useMatchMedia } from "../lib/useMatchMedia";
import { Icon } from "../components/Icon";
import { ConfirmButton, HelpTip } from "../components/interactions";
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
import { MessagePanel } from "../components/MessagePanel";
import { AssetLibrary } from "../components/AssetLibrary";
import { RecycleBin } from "../components/RecycleBin";
import { KnowledgeBase } from "../components/KnowledgeBase";
import { CharacterCards } from "../components/CharacterCards";
import { ScenePresetCards } from "../components/ScenePresetCards";
import { PropCards } from "../components/PropCards";
import {
  CostumePackSection,
  costumeTabFromTarget,
  type CostumeTab,
} from "../components/CostumePackSection";
import { DEFAULT_ITEMS as TOC_DEFAULT_ITEMS, TocNav } from "../components/TocNav";
import { CreationWorkbench } from "../features/creation-workbench/CreationWorkbench";
import { loadDraft } from "../features/creation-workbench/creationDraft";
import {
  type DirectGenerateApplyRequest,
} from "../features/creation-workbench/modes/DirectGenerateMode";
import { projectCanEdit } from "../features/creation-workbench/generationGates";
import { revealWorkbenchAnchor, scrollToSelector } from "../features/creation-workbench/workbenchNav";
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
import { SimpleProjectMode } from "../features/project-simple/SimpleProjectMode";
import { resolveProjectMode, saveProjectMode, type ProjectMode } from "../features/project-simple/simpleMode";
import { ProjectMembersCard } from "../components/ProjectMembersCard";
import { ProjectDatabasesCard } from "../components/ProjectDatabasesCard";
import { VisualJourney, type VisualJourneyStep } from "../components/VisualJourney";
import { WorldviewPreview } from "../components/WorldviewPreview";
import { WorldviewGuide } from "../components/WorldviewGuide";
import { WorldviewExampleCard } from "../components/WorldviewExampleCard";
import { Button, Card, Chip, Hint, Meta } from "../components/ui";
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

/** 與 styles.css 單欄／平板界線對齊：≤820px 為手機減負模式 */
const PROJECT_MOBILE_MQ = "(max-width: 820px)";

type CtxSectionKey = "worldview" | "characters" | "scenes" | "props" | "knowledge" | "databases" | "assets" | "recycle";
type CtxGroupKey = "world" | "sources" | "manage";

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
 * 三幕標頭（工作台一體化）：沿用既有 group-head 樣式，帶錨點 id 供 TocNav 捲動定位。
 * hint 顯示該幕進度（全用頁面既有查詢；拿不到資料就不顯示，絕不為此新增後端呼叫）。
 */
function StageHead({ id, num, title, desc, accent, hint }: {
  id: string;
  num: string;
  title: string;
  desc?: string;
  accent: "group-1" | "group-2" | "group-3";
  hint?: string;
}) {
  return (
    <div
      id={id}
      role="heading"
      aria-level={2}
      className={`group-head project-stage-head ${accent}`}
      style={{ scrollMarginTop: "var(--sp-16)" }}
    >
      <span className="group-num">{num}</span>
      <span className="group-title">{title}</span>
      {desc && <span className="group-desc">{desc}</span>}
      <span className="group-rule" />
      {hint && <Meta style={{ whiteSpace: "nowrap" }}>{hint}</Meta>}
    </div>
  );
}

/** 幕與幕之間的銜接語：告訴使用者上一幕的東西怎麼流進下一幕（環環相扣的敘事線） */
function StageLink({ text }: { text: string }) {
  return (
    <Meta as="p" aria-hidden style={{ display: "flex", alignItems: "center", gap: 6, margin: "4px 0 0 2px" }}>
      <Icon name="ChevronDown" size={14} style={{ flexShrink: 0 }} />
      {text}
    </Meta>
  );
}

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
      <div role="group" aria-labelledby={`${id}-label`}>
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
 * 選項就地新增（工作台一體化）：世界觀 chips 旁的「＋新增」——組長不必再繞去「選項」頁，
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
    },
  );
  // 即時協作：presence／彩色游標／編輯指示／mutation 成功時廣播「有東西變了」。
  // 專案載入成功才啟用——FORBIDDEN/NOT_FOUND 頁不必開 WS 去被伺服器拒絕（hook 仍無條件呼叫，順序穩定）
  const collab = useCollab(id, !!project.data);
  // 協作視角：一般（只看 presence／游標）／鏡像跟隨（捲動跟著對方）
  const [collabMode, setCollabMode] = useState<CollabViewMode>("live");
  const [followUserId, setFollowUserId] = useState<string | null>(null);
  useCollabMirrorFollow(collabMode, followUserId, collab.cursorsLiveRef, collab.focusZones, collab.containerRef);
  const followZone = followUserId && collabMode === "mirror" ? zoneOfPeer(followUserId, collab.focusZones) : null;
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
  // - ?focus=pending：捲到分鏡區（待審彙總）
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
      scrollToSelector("#onboard-delivery");
      return;
    }
    if (/^generation-[0-9a-f-]+$/i.test(focus)) {
      revealWorkbenchAnchor("#sec-generations", { projectId: id });
      let tries = 0;
      const timer = window.setInterval(() => {
        tries += 1;
        if (flashAnchor(focus) || tries >= 50) window.clearInterval(timer);
      }, 300);
      return () => window.clearInterval(timer);
    }
    if (/^scene-[0-9a-f-]+$/i.test(focus)) {
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
  // 世界觀三組 chips（主軸／調性／視覺風格）由本專案所屬組的自訂選項供給（組長可就地新增，或到「選項」頁整理）
  const options = trpc.options.byGroup.useQuery(
    { groupId: project.data?.groupId ?? "" },
    { enabled: !!project.data?.groupId },
  );
  /** 世界觀儲存回饋：成功後短暫顯示「已儲存 ✓」再淡出 */
  const [wvSaved, setWvSaved] = useState<"idle" | "shown" | "fading">("idle");
  /** 使用者本次手動切換的模式（null＝沿用 localStorage／預設判定） */
  const [projectModeOverride, setProjectModeOverride] = useState<ProjectMode | null>(null);
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
  const assets = trpc.projects.assets.useQuery({ projectId: id });
  // 留言未讀數（餵 TocNav ③分鏡・交付 徽章）：15 秒輪詢已夠即時，同房夥伴留言另有 WS invalidate 立即刷新
  const unread = trpc.messages.unread.useQuery({ projectId: id }, { refetchInterval: 15000 });
  // 「從這裡開始」步驟列與三幕進度 hint 用：讀既有查詢判定（與子元件共用快取，不額外增負擔）
  const generations = trpc.generation.listByProject.useQuery({ projectId: id });
  const scenes = trpc.scenes.listByProject.useQuery({ projectId: id });
  // 上下文摘要條的計數查詢：key 與各子元件內部完全相同 → 共用快取，零額外請求
  const knowledge = trpc.knowledge.list.useQuery({ projectId: id });
  const characters = trpc.characters.list.useQuery({ projectId: id });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId: id });
  const propCards = trpc.props.list.useQuery({ projectId: id });
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
        document.getElementById("sec-characters")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  /** 引導步驟列收合偏好（per 專案持久化，重整後不會重新佔滿首屏）
   *  無偏好時：手機預設收合、桌機預設展開；已寫入 localStorage 的 "0"/"1" 一律尊重 */
  const onboardStorageKey = `aios.projectGuide.collapsed.${id}`;
  const [onboardCollapsed, setOnboardCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(onboardStorageKey);
      if (stored === "1") return true;
      if (stored === "0") return false;
      return typeof window !== "undefined" && !!window.matchMedia?.(PROJECT_MOBILE_MQ).matches;
    } catch {
      return false;
    }
  });
  const toggleOnboard = () => {
    setOnboardCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem(onboardStorageKey, next ? "1" : "0"); } catch { /* 偏好儲存失敗不影響操作 */ }
      return next;
    });
  };
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
  /** 展開 ① 對應分組／定裝 Tab（不捲動；捲動由呼叫端或 reveal 事件負責） */
  const expandContextForSelector = (target: string) => {
    const costume = costumeTabFromTarget(target);
    if (costume) setCostumeTab(costume);
    if (target === "#ctx-group-world" || target === "#ctx-group-sources" || target === "#ctx-group-manage") {
      setCtxGroupSectionOpen(target.replace("#ctx-group-", "") as CtxGroupKey, true);
      return;
    }
    if (target === "#sec-members") {
      setCtxGroupSectionOpen("manage", true);
      return;
    }
    if (target === "#stage-context") {
      setCtxGroupSectionOpen("world", true);
      return;
    }
    const key = targetToCtxKey(target);
    if (key) {
      setCtxGroupSectionOpen(sectionToGroup(key), true);
      setCtxSectionOpen(key, true);
      if (key === "characters" || key === "scenes" || key === "props") {
        setCostumePackOpen(true);
      }
    } else if (costume) {
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
  const orphansOf = (field: "themes" | "tones" | "styles", opts: string[]) =>
    options.data ? wv[field].filter((v) => !opts.includes(v)) : [];

  const isOwner = me.data?.user.id === p.ownerId;
  const canArchive = isOwner || isLeader;
  // 簡易／完整版：偏好存 localStorage（每個專案各自記），沒存過時看專案有沒有開始做（見 simpleMode.ts）
  const projectMode = projectModeOverride ?? resolveProjectMode(id, {
    sceneCount: scenes.data?.length ?? 0,
    generationCount: generations.data?.length ?? 0,
  });
  const setProjectModeAndPersist = (mode: ProjectMode) => {
    saveProjectMode(id, mode);
    setProjectModeOverride(mode);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
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
    revealWorkbenchAnchor("#sec-studio", { projectId: id });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById("gen-prompt") as HTMLTextAreaElement | null;
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    return true;
  };

  // C3.1：「從這裡開始」三步＝①②③ 同口徑（定調 → 創作 → 交付）
  const sceneCount = scenes.data?.length ?? 0;
  const onboardSteps = [
    {
      label: "① 定調",
      done: isWorldviewReady(wv),
      target: "#onboard-worldview",
      hint: "填一句「這支片在講什麼」＋挑氣氛或畫風（可抄範例）",
    },
    {
      label: "② 創作",
      done: !!generations.data?.some((g) => g.status === "done"),
      target: "#gen-prompt",
      hint: "到創作台「直接生成」做出第一張成品",
    },
    {
      label: "③ 交付",
      // 有分鏡即算進入交付站；送審通過是加分，不當「必須才打勾」以免卡在空旅程
      done: sceneCount > 0,
      target: "#stage-deliver",
      hint: "把成品排進分鏡，再送審／打包",
    },
  ];
  const allStepsDone = onboardSteps.every((s) => s.done);
  const completedStepCount = onboardSteps.filter((step) => step.done).length;
  const nextOnboardIndex = onboardSteps.findIndex((step) => !step.done);
  const projectJourneySteps: VisualJourneyStep[] = onboardSteps.map((step, index) => ({
    id: `onboard-step-${index + 1}`,
    label: step.label,
    detail: step.hint,
    state: step.done ? "done" : index === nextOnboardIndex ? "current" : "upcoming",
  }));

  // 三幕標頭與摘要條的進度數字：全讀頁面既有查詢，查詢還沒回來就不顯示
  const doneGenCount = generations.data?.filter((g) => g.status === "done").length;
  const pendingSceneCount = scenes.data?.filter((s) => s.status === "pending").length;
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
          <Hint layer="always" style={{ display: "block", marginTop: 6, fontSize: 12, color: "var(--warn, #b45309)" }}>
            已選 {selected.length} 個——{chipSoftMaxLabel[field]}
          </Hint>
        )}
      </div>
    );
  };

  /**
   * 視覺風格：媒材家族（互斥）→ 主風格（准單選）→ 同家族質感（可選 0～1）→ 自訂。
   * 固定顯示出圖摘要；舊多選／跨家族可一鍵收斂。
   */
  const stylePicker = (labelledBy: string) => {
    const slots = parseWorldviewStyleSlots(wv.styles);
    const inject = stylesForVisualInject(wv.styles);
    const activeFamily: StyleMediaFamily | null = styleFamilyTab ?? slots.family;
    const lookOpts = activeFamily ? looksForFamily(activeFamily) : [];
    const textureOpts = activeFamily ? texturesForFamily(activeFamily) : [];
    const customOpts = styleOpts.filter((s) => !STYLE_MEDIA_FAMILY[s]);
    const orphans = orphansOf("styles", styleOpts);
    const canonical = keepPrimaryWorldviewStyle(wv.styles);
    const dirty =
      wv.styles.length !== canonical.length || wv.styles.some((v, i) => v !== canonical[i]);

    return (
      <div role="group" aria-labelledby={labelledBy}>
        <Meta style={{ display: "block", marginBottom: 6, fontSize: 12 }}>媒材家族（互斥）</Meta>
        <div role="radiogroup" aria-label="媒材家族">
          {STYLE_FAMILY_ORDER.map((fam) => {
            const meta = STYLE_FAMILY_META[fam];
            const on = activeFamily === fam;
            return (
              <Chip
                key={fam}
                selected={on}
                role="radio"
                aria-checked={on}
                title={`${meta.label}：${meta.hint}`}
                onClick={() => pickStyleFamily(fam)}
              >
                {meta.label}
              </Chip>
            );
          })}
        </div>

        {activeFamily && (
          <>
            <Meta style={{ display: "block", marginTop: 10, marginBottom: 6, fontSize: 12 }}>
              主風格（{STYLE_FAMILY_META[activeFamily].label}・擇一）
            </Meta>
            {lookOpts.map((t) => {
              const on = slots.look === t;
              return (
                <Chip
                  key={t}
                  selected={on}
                  onClick={() => toggle("styles", t)}
                  title={on ? "目前主風格（再點取消全部風格）" : "設為主風格"}
                >
                  {on && (
                    <Meta as="span" style={{ marginRight: 4, fontSize: 11, fontWeight: 600, color: "var(--primary-ink)" }}>
                      主
                    </Meta>
                  )}
                  {t}
                </Chip>
              );
            })}
            {textureOpts.length > 0 && (
              <>
                <Meta style={{ display: "block", marginTop: 10, marginBottom: 6, fontSize: 12 }}>
                  質感（可選・與主風格同家族）
                </Meta>
                {textureOpts.map((t) => {
                  const on = slots.texture === t;
                  return (
                    <Chip
                      key={t}
                      selected={on}
                      onClick={() => toggle("styles", t)}
                      title={on ? "取消質感" : "加上質感（可與主風格並存注入）"}
                    >
                      {on && (
                        <Meta as="span" style={{ marginRight: 4, fontSize: 11, fontWeight: 600, color: "var(--primary-ink)" }}>
                          質感
                        </Meta>
                      )}
                      {t}
                    </Chip>
                  );
                })}
              </>
            )}
          </>
        )}

        {(customOpts.length > 0 || isLeader) && (
          <>
            <Meta style={{ display: "block", marginTop: 10, marginBottom: 6, fontSize: 12 }}>
              自訂風格（准單選・無家族映射）
            </Meta>
            {customOpts.map((t) => {
              const on = wv.styles.length === 1 && wv.styles[0] === t;
              return (
                <Chip
                  key={t}
                  selected={on}
                  onClick={() => toggle("styles", t)}
                  title={on ? "目前出圖風格（再點取消）" : "設為出圖風格（取代內建選擇）"}
                >
                  {on && (
                    <Meta as="span" style={{ marginRight: 4, fontSize: 11, fontWeight: 600, color: "var(--primary-ink)" }}>
                      出圖
                    </Meta>
                  )}
                  {t}
                </Chip>
              );
            })}
            {isLeader && canEdit && (
              <AddOptionChip groupId={p.groupId} type="style" onAdded={(label) => toggle("styles", label)} />
            )}
          </>
        )}

        {orphans.map((t) => (
          <Chip
            key={`orphan-style-${t}`}
            selected
            style={{ borderStyle: "dashed", opacity: 0.75 }}
            title="此選項已移出清單；點一下套用收斂規則或取消"
            onClick={() => toggle("styles", t)}
          >
            {t} <Icon name="Info" size={12} style={{ verticalAlign: "-2px" }} />
          </Chip>
        ))}

        <Meta style={{ display: "block", marginTop: 8, fontSize: 12 }} aria-live="polite">
          出圖風格：
          {inject.length ? (
            <strong>{formatWorldviewStylesLabel(inject)}</strong>
          ) : (
            "尚未設定"
          )}
          {slots.family ? ` · 媒材：${STYLE_FAMILY_META[slots.family].label}` : ""}
        </Meta>

        {canEdit && dirty && (
          <Meta style={{ display: "block", marginTop: 6, fontSize: 12 }}>
            資料需收斂——
            <button
              type="button"
              className="linkish"
              style={{
                marginLeft: 4,
                fontSize: 12,
                border: 0,
                background: "none",
                cursor: "pointer",
                color: "var(--primary-ink)",
                textDecoration: "underline",
                fontWeight: 600,
              }}
              onClick={keepPrimaryStyle}
            >
              一鍵只留「{formatWorldviewStylesLabel(canonical) || canonical[0] || "可注入項"}」
            </button>
          </Meta>
        )}

        {options.isLoading && !styleOpts.length && <Meta>載入中…</Meta>}
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
              {collab.peers.map((peer) => {
                const isMe = peer.userId === collab.self?.userId;
                const following = collabMode === "mirror" && followUserId === peer.userId;
                return (
                  <span
                    key={peer.userId}
                    role={!isMe ? "button" : undefined}
                    tabIndex={!isMe ? 0 : undefined}
                    title={
                      isMe
                        ? "你在這個專案裡"
                        : following
                          ? `正在鏡像跟隨 ${peer.name}（再點可取消）`
                          : `點一下以鏡像跟隨 ${peer.name}`
                    }
                    onClick={() => {
                      if (isMe) return;
                      if (following) {
                        setCollabMode("live");
                        setFollowUserId(null);
                      } else {
                        setCollabMode("mirror");
                        setFollowUserId(peer.userId);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (isMe) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).click();
                      }
                    }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 12, padding: "2px 10px", borderRadius: 999,
                      border: `1px solid ${peer.color}`, color: peer.color,
                      textShadow: "0 1px 2px var(--scrim)",
                      opacity: isMe ? 0.55 : 1,
                      cursor: isMe ? "default" : "pointer",
                      outline: following ? `2px solid ${peer.color}` : undefined,
                      outlineOffset: 2,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: peer.color }} />
                    {isMe ? "你" : peer.name}
                    {following ? " · 跟隨中" : ""}
                  </span>
                );
              })}
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
          <Hint layer="always" style={{ flexBasis: "100%", margin: "4px 0 0" }}>
            極限精準鏡像：錨點＋螢幕比例鎖定，巢狀捲動雙次校正（非螢幕串流）。
            可點「退出鏡像」或再點對方名字取消。
          </Hint>
        )}
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
        {p.format}・{p.platform}
        {wv.logline ? `・${wv.logline}` : ""}
      </p>
      {/* #25 常駐交付出口指引：桌機完整句；手機隱藏長句（③ 區內改一行短提示，見下方） */}
      {!mobileCompact && (
        <p
          className="project-delivery-link"
          role="button"
          tabIndex={0}
          onClick={() => scrollToSelector("#onboard-delivery")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); scrollToSelector("#onboard-delivery"); } }}
          style={{ marginTop: -4, marginBottom: 10, cursor: "pointer", fontSize: 13 }}
        >
          做好後可打包成 zip，媒體檔直接拖進剪映／Premiere 就能剪 <Icon name="ArrowRight" size={13} style={{ verticalAlign: "-2px" }} />
        </p>
      )}
      </header>
      {archiveProject.error && <p className="error">{archiveProject.error.message}</p>}

      {/*
        簡易／完整版切換（QA 2026-08-01）：整頁 20+ 區塊對新手是路障，但對熟手是工具。
        用切換而不是刪功能——簡易模式只是換一組畫面，底下呼叫的仍是同一批 procedure。
        還沒開始做的專案預設簡易；已有分鏡或生成紀錄的專案維持完整版（不打擾進行中的工作）。
      */}
      {projectMode === "simple" ? (
        <>
          <SimpleProjectMode
            projectId={id}
            groupId={p.groupId}
            canEdit={canEdit}
            worldview={wv}
            onSwitchToPro={() => setProjectModeAndPersist("pro")}
          />
          <div style={{ marginTop: 24 }}>
            <MessagePanel projectId={id} groupId={p.groupId} isLeader={isLeader} canEdit={canEdit} />
          </div>
        </>
      ) : (
      <>
      {/* 手機完整版：簡易入口要極明顯（M1-1）——不是藏在角落一顆 ghost 鈕 */}
      <Card
        as="div"
        data-fb="切到簡易模式"
        style={{
          marginBottom: 12,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          borderColor: "var(--primary-border, var(--border))",
          background: "var(--primary-tint)",
        }}
      >
        <span style={{ flex: "1 1 160px", fontSize: 13, lineHeight: 1.45 }}>
          <b>想快一點？</b>用簡易模式四步做完一支片（故事→分鏡→出圖→送審），完整工具隨時可切回來。
        </span>
        <Button size="sm" variant="primary" onClick={() => setProjectModeAndPersist("simple")}>
          切成簡易模式
        </Button>
      </Card>

      {/* 2.3 唯讀橫幅：檢視者第一眼就知道自己是唯讀＋能做什麼＋找誰解鎖（不是「系統一直壞」） */}
      {!canEdit && (
        <Card
          role="status"
          data-fb="唯讀橫幅"
          style={{ padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Icon name="Lock" size={15} style={{ flexShrink: 0, color: "var(--primary-ink)" }} />
          <span style={{ fontSize: 13 }}>
            你在此專案是<b>檢視者（唯讀）</b>——可以瀏覽、留言、下載交付；要編輯或生成，請組長到「① 定調」底部的成員權限把你改成編輯者。
          </span>
        </Card>
      )}

      {/* #9 「從這裡開始」步驟列：用實際 state 判定完成打勾，點某步捲到對應區塊 */}
      <Card as="section" className="project-guide" data-fb="從這裡開始">
        <div className="project-guide__head">
          <h2 style={{ margin: 0 }}>從這裡開始</h2>
          <HelpTip text="三步對齊頁面三幕：定調 → 創作 → 交付。做到哪一步會自動打勾，點步驟可跳到對應區塊。" />
          <span style={{ flex: "1 1 auto" }} />
          <span className="project-guide__progress" aria-label={`已完成 ${completedStepCount}／${onboardSteps.length} 步`}>
            <span className="project-guide__progress-track" aria-hidden>
              <span style={{ width: `${(completedStepCount / onboardSteps.length) * 100}%` }} />
            </span>
            {completedStepCount}/{onboardSteps.length}
          </span>
          {allStepsDone && <Chip style={{ fontSize: 12 }}>全部完成</Chip>}
          <Button size="sm"
            onClick={toggleOnboard}
            aria-expanded={!onboardCollapsed}
            aria-controls="project-getting-started-steps">
            {onboardCollapsed ? "展開" : "收合"}
          </Button>
        </div>
        {!onboardCollapsed && (
          <div id="project-getting-started-steps">
            <VisualJourney
              steps={projectJourneySteps}
              ariaLabel="專案製作進度"
              compact
              onSelect={(_, index) => {
                const step = onboardSteps[index];
                if (!step) return;
                // Workbench anchors (#gen-prompt / #sec-studio / …) must switch mode first.
                if (step.target === "#gen-prompt" || step.target === "#sec-studio" || step.target === "#sec-agent" || step.target === "#sec-assistant") {
                  revealWorkbenchAnchor(step.target, { projectId: id });
                } else if (step.target === "#onboard-worldview" || step.target === "#stage-context") {
                  // C3：展開 ① 再捲，避免只 scroll 到收合區塊
                  revealProjectContext("worldview", { projectId: id });
                } else {
                  scrollToSelector(step.target);
                }
              }}
            />
            {!allStepsDone && nextOnboardIndex >= 0 && (
              <p className="project-guide__next">
                下一步：<b>{onboardSteps[nextOnboardIndex]?.label}</b>・{onboardSteps[nextOnboardIndex]?.hint}
              </p>
            )}
          </div>
        )}
        {/* 收合時仍留下一步一行，避免新手不知道下一步（手機預設收合尤為重要） */}
        {onboardCollapsed && !allStepsDone && nextOnboardIndex >= 0 && (
          <p className="project-guide__next project-guide__next--collapsed">
            下一步：<b>{onboardSteps[nextOnboardIndex]?.label}</b>・{onboardSteps[nextOnboardIndex]?.hint}
          </p>
        )}
      </Card>

      {/* #28 章節導覽：三幕錨點（上下文 → 工作台 → 交付）；② 只跳 #stage-create，不列各模式。
          ③ 帶留言未讀徽章（@N 表示有人提及）。 */}
      <div className="toc-layout">
      <TocNav
        items={TOC_DEFAULT_ITEMS.map((it) =>
          it.id === "stage-deliver" && unread.data && unread.data.count > 0
            ? {
                ...it,
                badge: unread.data.mentioned
                  ? `@${Math.min(unread.data.count, 99)}`
                  : String(Math.min(unread.data.count, 99)),
              }
            : it,
        )}
      />
      <div className="cols">
        <div className="stack">
          {/* ① 定調：世界觀・定裝・知識庫・素材——AI 的共同大腦 */}
          <StageHead
            id="stage-context"
            num="①"
            title="定調"
            desc="世界觀與定裝——基本設定、角色／場景／道具、知識與素材"
            accent="group-1"
            hint={wvReady ? "已設定" : "待設定"}
          />
          {/* 總覽卡：狀態一句話 + chip 直達；底下只剩兩大分組，不再平鋪一長串 */}
          <div className="ctx-overview" role="region" aria-label="專案上下文一覽">
            <div className="ctx-overview__head">
              <strong className="ctx-overview__title">專案大腦一覽</strong>
              <Meta>
                {wvReady
                  ? "基本設定就緒——下方兩區會自動注入每次生成"
                  : "先補「這支片長什麼樣」的基本設定，後面生成才穩"}
              </Meta>
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

          {/* ── 分組 A：世界與角色（基調 + 定裝三卡） ── */}
          <CtxGroup
            groupId="ctx-group-world"
            title="這支片長什麼樣"
            lede="先講清楚這支片在說什麼、看起來像什麼，再把角色／場景／道具的樣子定下來——每次生成 AI 都會自動帶上，你不用重講。"
            meta={[
              wvReady ? "設定✓" : "設定待補",
              ...(charCount != null ? [`角${charCount}`] : []),
              ...(presetCount != null ? [`景${presetCount}`] : []),
              ...(propCount != null ? [`道${propCount}`] : []),
            ].join(" · ")}
            compact={mobileCompact}
            open={ctxGroupOpen.world}
            onOpenChange={(o) => setCtxGroupSectionOpen("world", o)}
          >
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
            {!canEdit && <Hint layer="always" style={{ margin: "4px 0 0" }}>檢視者唯讀——這些設定可以看，不能改（打的字不會被儲存）。</Hint>}
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
                      const el = document.getElementById("wv-logline") as HTMLInputElement | null;
                      el?.focus();
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
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
                    // 就緒後主 CTA：進創作台直接出圖
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
                  // C3.2：一鍵套用範例 → 創作台（optimistic 先寫入再 reveal）
                  updateWv.mutate({ id, worldview: patch });
                  revealWorkbenchAnchor("#sec-studio", { projectId: id });
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      const el = document.getElementById("gen-prompt") as HTMLTextAreaElement | null;
                      el?.focus({ preventScroll: true });
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    });
                  });
                }}
                onDismiss={dismissWvExample}
              />
            )}
            {/* 引導鋪軌：只讀 wv、不持有任何欄位值——它若緩衝草稿就會撞爛下面的
                key 重掛 + onBlur 部分 patch（協作靠那組機制才不會互相覆蓋）。 */}
            <WorldviewGuide
              wv={wv}
              onJump={(anchor, stepId) => {
                // 第四步／故事走向在進階摺疊層裡，捲過去之前得先把它撐開
                if (stepId === "narrative") setWvAdvancedOpen(true);
                scrollToSelector(anchor);
              }}
            />
            {/* C0 主路徑：會進生成的最少欄位——一句話／訊息、氣氛、畫風、禁忌；其餘進 details */}
            <label htmlFor="wv-logline">
              這支片在講什麼？
              <FieldReaders field="logline" />
              <HelpTip text="一句話就好。會截成 80 字接在每次出圖的提示詞後面。" />
            </label>
            {/* key 綁伺服器值：協作者改動（WS invalidate 重抓）時強制重掛吃進新值——
                非受控 defaultValue 否則永遠停在舊字，focus+blur 還會把舊值回寫、蓋掉別人的修改。
                maxLength 與後端 worldviewSchema .max(500) 對齊，貼超長不再靜默存失敗。 */}
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
              氣氛
              <FieldReaders field="tones" />
              <HelpTip text="畫面給人的感覺。挑 1～2 個合得來的（如溫暖＋真誠）。第一個為主；出圖只取前 2 個。點「設主要」可改優先序。" />
            </label>
            {chipGroup("tones", toneOpts, "tone", "wv-tones")}
            <label id="wv-styles">
              畫風
              <FieldReaders field="styles" />
              <Meta as="span" style={{ marginLeft: 6, fontSize: 12, fontWeight: 400 }}>每張圖看起來像什麼——這一項最有效</Meta>
              <HelpTip text="先選畫法（寫實／插畫／3D），再選一個主風格；同家族可加一個質感（如膠片）。跨畫法不會混進同一張圖。" />
            </label>
            {stylePicker("wv-styles")}
            {wvChipWarnings.length > 0 && (
              <Hint layer="always" role="status" style={{ marginTop: 8, fontSize: 12, color: "var(--warn, #b45309)" }}>
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
                <Hint layer="always" style={{ marginBottom: 12, fontSize: 12 }}>
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

                  <label style={{ marginTop: 8, display: "block" }}>
                    故事三段
                    <FieldReaders field="acts" />
                    <HelpTip text="敘事骨架。進助手／文字生成／導演；不進圖影。" />
                  </label>
                  {([
                    ["hook", "開頭怎麼抓住人", "例：第一個抓住人的畫面或處境"],
                    ["turn", "中間怎麼轉", "例：心或局面怎麼轉"],
                    ["cta", "最後希望觀眾做什麼", "例：希望觀眾帶走什麼／做什麼"],
                  ] as const).map(([field, label, ph]) => (
                    <input
                      key={`${field}-${wv.acts[field]}`}
                      aria-label={`三幕結構：${label}`}
                      defaultValue={wv.acts[field]}
                      readOnly={!canEdit}
                      maxLength={500}
                      placeholder={`${label}——${ph}`}
                      style={{ marginTop: 6 }}
                      onBlur={(e) =>
                        canEdit && e.target.value !== wv.acts[field] &&
                        updateWv.mutate({ id, worldview: { acts: { ...wv.acts, [field]: e.target.value } } })
                      }
                    />
                  ))}

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
                                    requestAnimationFrame(() => {
                                      document.getElementById("sec-characters")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
                    <Hint layer="always" style={{ marginTop: 6, fontSize: 12, color: "var(--warn, #b45309)" }}>
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

          {/* C1：角色／場景／道具合一「定裝」Tab。錨點 #sec-characters|scenes|props 掛 tabpanel。
              手機：整包 CtxCollapse 預設收合；桌機直接展開。 */}
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
          </CtxGroup>

          {/* ── 分組 B：依據與素材（知識庫／資料表／素材庫） ── */}
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
          {/* 專案知識庫：AI 讀得懂上傳的開示/見證/腳本（願景核心「真的懂我們」） */}
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
                    revealWorkbenchAnchor("#sec-studio", { projectId: id });
                  }}
                />
              </CtxCollapse>
            </div>
          </CollabZone>
          </CtxGroup>

          {/* ── 分組 C：管理（回收桶／權限）——降級到最底，預設收合 ── */}
          <CtxGroup
            groupId="ctx-group-manage"
            title="管理"
            lede="回收桶與成員權限——非日常創作流程，需要時再開"
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

          <Card as="details" variant="quiet" className="ctx-manage" data-fb="專案權限收合卡" id="sec-members">
            <summary>
              <Icon name="Lock" size={14} />成員權限（預設全員可編輯；可設個別成員唯讀）
              <Icon name="ChevronDown" size={14} style={{ marginLeft: "auto" }} />
            </summary>
            <div style={{ marginTop: 10 }}>
              <ProjectMembersCard projectId={id} bare />
            </div>
          </Card>
          </CtxGroup>

          <StageLink text="以上兩區會自動注入下方每一次生成——AI 全程記得，不必重講背景" />

          {/* ② 創作：唯一 AI 入口 CreationWorkbench；不掛平行整頁卡 */}
          <StageHead
            id="stage-create"
            num="②"
            title="創作"
            desc="問 AI・生成・範本・計畫 — 同一入口"
            accent="group-2"
            hint={doneGenCount != null ? `已完成 ${doneGenCount} 次生成` : undefined}
          />
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

          <StageLink text="成品進素材庫；生成紀錄可「＋加入分鏡」" />

          {/* ③ 交付：分鏡・排片・送審・打包（SceneList 一體卡） */}
          <StageHead
            id="stage-deliver"
            num="③"
            title="交付"
            desc="分鏡・排片・送審・打包"
            accent="group-3"
            hint={pendingSceneCount != null ? `分鏡 ${sceneCount}・待審 ${pendingSceneCount}` : undefined}
          />
          {/* 手機：首屏長句交付導引改放 ③ 區一行，減少首屏噪音 */}
          {mobileCompact && (
            <p
              className="project-delivery-link project-delivery-link--stage"
              role="button"
              tabIndex={0}
              onClick={() => scrollToSelector("#onboard-delivery")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); scrollToSelector("#onboard-delivery"); } }}
            >
              做好可打包 zip 交付 <Icon name="ArrowRight" size={13} style={{ verticalAlign: "-2px" }} />
            </p>
          )}
          <CollabZone {...zoneProps(COLLAB_ZONES.scenes)}>
            {/* data-fb 讓元件回饋標定「打包下載」（分鏡與交付區）；透明包裹，不影響版面。id 供引導步驟與交付指引捲動定位 */}
            {/* 錨點 id 掛外層 div、不再加外層 <h2>（SceneList 卡片自帶同名標題，白話提示移進去了） */}
            <div data-fb="打包下載" id="onboard-delivery">
              {/* charIds/sceneIds：逐鏡就地生成也注入生成台勾選的角色/場景錨點——逐鏡出圖與生成台出圖同一套畫風 */}
              <SceneList projectId={id} isLeader={isLeader} canEdit={canEdit} charIds={charIds} sceneIds={sceneIds} propIds={propIds} projectTitle={project.data?.title} />
            </div>
          </CollabZone>
        </div>

        {/* 組內留言：桌機側欄；手機改 FAB → bottom sheet（不進主長流，避免佔捲動高度）。
            id 供 ?focus=messages 通知深連結捲動定位——這個錨點已被平行 PR 弄丟兩次
            （#246、#251），approvals.deeplink.test.ts 的守衛就是為此而存在，別再拿掉。 */}
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
      </>
      )}
    </div>
  );
}
