import { useEffect, useRef, useState } from "react";
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
import { PromptLibrary } from "../components/PromptLibrary";
import { TocNav } from "../components/TocNav";
import { CreationWorkbench } from "../features/creation-workbench/CreationWorkbench";
import { loadDraft } from "../features/creation-workbench/creationDraft";
import {
  type DirectGenerateApplyRequest,
} from "../features/creation-workbench/modes/DirectGenerateMode";
import { projectCanEdit } from "../features/creation-workbench/generationGates";
import { revealWorkbenchAnchor, scrollToSelector } from "../features/creation-workbench/workbenchNav";
import { ProjectMembersCard } from "../components/ProjectMembersCard";
import { ProjectDatabasesCard } from "../components/ProjectDatabasesCard";
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
      className={`group-head ${accent}`}
      style={{ scrollMarginTop: "var(--sp-16)" }}
    >
      <span className="group-num">{num}</span>
      <span className="group-title">{title}</span>
      {desc && <span className="group-desc">{desc}</span>}
      <span className="group-rule" />
      {hint && <span className="hint" style={{ whiteSpace: "nowrap" }}>{hint}</span>}
    </div>
  );
}

/** 幕與幕之間的銜接語：告訴使用者上一幕的東西怎麼流進下一幕（環環相扣的敘事線） */
function StageLink({ text }: { text: string }) {
  return (
    <p className="hint" aria-hidden style={{ display: "flex", alignItems: "center", gap: 6, margin: "4px 0 0 2px" }}>
      <Icon name="ChevronDown" size={14} style={{ flexShrink: 0 }} />
      {text}
    </p>
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
          <span key={v} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
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
          </span>
        ))}
        {values.length === 0 && readOnly && <span className="hint">未設定</span>}
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
      <span
        role="button"
        tabIndex={0}
        className="chip pick"
        title="新增一個選項（全組共用；加完自動幫本專案勾上）"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
      >
        <Icon name="Plus" size={12} style={{ verticalAlign: "-2px" }} /> 新增
      </span>
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
      <button className="btn-sm primary" disabled={!label.trim() || add.isPending} onClick={submit}>
        {add.isPending ? "新增中…" : "加入"}
      </button>
      <button className="btn-sm" disabled={add.isPending} onClick={() => { setOpen(false); setLabel(""); }}>
        取消
      </button>
      {add.error && <span className="error" style={{ marginTop: 0 }}>{add.error.message}</span>}
    </span>
  );
}

