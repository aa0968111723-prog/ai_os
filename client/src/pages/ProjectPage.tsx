import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmButton, HelpTip } from "../components/interactions";
import { worldviewSchema, type Worldview } from "@shared/worldview";
import { SceneList } from "../components/SceneList";
import { MessagePanel } from "../components/MessagePanel";
import { AssetLibrary } from "../components/AssetLibrary";
import { RecycleBin } from "../components/RecycleBin";
import { KnowledgeBase } from "../components/KnowledgeBase";
import { CharacterCards } from "../components/CharacterCards";
import { ScenePresetCards } from "../components/ScenePresetCards";
import { DEFAULT_ITEMS as TOC_DEFAULT_ITEMS, TocNav } from "../components/TocNav";
import { CreationWorkbench } from "../features/creation-workbench/CreationWorkbench";
import { loadDraft } from "../features/creation-workbench/creationDraft";
import {
  type DirectGenerateApplyRequest,
} from "../features/creation-workbench/modes/DirectGenerateMode";
import { projectCanEdit } from "../features/creation-workbench/generationGates";
import { revealWorkbenchAnchor, scrollToSelector } from "../features/creation-workbench/workbenchNav";
import { ProjectMembersCard } from "../components/ProjectMembersCard";
import { ProjectDatabasesCard } from "../components/ProjectDatabasesCard";
import { VisualJourney, type VisualJourneyStep } from "../components/VisualJourney";
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

function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

