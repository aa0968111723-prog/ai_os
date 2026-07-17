import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";
import { worldviewSchema, type Worldview } from "@shared/worldview";
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
import { ProjectMembersCard } from "../components/ProjectMembersCard";
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

/** 平滑捲動到頁面某錨點（引導步驟／交付出口指引共用） */
function scrollToSelector(selector: string) {
  requestAnimationFrame(() => {
    document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** 白話小提示：術語旁的「?」小圖示，hover／點擊顯示一句人話（純前端，用原生 title＋aria-label） */
function HelpTip({ text }: { text: string }) {
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={text}
      title={text}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        marginLeft: 6, color: "var(--primary)", cursor: "help",
        verticalAlign: "middle", userSelect: "none",
      }}
    >
      <Icon name="HelpCircle" size={14} />
    </span>
  );
}

/**
 * 五階段標頭（需求 6.7 一條龍工作流）：沿用既有 group-head 樣式，帶錨點 id 供 TocNav 捲動定位。
 * hint 顯示該階段進度（全用頁面既有查詢；拿不到資料就不顯示，絕不為此新增後端呼叫）。
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

/** 專案工作區（需求 6.7 一條龍）：①企劃定盤→②創作生成→③素材整理→④分鏡審核→⑤交付，五階段敘事＋留言 */
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
  // 世界觀三組 chips（主軸／調性／視覺風格）改由本專案所屬組的自訂選項供給（組長可在「選項」頁增修）
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
  /** 生成時要帶入的角色定裝卡（跨鏡一致） */
  const [charIds, setCharIds] = useState<string[]>([]);
  const toggleChar = (cid: string) => setCharIds((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));
  /** 生成時要帶入的場景設定卡（色板/光線一致） */
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const toggleScene = (sid: string) => setSceneIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  const assets = trpc.projects.assets.useQuery({ projectId: id });
  // 留言未讀數（餵 TocNav ⑤交付 徽章）：15 秒輪詢已夠即時，同房夥伴留言另有 WS invalidate 立即刷新
  const unread = trpc.messages.unread.useQuery({ projectId: id }, { refetchInterval: 15000 });
  // 「從這裡開始」步驟列用：讀既有查詢判定各步是否完成（與 GenerationList／SceneList 共用快取，不額外增負擔）
  const generations = trpc.generation.listByProject.useQuery({ projectId: id });
  const scenes = trpc.scenes.listByProject.useQuery({ projectId: id });
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
  const submit = trpc.generation.submit.useMutation({
    onSuccess: (data, vars) => {
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

  // 五階段標頭的進度 hint：全讀頁面既有查詢（generations／scenes 與上方共用快取），查詢還沒回來就不顯示
  const doneGenCount = generations.data?.filter((g) => g.status === "done").length;
  const pendingSceneCount = scenes.data?.filter((s) => s.status === "pending").length;

  const toggle = (field: "tones" | "themes" | "styles", value: string) => {
    if (!canEdit) return; // 檢視者：chips 不可切換（樂觀更新會先亮再彈回，比不動更誤導）
    const current = wv[field];
    const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
    // 只送有改的欄位；伺服器與現值合併（避免整包覆蓋造成的資料遺失）
    updateWv.mutate({ id, worldview: { [field]: next } });
  };

  /** AI 導演「用這個」：避免默默蓋掉手打的提示詞；套用後把視線帶到生成台提示詞框 */
  const applyDirectorPrompt = (text: string) => {
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

  // 生成鈕鎖住時，旁邊同步顯示「為什麼」——非工程師看得懂的一句話
  const needs = model?.needs;
  const missingSource = model != null && needs != null && !sourceAsset && !sourceUrl.trim();
  const badSourceUrl = model != null && needs != null && !sourceAsset && sourceUrl.trim() !== "" && sourceUrlError !== "";
  // 已選素材與模型明顯不相容（換模型後殘留、或從素材庫直接點選）：鎖住並講清楚，不靜默清掉
  const incompatSource = !!needs && !!sourceAsset && (SOURCE_INCOMPAT[needs] ?? []).includes(sourceAsset.kind);
  const disableReason =
    !canEdit ? "你在此專案是檢視者（唯讀），不能生成——需要編輯請組長到專案權限卡調整"
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

  return (
    // position:relative＋ref：游標座標（x/y 比例＋[data-fb] 錨點）與覆蓋層都以這個容器為基準
    <div ref={collab.containerRef} onPointerMove={collab.onPointerMove} style={{ position: "relative" }}>
      <CursorOverlay cursors={collab.cursors} />
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
            你在此專案是<b>檢視者（唯讀）</b>——可以瀏覽、留言、下載交付；要編輯或生成，請組長到「專案權限」卡把你改成編輯者。
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
          ⑤交付 帶留言未讀徽章（有人提及我時顯示 @N）——組長漏審/夥伴喊話不再無聲。 */}
      <div className="toc-layout">
      <TocNav
        items={[
          { id: "stage-plan", label: "① 企劃・定盤" },
          { id: "stage-create", label: "② 創作・生成" },
          { id: "stage-assets", label: "③ 素材整理" },
          { id: "stage-review", label: "④ 分鏡與審核" },
          {
            id: "stage-deliver",
            label: "⑤ 交付",
            badge: unread.data && unread.data.count > 0 ? (unread.data.mentioned ? `@${Math.min(unread.data.count, 99)}` : String(Math.min(unread.data.count, 99))) : undefined,
          },
        ]}
      />
      <div className="cols">
        <div className="stack">
          {/* ① 企劃・定盤：設定一次，AI 全程記得 */}
          <StageHead
            id="stage-plan"
            num="①"
            title="企劃・定盤"
            desc="設定一次，AI 全程記得"
            accent="group-1"
            hint={wv.logline.trim() ? "已定盤" : "未定盤"}
          />
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
            <div role="group" aria-labelledby="wv-themes">
              {options.isLoading && !themeOpts.length && <span className="hint">載入中…</span>}
              {themeOpts.map((t) => {
                const on = wv.themes.includes(t);
                return (
                  <span
                    key={t}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    className={`chip pick ${on ? "on" : ""}`}
                    onClick={() => toggle("themes", t)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle("themes", t); } }}
                  >
                    {t}
                  </span>
                );
              })}
              {orphansOf("themes", themeOpts).map((t) => (
                <span key={t} role="button" tabIndex={0} aria-pressed
                  className="chip pick on" style={{ borderStyle: "dashed", opacity: 0.75 }}
                  title="這個選項已被移出清單，點一下可從本專案移除"
                  onClick={() => toggle("themes", t)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle("themes", t); } }}>
                  {t} <Icon name="Info" size={12} style={{ verticalAlign: "-2px" }} />
                </span>
              ))}
            </div>
            <label id="wv-tones">調性（生成時自動注入）<HelpTip text="語氣與畫風，會自動加進每次生成的提示詞。" /></label>
            <div role="group" aria-labelledby="wv-tones">
              {options.isLoading && !toneOpts.length && <span className="hint">載入中…</span>}
              {toneOpts.map((t) => {
                const on = wv.tones.includes(t);
                return (
                  <span
                    key={t}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    className={`chip pick ${on ? "on" : ""}`}
                    onClick={() => toggle("tones", t)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle("tones", t); } }}
                  >
                    {t}
                  </span>
                );
              })}
              {orphansOf("tones", toneOpts).map((t) => (
                <span key={t} role="button" tabIndex={0} aria-pressed
                  className="chip pick on" style={{ borderStyle: "dashed", opacity: 0.75 }}
                  title="這個選項已被移出清單，點一下可從本專案移除"
                  onClick={() => toggle("tones", t)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle("tones", t); } }}>
                  {t} <Icon name="Info" size={12} style={{ verticalAlign: "-2px" }} />
                </span>
              ))}
            </div>
            <label id="wv-styles">視覺風格（畫面一致的關鍵，生成時自動注入）<HelpTip text="語氣與畫風，會自動加進每次生成的提示詞。" /></label>
            <div role="group" aria-labelledby="wv-styles">
              {options.isLoading && !styleOpts.length && <span className="hint">載入中…</span>}
              {styleOpts.map((s) => {
                const on = wv.styles.includes(s);
                return (
                  <span
                    key={s}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    className={`chip pick ${on ? "on" : ""}`}
                    onClick={() => toggle("styles", s)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle("styles", s); } }}
                  >
                    {s}
                  </span>
                );
              })}
              {orphansOf("styles", styleOpts).map((s) => (
                <span key={s} role="button" tabIndex={0} aria-pressed
                  className="chip pick on" style={{ borderStyle: "dashed", opacity: 0.75 }}
                  title="這個選項已被移出清單，點一下可從本專案移除"
                  onClick={() => toggle("styles", s)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle("styles", s); } }}>
                  {s} <Icon name="Info" size={12} style={{ verticalAlign: "-2px" }} />
                </span>
              ))}
            </div>
            {/* 進階欄位唯讀一覽：讓大家看見生成時實際會被帶入哪些設定 */}
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 13 }}>進階設定（唯讀）</summary>
              <div className="hint" style={{ marginTop: 6, lineHeight: 1.9 }}>
                <div>目標觀眾：{wv.audience.trim() || "未設定"}</div>
                <div>視覺風格：{wv.styles.length ? wv.styles.join("、") : "未設定"}</div>
                <div>
                  三幕結構：
                  {[
                    wv.acts.hook && `鉤子「${wv.acts.hook}」`,
                    wv.acts.turn && `轉折「${wv.acts.turn}」`,
                    wv.acts.cta && `行動呼籲「${wv.acts.cta}」`,
                  ].filter(Boolean).join("・") || "未設定"}
                </div>
                <div>人物：{wv.people.length ? wv.people.join("、") : "未設定"}</div>
                <div>參考連結：{wv.references.length ? wv.references.join("、") : "未設定"}</div>
                <div>禁忌事項：{wv.taboos.length ? wv.taboos.join("；") : "未設定"}</div>
                <p className="hint" style={{ marginTop: 4, fontSize: 12 }}>
                  視覺風格與禁忌事項會自動注入每次生成的提示詞；其他欄位供 AI 導演與團隊參考。編輯功能之後開放。
                </p>
              </div>
            </details>
            {updateWv.error && <p className="error">世界觀儲存失敗：{updateWv.error.message}</p>}
          </section>
          </CollabZone>

          {/* 專案知識庫：AI 讀得懂上傳的開示/見證/腳本（願景核心「真的懂我們」） */}
          <div id="sec-knowledge">
            <KnowledgeBase projectId={id} readOnly={!canEdit} />
          </div>

          {/* 角色定裝卡：勾選後生成自動注入外觀錨點 */}
          <h2 id="sec-characters">
            角色定裝卡<HelpTip text="角色長相鎖定，勾了跨鏡頭不走樣。" />
          </h2>
          <CharacterCards projectId={id} selectedIds={charIds} onToggle={toggleChar} />

          {/* 場景設定卡：勾選後生成自動注入色板/光線錨點 */}
          <div id="sec-scenes">
            <ScenePresetCards projectId={id} selectedIds={sceneIds} onToggle={toggleScene} />
          </div>

          {/* 專案權限卡（需求 2.3）：誰可編輯、誰唯讀——開工前定好，屬企劃定盤的一環 */}
          <ProjectMembersCard projectId={id} />

          {/* ② 創作・生成：每天在這裡工作 */}
          <StageHead
            id="stage-create"
            num="②"
            title="創作・生成"
            desc="每天在這裡工作"
            accent="group-2"
            hint={doneGenCount != null ? `已完成 ${doneGenCount} 次生成` : undefined}
          />
          <ProjectAssistant projectId={id} />
          {/* 生成台（11 類 × 旗艦/經濟/最低成本）＝本組主工作台 */}
          <CollabZone {...zoneProps(COLLAB_ZONES.studio)}>
          <section className="card card--primary" data-fb="生成台">
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
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="primary"
                data-fb="生成按鈕"
                disabled={disableReason != null || submit.isPending}
                onClick={() => { setSubmitNotice(""); setConfirming(true); }}
              >
                {!model ? "模型載入中…" : submit.isPending ? "送出中…" : `生成（−${model.points} 點）`}
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
                <p style={{ margin: "8px 0" }}>
                  預估 <b style={{ color: "var(--primary-ink)", fontSize: 18 }}>約 {model.points} 點</b>
                  {quota.data && (
                    <span className="hint" style={{ marginLeft: 8 }}>
                      {quota.data.totalRemaining != null ? `目前剩 ${quota.data.totalRemaining.toLocaleString()} 點` : "額度不限"}
                      {quota.data.weeklyQuota != null ? `・本週 ${quota.data.weeklyUsed}/${quota.data.weeklyQuota}` : ""}
                      {quota.data.dailyQuota != null ? `・今日 ${quota.data.dailyUsed}/${quota.data.dailyQuota}` : ""}
                    </span>
                  )}
                </p>
                {/* 成本審核門檻提醒：組員單筆估點達組長設定的門檻→送出後要等組長核准才會開始生成 */}
                {myRole === "member" &&
                  quota.data?.approvalThreshold != null &&
                  quota.data.approvalThreshold > 0 &&
                  model.points >= quota.data.approvalThreshold && (
                    <p style={{ margin: "4px 0", fontSize: 13, color: "var(--gold-ink)" }}>
                      ⏳ 這筆需要組長核准後才會開始生成（{model.points} 點 ≥ 門檻 {quota.data.approvalThreshold} 點）
                    </p>
                  )}
                <p className="hint" style={{ fontSize: 12 }}>失敗全額退點。真實模式會實際呼叫 AI 生成。</p>
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

          {/* AI 導演建議（會讀取上方知識庫） */}
          <div id="sec-director">
            <DirectorCard projectId={id} onUse={applyDirectorPrompt} />
          </div>

          {/* AI 拆分鏡：貼腳本 → 自動建分鏡草稿 */}
          <div id="sec-split">
            <ScriptSplitCard projectId={id} />
          </div>

          {/* 提示詞庫：成功生成的咒語一鍵再用 */}
          <div id="sec-prompts">
            <PromptLibrary projectId={id} onUse={(text) => setPrompt(text)} />
          </div>

          {/* 工作流（一鍵串鏈） */}
          <div id="sec-workflow">
            <WorkflowCard projectId={id} />
          </div>

          {/* ③ 素材整理：素材集中管理，誤刪可救回 */}
          <StageHead
            id="stage-assets"
            num="③"
            title="素材整理"
            desc="素材集中管理，誤刪可救回"
            accent="group-1"
          />

          {/* 素材庫：上傳參考素材（提案核心「把素材丟進去」的入口）＋生成成品自動入庫 */}
          <CollabZone {...zoneProps(COLLAB_ZONES.assets)}>
            {/* data-fb 讓元件回饋標定「上傳素材」；透明包裹，不影響版面 */}
            <div data-fb="上傳素材" id="sec-assets">
              <AssetLibrary
                projectId={id}
                selectedSourceId={sourceAsset?.id ?? null}
                onPickSource={(a) => { setSourceAsset(a); setSourceUrl(""); setSourceUrlError(""); }}
              />
            </div>
          </CollabZone>

          {/* 回收桶：軟刪除還原（誤刪素材／分鏡可救回） */}
          <div id="sec-recyclebin">
            <RecycleBin projectId={id} />
          </div>

          {/* ④ 分鏡與審核：排片順序、送審與裁決 */}
          <StageHead
            id="stage-review"
            num="④"
            title="分鏡與審核"
            desc="排片、送審"
            accent="group-3"
            hint={pendingSceneCount != null ? `分鏡 ${sceneCount}・待審 ${pendingSceneCount}` : undefined}
          />
          {/* 分鏡列表（含送審；交付打包也在分鏡卡底部） */}
          <CollabZone {...zoneProps(COLLAB_ZONES.scenes)}>
            {/* data-fb 讓元件回饋標定「打包下載」（分鏡與交付區）；透明包裹，不影響版面。id 供引導步驟與交付指引捲動定位 */}
            <div data-fb="打包下載" id="onboard-delivery">
              <h2>
                分鏡・交付<HelpTip text="把成品排成一支片的順序，可送審與打包交付。" />
              </h2>
              <SceneList projectId={id} isLeader={isLeader} canEdit={canEdit} onUsePrompt={(text) => setPrompt(text)} />
            </div>
          </CollabZone>

          {/* ⑤ 交付：打包功能就在上方分鏡卡底部，不為拆而拆——僅於階段標題註明 */}
          <StageHead
            id="stage-deliver"
            num="⑤"
            title="交付"
            desc="分鏡卡內含交付打包"
            accent="group-3"
          />
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