/**
 * 專案工作台（一體連貫長頁版）：三幕環環相扣——
 * ① 專案上下文（世界觀＋選項就地新增／角色・場景定裝／知識庫／素材庫／成員權限）＝AI 的共同大腦；
 * ② AI 創作中心（AI 創作助手：一個對話統包問答・發想・拆分鏡・排計畫執行・查資料庫→生成台→製作範本→提示詞庫）；
 * ③ 分鏡・時間軸・交付＝成品落地。
 * 上下文餵給創作、創作的成品流進分鏡、分鏡打包交付；跨卡動作（導演建議、分鏡提示詞、選來源、
 * 「再用」）都會自動捲到接手的卡並聚焦，不再是各自獨立的功能。
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
  /** 提示詞庫「用於製作範本」：把咒語帶進製作範本想法框（nonce 遞增觸發 WorkflowCard 套用） */
  const [wfPromptReq, setWfPromptReq] = useState<{ text: string; nonce: number } | null>(null);
  /** 引導步驟列收合狀態（全部完成後可整條收起，不佔版面） */
  const [onboardCollapsed, setOnboardCollapsed] = useState(false);
  const archiveProject = trpc.projects.setArchived.useMutation({
    onSuccess: () => { utils.projects.get.invalidate({ id }); utils.projects.list.invalidate(); },
  });

  if (project.isLoading) return <p className="hint">載入中…</p>;
  if (project.error || !project.data) {
    const code = project.error?.data?.code;
    const msg =
      code === "FORBIDDEN" ? "這個專案不屬於你的組，看不到內容。"
      : code === "NOT_FOUND" ? "找不到這個專案（可能已被刪除）。"
      : `載入失敗：${project.error?.message ?? "未知錯誤"}`;
    return (
      <p className="error">
        {msg} <Link href="/">回作業台</Link>
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
  const applyPrompt = (
    text: string,
    settings?: { modelId?: string | null; characterIds?: string[] | null; scenePresetIds?: string[] | null; sourceAssetId?: string | null },
  ) => {
    // 現值：優先 DOM（工作台內表單），再退回 draft storage（可能有 debounce 延遲）
    const live = (document.getElementById("gen-prompt") as HTMLTextAreaElement | null)?.value;
    const current = (live ?? loadDraft(id).prompt ?? "").trim();
    // 這裡刻意保留原生 confirm：只在使用者已手打提示詞時才問「要覆蓋嗎」
    if (current && !window.confirm("要覆蓋你已輸入的提示詞嗎？")) return;
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
  };

  // 「從這裡開始」四步：用實際 state 判定完成打勾
  const sceneCount = scenes.data?.length ?? 0;
  const onboardSteps = [
    { label: "設世界觀", done: !!(wv.logline.trim() || wv.message.trim()), target: "#onboard-worldview", hint: "填一句故事或關鍵訊息" },
    { label: "生成一鏡", done: !!generations.data?.some((g) => g.status === "done"), target: "#gen-prompt", hint: "在生成台做出第一張成品" },
    { label: "加入分鏡", done: sceneCount > 0, target: "#onboard-delivery", hint: "把成品排進分鏡" },
    // 第4步用「有分鏡通過審核」當完成訊號，才不會一有分鏡就跟第3步一起打勾（誤導已交付）
    { label: "送審／打包", done: !!scenes.data?.some((s) => s.status === "approved"), target: "#onboard-delivery", hint: "送審通過後即可打包交付" },
  ];
  const allStepsDone = onboardSteps.every((s) => s.done);

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
      {options.isLoading && !opts.length && <span className="hint">載入中…</span>}
      {opts.map((t) => {
        const on = wv[field].includes(t);
        return (
          <span
            key={t}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            className={`chip pick ${on ? "on" : ""}`}
            onClick={() => toggle(field, t)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(field, t); } }}
          >
            {t}
          </span>
        );
      })}
      {orphansOf(field, opts).map((t) => (
        <span key={t} role="button" tabIndex={0} aria-pressed
          className="chip pick on" style={{ borderStyle: "dashed", opacity: 0.75 }}
          title="這個選項已被移出清單，點一下可從本專案移除"
          onClick={() => toggle(field, t)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(field, t); } }}>
          {t} <Icon name="Info" size={12} style={{ verticalAlign: "-2px" }} />
        </span>
      ))}
      {/* 選項就地新增：組長直接在工作台加，不必繞去「選項」選單頁（加完自動勾上） */}
      {isLeader && canEdit && (
        <AddOptionChip groupId={p.groupId} type={optType} onAdded={(label) => toggle(field, label)} />
      )}
    </div>
  );

  /** 上下文摘要條的一顆 chip：顯示計數、點了捲到對應卡 */
  const summaryChip = (label: string, target: string, on = false) => (
    <span
      role="button"
      tabIndex={0}
      className={`chip pick ${on ? "on" : ""}`}
      onClick={() => scrollToSelector(target)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); scrollToSelector(target); } }}
    >
      {label}
    </span>
  );

  return (
    // position:relative＋ref：游標座標（x/y 比例＋[data-fb] 錨點）與覆蓋層都以這個容器為基準
    <div ref={collab.containerRef} onPointerMove={collab.onPointerMove} style={{ position: "relative" }}>
      <CursorOverlay cursors={collab.cursors} />
      {/* 麵包屑：長頁面全程可及的返回入口＋標示專案所屬組（切組後留在他組專案時，一眼看出情境） */}
      <p className="hint" style={{ margin: "14px 0 0", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Icon name="Undo2" size={13} />回作業台
        </Link>
        {(() => {
          const g = me.data?.groups.find((x) => x.groupId === p.groupId);
          return g ? <span>・{g.teamName}・{g.groupName}</span> : null;
        })()}
      </p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ flex: "1 1 auto" }}>{p.title}{p.status === "archived" && <span className="chip" style={{ marginLeft: 10 }}>已封存</span>}</h1>
        {/* 即時協作：連線狀態＋誰在場＋一般／鏡像跟隨模式切換 */}
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} aria-live="polite">
          {!collab.connected && (
            <span
              className="hint"
              title="WebSocket 未連上時，留言與生成仍會每數秒自動刷新，只是看不到即時游標與「誰在場」"
              style={{ fontSize: 12, padding: "2px 10px", borderRadius: 999, border: "1px dashed var(--border-strong)" }}
            >
              即時同步連線中…
            </span>
          )}
          {collab.connected && collab.peers.length === 0 && (
            <span className="hint" style={{ fontSize: 12 }}>即時同步已連線</span>
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
        </span>
        {collabMode === "mirror" && followUserId && (
          <p className="hint" style={{ flexBasis: "100%", margin: "4px 0 0" }}>
            鏡像跟隨中：畫面會跟著對方的焦點區與游標捲動（不是螢幕串流；雙方版面不同時以卡片錨點對位）。
            可點「退出鏡像」或再點對方名字取消。
          </p>
        )}
        {canArchive && (
          p.status === "archived" ? (
            <button className="btn-sm" disabled={archiveProject.isPending} onClick={() => archiveProject.mutate({ id, archived: false })}>
              還原專案
            </button>
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
      <p className="sub">
        {p.format}・{p.platform}
        {wv.logline ? `・${wv.logline}` : ""}
      </p>
      {/* #25 常駐交付出口指引：告訴非工程師成品最後怎麼落地，點一下捲到分鏡・交付區 */}
      <p
        className="hint"
        role="button"
        tabIndex={0}
        onClick={() => scrollToSelector("#onboard-delivery")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); scrollToSelector("#onboard-delivery"); } }}
        style={{ marginTop: -4, marginBottom: 10, cursor: "pointer", fontSize: 13 }}
      >
        做好後可打包成 zip，媒體檔直接拖進剪映／Premiere 就能剪 <Icon name="ArrowRight" size={13} style={{ verticalAlign: "-2px" }} />
      </p>
      {archiveProject.error && <p className="error">{archiveProject.error.message}</p>}

      {/* 2.3 唯讀橫幅：檢視者第一眼就知道自己是唯讀＋能做什麼＋找誰解鎖（不是「系統一直壞」） */}
      {!canEdit && (
        <div
          className="card"
          role="status"
          data-fb="唯讀橫幅"
          style={{ padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
        >
          <Icon name="Lock" size={15} style={{ flexShrink: 0, color: "var(--primary-ink)" }} />
          <span style={{ fontSize: 13 }}>
            你在此專案是<b>檢視者（唯讀）</b>——可以瀏覽、留言、下載交付；要編輯或生成，請組長到「① 專案上下文」底部的成員權限把你改成編輯者。
          </span>
        </div>
      )}

      {/* #9 「從這裡開始」步驟列：用實際 state 判定完成打勾，點某步捲到對應區塊 */}
      <section className="card" data-fb="從這裡開始" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>從這裡開始</h2>
          <HelpTip text="這是製作一支片的四個步驟。做到哪一步會自動打勾，點步驟可跳到對應區塊。" />
          <span style={{ flex: "1 1 auto" }} />
          {allStepsDone && <span className="chip" style={{ fontSize: 12 }}>全部完成</span>}
          <button
            className="btn-sm"
            onClick={() => setOnboardCollapsed((v) => !v)}
          >
            {onboardCollapsed ? "展開" : "收合"}
          </button>
        </div>
        {!onboardCollapsed && (
          <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {onboardSteps.map((s, i) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => {
                    // Workbench anchors (#gen-prompt / #sec-studio / …) must switch mode first.
                    if (s.target === "#gen-prompt" || s.target === "#sec-studio" || s.target === "#sec-agent" || s.target === "#sec-assistant") {
                      revealWorkbenchAnchor(s.target, { projectId: id });
                    } else {
                      scrollToSelector(s.target);
                    }
                  }}
                  title={s.hint}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                    padding: "8px 12px", borderRadius: "var(--r-12)", cursor: "pointer",
                    border: s.done ? "1px solid var(--primary-border)" : "1px solid var(--border)",
                    background: s.done ? "var(--primary-tint)" : "transparent",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 22, height: 22, borderRadius: "50%", fontSize: 12, fontWeight: 700,
                      border: s.done ? "none" : "1px solid var(--border)",
                      background: s.done ? "var(--primary-solid)" : "transparent",
                      color: s.done ? "var(--primary-fg)" : "inherit",
                    }}
                  >
                    {s.done ? <Icon name="Check" size={13} /> : i + 1}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: s.done ? 600 : 400 }}>{s.label}</span>
                </button>
                {i < onboardSteps.length - 1 && <span aria-hidden className="hint" style={{ display: "inline-flex", alignItems: "center", fontSize: 14 }}><Icon name="ArrowRight" size={14} /></span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* #28 章節導覽：桌面左側 sticky 側欄／手機頂部可收合列（純附加，不動 .cols 版面）。
          ③分鏡・交付 帶留言未讀徽章（有人提及我時顯示 @N）——組長漏審/夥伴喊話不再無聲。 */}
      <div className="toc-layout">
      <TocNav
        items={[
          { id: "stage-context", label: "① 專案上下文" },
          { id: "stage-create", label: "② AI 創作中心" },
          {
            id: "stage-deliver",
            label: "③ 分鏡・交付",
            badge: unread.data && unread.data.count > 0 ? (unread.data.mentioned ? `@${Math.min(unread.data.count, 99)}` : String(Math.min(unread.data.count, 99))) : undefined,
          },
        ]}
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
            hint={wvReady ? "已定盤" : "未定盤"}
          />
          {/* 上下文摘要條：一眼看見 AI 全程共用哪些設定；點 chip 直達對應卡 */}
          <div className="ctx-summary" role="group" aria-label="AI 全程共用的上下文一覽">
            AI 全程共用：
            {summaryChip(`世界觀${wvReady ? " ✓" : "（未定盤）"}`, "#onboard-worldview", wvReady)}
            {summaryChip(`角色 ${charCount ?? "…"}・場景 ${presetCount ?? "…"}`, "#sec-characters")}
            {summaryChip(`知識 ${knowledgeCount ?? "…"} 份`, "#sec-knowledge")}
            {summaryChip(`素材 ${assetCount ?? "…"}`, "#sec-assets")}
          </div>
          {/* 世界觀（快速層） */}
          <CollabZone {...zoneProps(COLLAB_ZONES.worldview)}>
          <section className="card" data-fb="世界觀卡" id="onboard-worldview">
            <h2>
              世界觀（專案定盤星）
              <HelpTip text="這支片的固定設定，填一次，之後每次生成 AI 自動記得，不用重講背景。" />
              {updateWv.isPending ? (
                <span className="hint" style={{ marginLeft: 8, fontSize: 13, fontWeight: 400 }}>儲存中…</span>
              ) : wvSaved !== "idle" ? (
                <span
                  className="hint"
                  style={{
                    marginLeft: 8, fontSize: 13, fontWeight: 400, color: "var(--primary-ink)",
                    opacity: wvSaved === "fading" ? 0 : 1, transition: "opacity var(--dur-slow)",
                  }}
                >
                  已儲存 <Icon name="Check" size={13} />
                </span>
              ) : null}
            </h2>
            {!canEdit && <p className="hint" style={{ margin: "4px 0 0" }}>檢視者唯讀——世界觀可瀏覽、不能修改（打的字不會被儲存）。</p>}
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
              <p className="hint" style={{ marginTop: 8, fontSize: 12 }}>
                選項可直接按各列的「＋新增」加；改名／停用／排序在 <Link href="/options">選項整理頁</Link>。
              </p>
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
                <p className="hint" style={{ marginTop: 8, fontSize: 12 }}>
                  視覺風格與禁忌事項會自動注入每次生成的提示詞；其他欄位供 AI 導演與團隊參考。
                </p>
              </div>
            </details>
            {updateWv.error && <p className="error">世界觀儲存失敗：{updateWv.error.message}</p>}
          </section>
          </CollabZone>

          {/* 角色定裝卡：勾選後生成自動注入外觀錨點。
              錨點 id 掛外層 div、不再加外層 <h2>——元件自帶標題，疊兩個同字樣大標會像壞掉（比照 sec-scenes 做法） */}
          <div id="sec-characters">
            <CharacterCards projectId={id} selectedIds={charIds} onToggle={toggleChar} />
          </div>

          {/* 場景設定卡：勾選後生成自動注入色板/光線錨點 */}
          <div id="sec-scenes">
            <ScenePresetCards projectId={id} selectedIds={sceneIds} onToggle={toggleScene} readOnly={!canEdit} />
          </div>

          {/* 專案知識庫：AI 讀得懂上傳的開示/見證/腳本（願景核心「真的懂我們」） */}
          <div id="sec-knowledge">
            <KnowledgeBase projectId={id} readOnly={!canEdit} />
          </div>

          {/* 專案資料：AI 可引用狀態 + 一鍵建表 + 已關聯列彙整（不碰 plan／notesCore） */}
          <ProjectDatabasesCard projectId={id} canEdit={canEdit} />

          {/* 素材庫（工作台一體化：從舊「③素材整理」搬進①）——上傳的檔案、生成的成品都是上下文的一部分；
              「用作來源」會自動捲到下方生成台接手 */}
          <CollabZone {...zoneProps(COLLAB_ZONES.assets)}>
            {/* data-fb 讓元件回饋標定「上傳素材」；透明包裹，不影響版面 */}
            <div data-fb="上傳素材" id="sec-assets">
              <AssetLibrary
                projectId={id}
                selectedSourceId={sourceHighlightId}
                onPickSource={(a) => {
                  setSourceHighlightId(a.id);
                  setGenerateApply((prev) => ({
                    nonce: (prev?.nonce ?? 0) + 1,
                    sourceAsset: a,
                  }));
                  // 選來源＝要生成：切到直接生成並打開進階來源
                  revealWorkbenchAnchor("#sec-studio", { projectId: id });
                }}
              />
            </div>
          </CollabZone>

          {/* 回收桶：軟刪除還原（誤刪素材／分鏡可救回） */}
          <div id="sec-recyclebin">
            <RecycleBin projectId={id} />
          </div>

          {/* 專案權限（需求 2.3）：誰可編輯、誰唯讀——屬專案設定的一環，但非日常操作，收合呈現不佔主視線 */}
          <details className="card card--quiet" data-fb="專案權限收合卡" id="sec-members">
            <summary>
              <Icon name="Lock" size={14} />成員權限（預設全員可編輯；可設個別成員唯讀）
              <Icon name="ChevronDown" size={14} style={{ marginLeft: "auto" }} />
            </summary>
            <div style={{ marginTop: 10 }}>
              <ProjectMembersCard projectId={id} bare />
            </div>
          </details>

          <StageLink text="以上設定會自動注入下方每一次生成——AI 全程記得，不必重講背景" />

          {/* ② AI 創作中心：發想 → 生成 → 串鏈，同一組上下文 */}
          <StageHead
            id="stage-create"
            num="②"
            title="AI 創作中心"
            desc="AI 創作助手＋生成・製作範本一條線"
            accent="group-2"
            hint={doneGenCount != null ? `已完成 ${doneGenCount} 次生成` : undefined}
          />
          {/* AI 創作工作台：模式 tabs + 共享草稿；直接生成表單在 DirectGenerateMode（#sec-studio） */}
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
            workflowPromptRequest={wfPromptReq}
            onReuseGenerate={applyPrompt}
            onGenerateSourceChange={setSourceHighlightId}
            studioCollab={zoneProps(COLLAB_ZONES.studio)}
          />

          {/* 製作範本 WorkflowCard 已移入工作台 TemplateMode（#sec-workflow）；此處不再重複掛卡 */}

          {/* 提示詞庫：成功生成的咒語一鍵再用（「再用」還原完整設定帶回生成台；「製作範本」帶進想法框） */}
          <div id="sec-prompts">
            <PromptLibrary
              projectId={id}
              onUse={applyPrompt}
              onUseForWorkflow={(text) => {
                setWfPromptReq((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
                revealWorkbenchAnchor("#sec-workflow", { projectId: id });
              }}
            />
          </div>

          <StageLink text="成品會自動存入素材庫；在生成紀錄按「＋加入分鏡」，就會排進下方分鏡列" />

          {/* ③ 分鏡・時間軸・交付：排片、粗剪預覽、送審與打包（SceneList 一體卡全含） */}
          <StageHead
            id="stage-deliver"
            num="③"
            title="分鏡・時間軸・交付"
            desc="排片・粗剪預覽・送審・打包"
            accent="group-3"
            hint={pendingSceneCount != null ? `分鏡 ${sceneCount}・待審 ${pendingSceneCount}` : undefined}
          />
          <CollabZone {...zoneProps(COLLAB_ZONES.scenes)}>
            {/* data-fb 讓元件回饋標定「打包下載」（分鏡與交付區）；透明包裹，不影響版面。id 供引導步驟與交付指引捲動定位 */}
            {/* 錨點 id 掛外層 div、不再加外層 <h2>（SceneList 卡片自帶同名標題，白話提示移進去了） */}
            <div data-fb="打包下載" id="onboard-delivery">
              {/* charIds/sceneIds：逐鏡就地生成也注入生成台勾選的角色/場景錨點——逐鏡出圖與生成台出圖同一套畫風 */}
              <SceneList projectId={id} isLeader={isLeader} canEdit={canEdit} onUsePrompt={applyPrompt} charIds={charIds} sceneIds={sceneIds} />
            </div>
          </CollabZone>
        </div>

        {/* 組內留言 */}
        <CollabZone {...zoneProps(COLLAB_ZONES.messages)}>
          <MessagePanel projectId={id} groupId={p.groupId} isLeader={isLeader} canEdit={canEdit} />
        </CollabZone>
      </div>
      </div>
    </div>
  );
}