type CtxSectionKey = "characters" | "scenes" | "knowledge" | "databases" | "assets" | "recycle";

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
  onChange,
}: {
  id: string;
  label: string;
  values: string[];
  placeholder: string;
  readOnly: boolean;
  hint?: string;
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
      <label id={`${id}-label`}>{label}{hint && <HelpTip text={hint} />}</label>
      <div role="group" aria-labelledby={`${id}-label`}>
        {values.map((v) => (
          <Chip key={v} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {v}
            {!readOnly && (
              <button
                type="button"
                aria-label={`移除「${v}」`}
                title="移除"
                onClick={() => onChange(values.filter((x) => x !== v))}
                style={{ padding: 0, border: "none", background: "none", boxShadow: "none", display: "inline-flex", cursor: "pointer", color: "inherit" }}
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
 * ③ 分鏡・時間軸・交付＝成品落地（SceneList）。
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
  useCollabMirrorFollow(collabMode, followUserId, collab.cursors, collab.focusZones);
  const followZone = followUserId && collabMode === "mirror" ? zoneOfPeer(followUserId, collab.focusZones) : null;
  /** UX-M1：≤820px 手機減負（收合上下文、留言 sheet）；桌機 ≥821 行為不變 */
  const mobileCompact = useMatchMedia(PROJECT_MOBILE_MQ);
  const [presenceExpanded, setPresenceExpanded] = useState(false);
  const [messagesSheetOpen, setMessagesSheetOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState<Record<CtxSectionKey, boolean>>({
    characters: false,
    scenes: false,
    knowledge: false,
    databases: false,
    assets: false,
    recycle: false,
  });
  const setCtxSectionOpen = (key: CtxSectionKey, open: boolean) =>
    setCtxOpen((prev) => (prev[key] === open ? prev : { ...prev, [key]: open }));
  // Escape 關閉留言 sheet
  useEffect(() => {
    if (!messagesSheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMessagesSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [messagesSheetOpen]);
  const me = trpc.auth.me.useQuery();
  // 世界觀三組 chips（主軸／調性／視覺風格）由本專案所屬組的自訂選項供給（組長可就地新增，或到「選項」頁整理）
  const options = trpc.options.byGroup.useQuery(
    { groupId: project.data?.groupId ?? "" },
    { enabled: !!project.data?.groupId },
  );
  /** 世界觀儲存回饋：成功後短暫顯示「已儲存 ✓」再淡出 */
  const [wvSaved, setWvSaved] = useState<"idle" | "shown" | "fading">("idle");
  const wvTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => wvTimers.current.forEach(clearTimeout), []);
  const updateWv = trpc.projects.updateWorldview.useMutation({
    // 樂觀更新：patch 先合併進本地快取，快速連點兩個 chips 時第二下才讀得到第一下的結果
    //（否則第二下用 stale 快取算出「整條陣列」，後端合併後把第一下剛存的值蓋掉）
    onMutate: async ({ worldview }) => {
      await utils.projects.get.cancel({ id });
      utils.projects.get.setData({ id }, (old) =>
        old ? { ...old, worldview: { ...worldviewSchema.parse(old.worldview ?? {}), ...worldview } } : old,
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
  const toggleChar = (cid: string) => setCharIds((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));
  /** 生成時要帶入的場景設定卡（色板/光線一致）——持久化，重整不歸零 */
  const [sceneIds, setSceneIds] = usePersistedIds(`aios.pick.scenes.${id}`);
  const toggleScene = (sid: string) => setSceneIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
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
  // 勾選持久化的清理：清單載入後移除已被刪除的角色/場景 id（沒變就不 set，避免每次 refetch 都重渲染）
  useEffect(() => {
    const list = characters.data;
    if (!list) return;
    setCharIds((prev) => {
      const next = prev.filter((cid) => list.some((c) => c.id === cid));
      return next.length === prev.length ? prev : next;
    });
    // setCharIds 是穩定的 setState 包裝，不入依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters.data]);
  useEffect(() => {
    const list = scenePresets.data;
    if (!list) return;
    setSceneIds((prev) => {
      const next = prev.filter((sid) => list.some((s) => s.id === sid));
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenePresets.data]);
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
  const archiveProject = trpc.projects.setArchived.useMutation({
    onSuccess: () => { utils.projects.get.invalidate({ id }); utils.projects.list.invalidate(); },
  });

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
  const wv: Worldview = worldviewSchema.parse(p.worldview ?? {});
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
    settings?: { modelId?: string | null; characterIds?: string[] | null; scenePresetIds?: string[] | null; sourceAssetId?: string | null },
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

  // 「從這裡開始」四步：用實際 state 判定完成打勾
  const sceneCount = scenes.data?.length ?? 0;
  const onboardSteps = [
    { label: "設世界觀", done: !!(wv.logline.trim() || wv.message.trim()), target: "#onboard-worldview", hint: "填一句故事或關鍵訊息" },
    { label: "生成一鏡", done: !!generations.data?.some((g) => g.status === "done"), target: "#gen-prompt", hint: "在 AI 創作工作台的「直接生成」做出第一張成品" },
    { label: "加入分鏡", done: sceneCount > 0, target: "#onboard-delivery", hint: "把成品排進分鏡" },
    // 第4步用「有分鏡通過審核」當完成訊號，才不會一有分鏡就跟第3步一起打勾（誤導已交付）
    { label: "送審／打包", done: !!scenes.data?.some((s) => s.status === "approved"), target: "#onboard-delivery", hint: "送審通過後即可打包交付" },
  ];
  const allStepsDone = onboardSteps.every((s) => s.done);
  const completedStepCount = onboardSteps.filter((step) => step.done).length;
  const nextOnboardIndex = onboardSteps.findIndex((step) => !step.done);
  const projectJourneySteps: VisualJourneyStep[] = onboardSteps.map((step, index) => ({
    id: step.target,
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
  const assetCount = assets.data?.length;
  const wvReady = !!(wv.logline.trim() || wv.message.trim());

  const toggle = (field: "tones" | "themes" | "styles", value: string) => {
    if (!canEdit) return; // 檢視者：chips 不可切換（樂觀更新會先亮再彈回，比不動更誤導）
    const current = wv[field];
    const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
    // 只送有改的欄位；伺服器與現值合併（避免整包覆蓋造成的資料遺失）
    updateWv.mutate({ id, worldview: { [field]: next } });
  };

  /** 編輯指示：把某區塊接上協作狀態（誰在這裡→內框＋標籤）；鏡像時被跟隨者焦點區加粗 */
  const zoneProps = (zone: string) => ({
    zone,
    watchers: collab.focusZones[zone] ?? [],
    sendFocus: collab.sendFocus,
    mirrorActive: followZone === zone,
  });

  /** 世界觀 chips 群組（主軸／調性／風格共用）：既有選項＋孤兒值＋組長就地「＋新增」 */
  const chipGroup = (field: "themes" | "tones" | "styles", opts: string[], optType: "theme" | "tone" | "style", labelledBy: string) => (
    <div role="group" aria-labelledby={labelledBy}>
      {options.isLoading && !opts.length && <Meta>載入中…</Meta>}
      {opts.map((t) => {
        const on = wv[field].includes(t);
        return (
          <Chip key={t} selected={on} onClick={() => toggle(field, t)}>
            {t}
          </Chip>
        );
      })}
      {orphansOf(field, opts).map((t) => (
        <Chip key={t} selected
          style={{ borderStyle: "dashed", opacity: 0.75 }}
          title="這個選項已被移出清單，點一下可從本專案移除"
          onClick={() => toggle(field, t)}>
          {t} <Icon name="Info" size={12} style={{ verticalAlign: "-2px" }} />
        </Chip>
      ))}
      {/* 選項就地新增：組長直接在工作台加，不必繞去「選項」選單頁（加完自動勾上） */}
      {isLeader && canEdit && (
        <AddOptionChip groupId={p.groupId} type={optType} onAdded={(label) => toggle(field, label)} />
      )}
    </div>
  );

  /** 摘要 chip → 目標 section：手機時先展開收合卡再捲動 */
  const targetToCtxKey = (target: string): CtxSectionKey | null => {
    if (target === "#sec-characters") return "characters";
    if (target === "#sec-scenes") return "scenes";
    if (target === "#sec-knowledge") return "knowledge";
    if (target === "#sec-databases") return "databases";
    if (target === "#sec-assets") return "assets";
    if (target === "#sec-recyclebin") return "recycle";
    return null;
  };
  const jumpToContext = (target: string) => {
    const key = targetToCtxKey(target);
    if (mobileCompact && key) setCtxSectionOpen(key, true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToSelector(target));
    });
  };

  /** 上下文摘要條的一顆 chip：顯示計數、點了捲到對應卡（手機一併展開） */
  const summaryChip = (label: string, target: string, on = false) => (
    // on 表示「那一區已有內容」而非按下狀態，故蓋掉 Chip 預設補的 aria-pressed
    <Chip selected={on} aria-pressed={undefined} onClick={() => jumpToContext(target)}>
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
            鏡像跟隨中：畫面會跟著對方的焦點區與游標捲動（不是螢幕串流；雙方版面不同時以卡片錨點對位）。
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

      {/* 2.3 唯讀橫幅：檢視者第一眼就知道自己是唯讀＋能做什麼＋找誰解鎖（不是「系統一直壞」） */}
      {!canEdit && (
        <Card
          role="status"
          data-fb="唯讀橫幅"
          style={{ padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Icon name="Lock" size={15} style={{ flexShrink: 0, color: "var(--primary-ink)" }} />
          <span style={{ fontSize: 13 }}>
            你在此專案是<b>檢視者（唯讀）</b>——可以瀏覽、留言、下載交付；要編輯或生成，請組長到「① 專案上下文」底部的成員權限把你改成編輯者。
          </span>
        </Card>
      )}

      {/* #9 「從這裡開始」步驟列：用實際 state 判定完成打勾，點某步捲到對應區塊 */}
      <Card as="section" className="project-guide" data-fb="從這裡開始">
        <div className="project-guide__head">
          <h2 style={{ margin: 0 }}>從這裡開始</h2>
          <HelpTip text="這是製作一支片的四個步驟。做到哪一步會自動打勾，點步驟可跳到對應區塊。" />
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
          {/* ① 專案上下文：定裝・素材・腳本・知識庫一體，AI 的共同大腦 */}
          <StageHead
            id="stage-context"
            num="①"
            title="專案上下文"
            desc="世界觀・定裝・素材・知識庫——AI 的共同大腦"
            accent="group-1"
            hint={wvReady ? "已設定" : "待設定"}
          />
          {/* 上下文摘要條：一眼看見 AI 全程共用哪些設定；點 chip 直達對應卡 */}
          <div className="ctx-summary" role="group" aria-label="AI 全程共用的上下文一覽">
            AI 全程共用：
            {summaryChip(`專案基調${wvReady ? " ✓" : "（待設定）"}`, "#onboard-worldview", wvReady)}
            {summaryChip(`角色 ${charCount ?? "…"}・場景 ${presetCount ?? "…"}`, "#sec-characters")}
            {summaryChip(`知識 ${knowledgeCount ?? "…"} 份`, "#sec-knowledge")}
            {summaryChip(`素材 ${assetCount ?? "…"}`, "#sec-assets")}
          </div>
          {/* 世界觀（快速層） */}
          <CollabZone {...zoneProps(COLLAB_ZONES.worldview)}>
          <Card as="section" data-fb="世界觀卡" id="onboard-worldview">
            <h2>
              專案基調與世界觀
              <HelpTip text="這支片的固定設定，填一次，之後每次生成 AI 自動記得，不用重講背景。" />
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
            {!canEdit && <Hint layer="always" style={{ margin: "4px 0 0" }}>檢視者唯讀——世界觀可瀏覽、不能修改（打的字不會被儲存）。</Hint>}
            <label htmlFor="wv-logline">一句話故事（logline）</label>
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
            <label htmlFor="wv-message">一句關鍵訊息（一片一訊息）</label>
            <input
              key={`message-${wv.message}`}
              id="wv-message"
              defaultValue={wv.message}
              readOnly={!canEdit}
              maxLength={500}
              placeholder="例：把心交給佛，煩惱就交給了光"
              onBlur={(e) => canEdit && e.target.value !== wv.message && updateWv.mutate({ id, worldview: { message: e.target.value } })}
            />
            <label id="wv-themes">訊息主軸</label>
            {chipGroup("themes", themeOpts, "theme", "wv-themes")}
            <label id="wv-tones">調性（生成時自動注入）<HelpTip text="語氣與畫風，會自動加進每次生成的提示詞。" /></label>
            {chipGroup("tones", toneOpts, "tone", "wv-tones")}
            <label id="wv-styles">視覺風格（畫面一致的關鍵，生成時自動注入）<HelpTip text="語氣與畫風，會自動加進每次生成的提示詞。" /></label>
            {chipGroup("styles", styleOpts, "style", "wv-styles")}
            {isLeader && (
              <Hint style={{ marginTop: 8, fontSize: 12 }}>
                選項可直接按各列的「＋新增」加；改名／停用／排序在 <Link href="/options">選項整理頁</Link>。
              </Hint>
            )}
            {/* 進階層全面可編輯（深度優化：後端 updateWorldview 早支援 partial patch，前端不再唯讀）——
                目標觀眾/三幕結構供 AI 導演參考；禁忌事項會自動注入每次生成 */}
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 13 }}>進階設定（目標觀眾・三幕結構・人物・參考・禁忌）</summary>
              <div style={{ marginTop: 6 }}>
                <label htmlFor="wv-audience">目標觀眾（供 AI 導演參考）</label>
                <input
                  key={`audience-${wv.audience}`}
                  id="wv-audience"
                  defaultValue={wv.audience}
                  readOnly={!canEdit}
                  maxLength={500}
                  placeholder="例：初次接觸禪修、想在忙碌生活裡找安定的年輕人與家庭"
                  onBlur={(e) => canEdit && e.target.value !== wv.audience && updateWv.mutate({ id, worldview: { audience: e.target.value } })}
                />
                <label>三幕結構（鉤子 → 轉折 → 行動呼籲）<HelpTip text="片子的敘事骨架：開場怎麼抓住人、中段怎麼轉、結尾請觀眾做什麼。供 AI 導演發想分鏡時參考。" /></label>
                {([
                  ["hook", "鉤子", "例：清晨禪堂前庭，安倢撐著紅傘走進柔和晨光"],
                  ["turn", "轉折", "例：慕恩在書架旁翻閱善本，浮躁被慢慢安放"],
                  ["cta", "行動呼籲", "例：把心交給佛，留白處給觀眾一個字卡的位置"],
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
                      // acts 是巢狀物件，partial patch 是淺合併——要送完整 acts，只改這一欄
                      updateWv.mutate({ id, worldview: { acts: { ...wv.acts, [field]: e.target.value } } })
                    }
                  />
                ))}
                <TokenListEditor
                  id="wv-people"
                  label="人物（供 AI 導演參考）"
                  values={wv.people}
                  placeholder="例：安倢＝紅傘、米白外套（Enter 加入）"
                  readOnly={!canEdit}
                  onChange={(next) => updateWv.mutate({ id, worldview: { people: next } })}
                />
                <TokenListEditor
                  id="wv-references"
                  label="參考連結"
                  values={wv.references}
                  placeholder="貼上參考影片/文章網址（Enter 加入）"
                  readOnly={!canEdit}
                  onChange={(next) => updateWv.mutate({ id, worldview: { references: next } })}
                />
                <TokenListEditor
                  id="wv-taboos"
                  label="禁忌事項（自動注入每次生成）"
                  hint="這裡的每一條都會加進生成提示詞，要求 AI 避開；刪除前請與組長確認。"
                  values={wv.taboos}
                  placeholder="例：不得出現可讀文字、招牌一律後製（Enter 加入）"
                  readOnly={!canEdit}
                  onChange={(next) => updateWv.mutate({ id, worldview: { taboos: next } })}
                />
                <Hint style={{ marginTop: 8, fontSize: 12 }}>
                  視覺風格與禁忌事項會自動注入每次生成的提示詞；其他欄位供 AI 導演與團隊參考。
                </Hint>
              </div>
            </details>
            {updateWv.error && <p className="error">世界觀儲存失敗：{updateWv.error.message}</p>}
          </Card>
          </CollabZone>

          {/* 角色定裝卡：勾選後生成自動注入外觀錨點。
              手機預設收合（CtxCollapse）；桌機維持全展開。錨點 id 掛外層供摘要 chip 捲動。 */}
          <CtxCollapse
            compact={mobileCompact}
            sectionId="sec-characters"
            title="角色定裝"
            meta={charCount != null ? `${charCount} 張` : undefined}
            open={ctxOpen.characters}
            onOpenChange={(o) => setCtxSectionOpen("characters", o)}
          >
            <CharacterCards projectId={id} selectedIds={charIds} onToggle={toggleChar} />
          </CtxCollapse>

          {/* 場景設定卡：勾選後生成自動注入色板/光線錨點 */}
          <CtxCollapse
            compact={mobileCompact}
            sectionId="sec-scenes"
            title="場景設定"
            meta={presetCount != null ? `${presetCount} 張` : undefined}
            open={ctxOpen.scenes}
            onOpenChange={(o) => setCtxSectionOpen("scenes", o)}
          >
            <ScenePresetCards projectId={id} selectedIds={sceneIds} onToggle={toggleScene} readOnly={!canEdit} />
          </CtxCollapse>

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

          {/* 回收桶：元件本身預設收合；手機再包一層摘要列，桌機維持原樣 */}
          <CtxCollapse
            compact={mobileCompact}
            sectionId="sec-recyclebin"
            title="回收桶"
            open={ctxOpen.recycle}
            onOpenChange={(o) => setCtxSectionOpen("recycle", o)}
          >
            <RecycleBin projectId={id} />
          </CtxCollapse>

          {/* 專案權限（需求 2.3）：誰可編輯、誰唯讀——屬專案設定的一環，但非日常操作，收合呈現不佔主視線 */}
          <Card as="details" variant="quiet" data-fb="專案權限收合卡" id="sec-members">
            <summary>
              <Icon name="Lock" size={14} />成員權限（預設全員可編輯；可設個別成員唯讀）
              <Icon name="ChevronDown" size={14} style={{ marginLeft: "auto" }} />
            </summary>
            <div style={{ marginTop: 10 }}>
              <ProjectMembersCard projectId={id} bare />
            </div>
          </Card>

          <StageLink text="以上設定會自動注入下方每一次生成——AI 全程記得，不必重講背景" />

          {/* ② 唯一 AI 創作入口：CreationWorkbench（四模式 tabs + 資源抽屜）；不掛平行整頁卡 */}
          <StageHead
            id="stage-create"
            num="②"
            title="AI 創作中心"
            desc="問 AI・直接生成・製作範本・執行計畫——同一工作台切換"
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
            worldview={{ tones: wv.tones, styles: wv.styles, taboos: wv.taboos }}
            wvReady={wvReady}
            characterIds={charIds}
            scenePresetIds={sceneIds}
            generateApplyRequest={generateApply}
            onReuseGenerate={applyPrompt}
            onGenerateSourceChange={setSourceHighlightId}
            studioCollab={zoneProps(COLLAB_ZONES.studio)}
          />

          <StageLink text="成品會自動存入素材庫；在工作台資源抽屜的生成紀錄按「＋加入分鏡」，就會排進下方分鏡列" />

          {/* ③ 分鏡・時間軸・交付：排片、粗剪預覽、送審與打包（SceneList 一體卡全含） */}
          <StageHead
            id="stage-deliver"
            num="③"
            title="分鏡・時間軸・交付"
            desc="排片・粗剪預覽・送審・打包"
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
              <SceneList projectId={id} isLeader={isLeader} canEdit={canEdit} onUsePrompt={applyPrompt} charIds={charIds} sceneIds={sceneIds} />
            </div>
          </CollabZone>
        </div>

        {/* 組內留言：桌機側欄；手機改 FAB → bottom sheet（不進主長流，避免佔捲動高度） */}
        {!mobileCompact && (
          <CollabZone {...zoneProps(COLLAB_ZONES.messages)}>
            <MessagePanel projectId={id} groupId={p.groupId} isLeader={isLeader} canEdit={canEdit} />
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
