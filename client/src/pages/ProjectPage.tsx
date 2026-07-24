import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmButton, HelpTip } from "../components/interactions";
import { worldviewSchema, type Worldview } from "@shared/worldview";
import { getModel, estimatePoints } from "@shared/models";
import { GenerationList } from "../components/GenerationList";
import { SceneList } from "../components/SceneList";
import { DirectorCard } from "../components/DirectorCard";
import { MessagePanel } from "../components/MessagePanel";
import { ModelPicker, type PickedModel } from "../components/ModelPicker";
import { WorkflowCard } from "../components/WorkflowCard";
import { AssetLibrary } from "../components/AssetLibrary";
import { RecycleBin } from "../components/RecycleBin";
import { KnowledgeBase } from "../components/KnowledgeBase";
import { ScriptSplitCard } from "../components/ScriptSplitCard";
import { CharacterCards } from "../components/CharacterCards";
import { ScenePresetCards } from "../components/ScenePresetCards";
import { PromptLibrary } from "../components/PromptLibrary";
import { TocNav } from "../components/TocNav";
import { ProjectAssistant } from "../components/ProjectAssistant";
import { AgentCard } from "../components/AgentCard";
import { ProjectMembersCard } from "../components/ProjectMembersCard";
import { ProjectDatabasesCard } from "../components/ProjectDatabasesCard";
import { useCollab, CursorOverlay, CollabZone, COLLAB_ZONES } from "../realtime";

/**
 * 來源素材「明顯不相容」過濾表（後端 generation.submit 用同一張表把關）：
 * 寬鬆原則——只擋確定會失敗的組合，doc/zip 等不確定的保留。
 */
const SOURCE_INCOMPAT: Record<string, string[]> = {
  image: ["audio"],
  audio: ["image"], // 影片放行：Whisper/Scribe 類轉錄端點普遍接受影片容器（自動抽音軌）
  video: ["audio"],
};

/** 平滑捲動到頁面某錨點（引導步驟／摘要條／跨卡跳轉共用） */
function scrollToSelector(selector: string) {
  requestAnimationFrame(() => {
    document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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
 * ② AI 創作中心（助手→導演→拆分鏡→生成台→工作流→提示詞庫，發想到執行一條線）；
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

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<PickedModel | null>(null);
  /** 來源：優先素材庫（伺服器簽名網址，永久有效）；也可貼外部網址 */
  const [sourceAsset, setSourceAsset] = useState<{ id: string; title: string; kind: string } | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  /** 外部網址 onBlur 預檢結果（new URL()，需 http/https）；非空時生成鈕會鎖住 */
  const [sourceUrlError, setSourceUrlError] = useState("");
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
  /** 引導步驟列收合狀態（全部完成後可整條收起，不佔版面） */
  const [onboardCollapsed, setOnboardCollapsed] = useState(false);
  /** 生成確認彈窗：先估點數、使用者點頭才真的送出、扣點 */
  const [confirming, setConfirming] = useState(false);
  /** 送出後回饋：達成本審核門檻被攔下時顯示「已送組長核准」（一般成功維持既有安靜行為，以列表出現新列為回饋） */
  const [submitNotice, setSubmitNotice] = useState("");
  // 帶 groupId（本專案的組）才算得出週/日額度——不帶時 quota.my 的 weeklyQuota 恆為 null，彈窗週用量變死碼
  const quota = trpc.quota.my.useQuery({ groupId: project.data?.groupId }, { enabled: confirming && !!project.data });
  const savePrompt = trpc.prompts.save.useMutation({ onSuccess: () => utils.prompts.list.invalidate({ projectId: id }) });
  const archiveProject = trpc.projects.setArchived.useMutation({
    onSuccess: () => { utils.projects.get.invalidate({ id }); utils.projects.list.invalidate(); },
  });
  // 冪等鍵（QA-007）：同一次「還沒成功」的生成重試沿用同鍵——timeout 後再按不會重複扣點/重複生成；
  // 成功才換新鍵（下一次生成）
  const submitRequestId = useRef<string>(crypto.randomUUID());
  const submit = trpc.generation.submit.useMutation({
    onSuccess: (data, vars) => {
      submitRequestId.current = crypto.randomUUID();
      // 成功生成的提示詞自動入庫（簡報「打過的咒語自動存起來」）
      savePrompt.mutate({ projectId: id, text: vars.prompt });
      setPrompt("");
      setConfirming(false);
      // 達門檻的列不會馬上開始生成——明確告知已送核准，否則使用者會以為卡住
      setSubmitNotice(data.status === "awaiting_approval" ? "⏳ 已送組長核准——核准後才會開始生成" : "");
    },
    // fal submit 失敗時伺服器也已寫入一筆 failed 列並退點——成功失敗都要刷新列表與點數
    onSettled: () => {
      utils.generation.listByProject.invalidate({ projectId: id });
      utils.quota.my.invalidate();
    },
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
  const canEdit = p.myProjectRole !== "viewer";

  /** 「用這個提示詞」統一入口（AI 導演／分鏡草稿／提示詞庫「再用」）：
   * 避免默默蓋掉手打的提示詞；套用後自動捲到生成台、聚焦提示詞框——跨卡動作由系統接手，不用自己捲 */
  const applyPrompt = (text: string) => {
    // 這裡刻意保留原生 confirm：只在使用者已手打提示詞時才問「要覆蓋嗎」；改成就地面板會多一層互動反而更煩
    if (prompt.trim() && !window.confirm("要覆蓋你已輸入的提示詞嗎？")) return;
    setPrompt(text);
    // 等 React 畫完再捲動；focus 用 preventScroll 才不會打斷平滑捲動
    requestAnimationFrame(() => {
      const el = document.getElementById("gen-prompt") as HTMLTextAreaElement | null;
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
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

  // 生成鈕鎖住時，旁邊同步顯示「為什麼」——非工程師看得懂的一句話
  const needs = model?.needs;
  // 逐次估點：按字計費的 TTS 依「要唸的文字」長度即時估，與後端扣點同一函式（shared/models）——顯示＝扣點。
  // 其餘模型回扁平 points（行為不變）。full 找不到（理論上不會）時退回清單帶的 points。
  const fullModel = model ? getModel(model.id) : undefined;
  const estPoints = fullModel ? estimatePoints(fullModel, { promptChars: prompt.length }) : (model?.points ?? 0);
  const missingSource = model != null && needs != null && !sourceAsset && !sourceUrl.trim();
  const badSourceUrl = model != null && needs != null && !sourceAsset && sourceUrl.trim() !== "" && sourceUrlError !== "";
  // 已選素材與模型明顯不相容（換模型後殘留、或從素材庫直接點選）：鎖住並講清楚，不靜默清掉
  const incompatSource = !!needs && !!sourceAsset && (SOURCE_INCOMPAT[needs] ?? []).includes(sourceAsset.kind);
  const disableReason =
    !canEdit ? "你在此專案是檢視者（唯讀），不能生成——需要編輯請組長到「成員權限」調整"
    : !model ? "模型清單還在載入，稍等一下就能生成"
    : !prompt.trim() ? "先填一句提示詞，描述想要的畫面"
    : missingSource ? "這個模型需要來源素材——從素材庫選一個，或貼上網址"
    : incompatSource ? `選到的素材是${sourceAsset.kind === "audio" ? "音訊" : sourceAsset.kind === "image" ? "圖片" : sourceAsset.kind}，這個模型不能用它——請換一個來源`
    : badSourceUrl ? "網址格式不對，需以 https:// 開頭"
    : null;
  // 來源下拉只列「明顯相容」的素材（寬鬆過濾，不確定的保留；後端 submit 有同一張表把關）。
  // 已選中的素材即使不相容也保留在清單裡：select 的 value 永遠對得到 option，不會顯示成空白
  const sourceOptions = (assets.data ?? []).filter(
    (a) => a.id === sourceAsset?.id || !needs || !(SOURCE_INCOMPAT[needs] ?? []).includes(a.kind),
  );

  /** 編輯指示：把某區塊接上協作狀態（誰在這裡→內框＋標籤） */
  const zoneProps = (zone: string) => ({
    zone,
    watchers: collab.focusZones[zone] ?? [],
    sendFocus: collab.sendFocus,
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
        {collab.peers.length > 0 && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {collab.peers.map((peer) => {
              const isMe = peer.userId === collab.self?.userId;
              return (
                <span
                  key={peer.userId}
                  title="正在這個專案裡"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 12, padding: "2px 10px", borderRadius: 999,
                    border: `1px solid ${peer.color}`, color: peer.color,
                    textShadow: "0 1px 2px var(--scrim)",
                    opacity: isMe ? 0.55 : 1,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: peer.color }} />
                  {isMe ? "你" : peer.name}
                </span>
              );
            })}
          </span>
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
                  onClick={() => scrollToSelector(s.target)}
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
            <input
              id="wv-logline"
              defaultValue={wv.logline}
              readOnly={!canEdit}
              placeholder="例：陳師姐從憂鬱低谷透過印心佛法走出重生"
              onBlur={(e) => canEdit && e.target.value !== wv.logline && updateWv.mutate({ id, worldview: { logline: e.target.value } })}
            />
            <label htmlFor="wv-message">一句關鍵訊息（一片一訊息）</label>
            <input
              id="wv-message"
              defaultValue={wv.message}
              readOnly={!canEdit}
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
                  id="wv-audience"
                  defaultValue={wv.audience}
                  readOnly={!canEdit}
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
                    key={field}
                    aria-label={`三幕結構：${label}`}
                    defaultValue={wv.acts[field]}
                    readOnly={!canEdit}
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
            <ScenePresetCards projectId={id} selectedIds={sceneIds} onToggle={toggleScene} />
          </div>

          {/* 專案知識庫：AI 讀得懂上傳的開示/見證/腳本（願景核心「真的懂我們」） */}
          <div id="sec-knowledge">
            <KnowledgeBase projectId={id} readOnly={!canEdit} />
          </div>

          {/* 專案 × 資料庫連結：自訂資料庫裡指到本專案的資料列（唯讀彙整；無連結時不顯示） */}
          <ProjectDatabasesCard projectId={id} />

          {/* 素材庫（工作台一體化：從舊「③素材整理」搬進①）——上傳的檔案、生成的成品都是上下文的一部分；
              「用作來源」會自動捲到下方生成台接手 */}
          <CollabZone {...zoneProps(COLLAB_ZONES.assets)}>
            {/* data-fb 讓元件回饋標定「上傳素材」；透明包裹，不影響版面 */}
            <div data-fb="上傳素材" id="sec-assets">
              <AssetLibrary
                projectId={id}
                selectedSourceId={sourceAsset?.id ?? null}
                onPickSource={(a) => {
                  setSourceAsset(a);
                  setSourceUrl("");
                  setSourceUrlError("");
                  // 選來源＝要生成：直接把人帶到生成台接手，環環相扣不用自己捲下去找
                  scrollToSelector("#sec-studio");
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
            desc="助手・導演・拆分鏡・生成・工作流一條線"
            accent="group-2"
            hint={doneGenCount != null ? `已完成 ${doneGenCount} 次生成` : undefined}
          />
          {/* AI 代理（代理系統核心）：一句目標→計畫核准→伺服器背景逐步執行——把「發想→生成→送審」交給代理跑 */}
          <AgentCard projectId={id} canEdit={canEdit} isLeader={isLeader} />

          {/* AI 專案助手：統一對話入口——問進度、要建議，它會提議動作（生成/建分鏡/送審/跑工作流），你確認才執行 */}
          <ProjectAssistant projectId={id} />

          {/* AI 導演建議（讀①的世界觀＋知識庫發想；「用這個」自動帶到生成台） */}
          <div id="sec-director">
            <DirectorCard projectId={id} onUse={applyPrompt} />
          </div>

          {/* AI 拆分鏡：貼腳本 → 自動建分鏡草稿（草稿落在③分鏡列表，逐格可就地生成） */}
          <div id="sec-split">
            <ScriptSplitCard projectId={id} />
          </div>

          {/* 生成台（11 類 × 旗艦/經濟/最低成本）＝日常主力工作區 */}
          <CollabZone {...zoneProps(COLLAB_ZONES.studio)}>
          <section className="card card--primary" data-fb="生成台" id="sec-studio">
            <h2>創作生成</h2>
            <ModelPicker onChange={setModel} />
            {model?.needs && (
              <>
                <label htmlFor="gen-source">{model.sourceHint ?? "來源素材"}</label>
                {sourceOptions.length > 0 && (
                  <select
                    id="gen-source"
                    value={sourceAsset?.id ?? ""}
                    onChange={(e) => {
                      const picked = sourceOptions.find((a) => a.id === e.target.value);
                      setSourceAsset(picked ? { id: picked.id, title: picked.title, kind: picked.kind } : null);
                      if (picked) { setSourceUrl(""); setSourceUrlError(""); }
                    }}
                  >
                    <option value="">從本專案素材庫選…</option>
                    {sourceOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        [{a.kind}] {a.title}
                      </option>
                    ))}
                  </select>
                )}
                {sourceAsset ? (
                  <p className="hint">
                    來源：{sourceAsset.title}（素材庫）
                    <button className="btn-sm" style={{ marginLeft: 8 }} onClick={() => setSourceAsset(null)}>
                      改用網址
                    </button>
                  </p>
                ) : (
                  <>
                    <input
                      value={sourceUrl}
                      onChange={(e) => { setSourceUrl(e.target.value); setSourceUrlError(""); }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (!v) { setSourceUrlError(""); return; }
                        try {
                          const u = new URL(v);
                          setSourceUrlError(u.protocol === "http:" || u.protocol === "https:" ? "" : "網址格式不對，需以 https:// 開頭");
                        } catch {
                          setSourceUrlError("網址格式不對，需以 https:// 開頭");
                        }
                      }}
                      placeholder="https://…（或從上方素材庫選）"
                    />
                    {sourceUrlError && <p className="error">{sourceUrlError}</p>}
                  </>
                )}
              </>
            )}
            <label htmlFor="gen-prompt">{model?.kind === "audio" && model.needs == null ? "要唸的文字/音樂描述" : "提示詞（世界觀會自動帶入，不必重講背景）"}</label>
            {/* id 是「用這個」等功能捲動聚焦的錨點，別拿掉 */}
            <textarea id="gen-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例：清晨禪堂，柔和光線灑落，一炷香的靜謐" />
            {/* 帶入中的上下文一覽（環環相扣的回看線）：生成台就地看見「AI 會帶什麼」，要調就一鍵捲回① */}
            <div className="ctx-summary" style={{ marginTop: 8 }} role="group" aria-label="這次生成會帶入的上下文">
              帶入：
              {summaryChip(`世界觀${wvReady ? " ✓" : "（未定盤）"}`, "#onboard-worldview", wvReady)}
              {summaryChip(`角色 ${charIds.length}`, "#sec-characters", charIds.length > 0)}
              {summaryChip(`場景 ${sceneIds.length}`, "#sec-scenes", sceneIds.length > 0)}
            </div>
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="primary"
                data-fb="生成按鈕"
                disabled={disableReason != null || submit.isPending}
                onClick={() => { setSubmitNotice(""); setConfirming(true); }}
              >
                {!model ? "模型載入中…" : submit.isPending ? "送出中…" : `生成（−${estPoints} 點）`}
              </button>
              <span className="hint">{disableReason ?? "失敗自動退點・額度由管理員調整"}</span>
            </div>

            {/* 生成前確認彈窗（簡報「花錢前先讓你看價，你點頭才做」） */}
            {confirming && model && (
              <div className="confirm-panel">
                <h3 style={{ margin: "0 0 8px" }}>即將生成</h3>
                <p style={{ margin: "4px 0" }}>
                  <b>{model.label}</b>・{p.format}
                  {charIds.length > 0 && <>・帶入 {charIds.length} 個角色定裝</>}
                  {sceneIds.length > 0 && <>・{sceneIds.length} 個場景設定</>}
                </p>
                <p style={{ margin: "4px 0", fontSize: 13 }}>提示詞：{prompt.trim().slice(0, 80)}{prompt.trim().length > 80 ? "…" : ""}</p>
                {/* 注入透明化（深度優化）：花錢前看得見世界觀實際會帶進哪些東西，不再是黑盒 */}
                {(wv.tones.length > 0 || wv.styles.length > 0 || wv.taboos.length > 0) && (
                  <p className="hint" style={{ margin: "4px 0", fontSize: 12 }}>
                    自動注入：
                    {[
                      wv.tones.length ? `調性（${wv.tones.join("、")}）` : "",
                      wv.styles.length ? `風格（${wv.styles.join("、")}）` : "",
                      wv.taboos.length ? `禁忌 ${wv.taboos.length} 條` : "",
                    ].filter(Boolean).join("・")}
                  </p>
                )}
                <p style={{ margin: "8px 0" }}>
                  預估 <b style={{ color: "var(--primary-ink)", fontSize: 18 }}>約 {estPoints} 點</b>
                  {fullModel && estimatePoints(fullModel, { promptChars: 2000 }) !== estimatePoints(fullModel, { promptChars: 1 }) && (
                    <span className="hint" style={{ marginLeft: 6, fontSize: 12 }}>（依文字長度即時計費）</span>
                  )}
                  {quota.data && (
                    <span className="hint" style={{ marginLeft: 8 }}>
                      {quota.data.totalRemaining != null ? `目前剩 ${quota.data.totalRemaining.toLocaleString()} 點` : "額度不限"}
                      {quota.data.weeklyQuota != null ? `・本週 ${quota.data.weeklyUsed}/${quota.data.weeklyQuota}` : ""}
                      {quota.data.dailyQuota != null ? `・今日 ${quota.data.dailyUsed}/${quota.data.dailyQuota}` : ""}
                    </span>
                  )}
                </p>
                {/* 成本審核門檻提醒：組員單筆估點達組長設定的門檻→送出後要等組長核准才會開始生成 */}
                {/* 用 estPoints（實際估點/扣點值）比門檻，而非 model.points——逐字計費的 TTS 會隨提示詞長度
                    變動，用 model.points 會與伺服器（以真估點判斷）不一致，顯示「免核准」卻被擋審，反之亦然 */}
                {myRole === "member" &&
                  quota.data?.approvalThreshold != null &&
                  quota.data.approvalThreshold > 0 &&
                  estPoints >= quota.data.approvalThreshold && (
                    <p style={{ margin: "4px 0", fontSize: 13, color: "var(--gold-ink)" }}>
                      ⏳ 這筆需要組長核准後才會開始生成（{estPoints} 點 ≥ 門檻 {quota.data.approvalThreshold} 點）
                    </p>
                  )}
                <p className="hint" style={{ fontSize: 12 }}>失敗全額退點。正式模式會實際呼叫 AI 生成。</p>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button
                    className="primary"
                    disabled={submit.isPending}
                    onClick={() =>
                      model &&
                      submit.mutate({
                        projectId: id,
                        modelId: model.id,
                        prompt: prompt.trim(),
                        sourceAssetId: model.needs && sourceAsset ? sourceAsset.id : undefined,
                        sourceUrl: model.needs && !sourceAsset && sourceUrl.trim() ? sourceUrl.trim() : undefined,
                        characterIds: charIds.length ? charIds : undefined,
                        scenePresetIds: sceneIds.length ? sceneIds : undefined,
                        clientRequestId: submitRequestId.current,
                      })
                    }
                  >
                    {submit.isPending ? "生成中…" : "確認生成"}
                  </button>
                  <button disabled={submit.isPending} onClick={() => setConfirming(false)}>再想想</button>
                </div>
              </div>
            )}
            {submitNotice && <p className="hint" role="status" style={{ marginTop: 10, color: "var(--gold-ink)" }}>{submitNotice}</p>}
            {submit.error && <p className="error">{submit.error.message}</p>}
            <GenerationList projectId={id} canEdit={canEdit} />
          </section>
          </CollabZone>

          {/* 工作流（一鍵串鏈） */}
          <div id="sec-workflow">
            <WorkflowCard projectId={id} />
          </div>

          {/* 提示詞庫：成功生成的咒語一鍵再用（「再用」自動帶回上方生成台） */}
          <div id="sec-prompts">
            <PromptLibrary projectId={id} onUse={applyPrompt} />
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
              <SceneList projectId={id} isLeader={isLeader} canEdit={canEdit} onUsePrompt={applyPrompt} />
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
