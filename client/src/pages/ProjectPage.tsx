import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
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

/** 專案工作區（F4 簡化版）：世界觀＋生成台＋留言 */
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
  // 「從這裡開始」步驟列用：讀既有查詢判定各步是否完成（與 GenerationList／SceneList 共用快取，不額外增負擔）
  const generations = trpc.generation.listByProject.useQuery({ projectId: id });
  const scenes = trpc.scenes.listByProject.useQuery({ projectId: id });
  /** 引導步驟列收合狀態（全部完成後可整條收起，不佔版面） */
  const [onboardCollapsed, setOnboardCollapsed] = useState(false);
  /** 生成確認彈窗：先估點數、使用者點頭才真的送出、扣點 */
  const [confirming, setConfirming] = useState(false);
  // 帶 groupId（本專案的組）才算得出週/日額度——不帶時 quota.my 的 weeklyQuota 恆為 null，彈窗週用量變死碼
  const quota = trpc.quota.my.useQuery({ groupId: project.data?.groupId }, { enabled: confirming && !!project.data });
  const savePrompt = trpc.prompts.save.useMutation({ onSuccess: () => utils.prompts.list.invalidate({ projectId: id }) });
  const archiveProject = trpc.projects.setArchived.useMutation({
    onSuccess: () => { utils.projects.get.invalidate({ id }); utils.projects.list.invalidate(); },
  });
  const submit = trpc.generation.submit.useMutation({
    onSuccess: (_data, vars) => {
      // 成功生成的提示詞自動入庫（簡報「打過的咒語自動存起來」）
      savePrompt.mutate({ projectId: id, text: vars.prompt });
      setPrompt("");
      setConfirming(false);
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

  const toggle = (field: "tones" | "themes" | "styles", value: string) => {
    const current = wv[field];
    const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
    // 只送有改的欄位；伺服器與現值合併（避免整包覆蓋造成的資料遺失）
    updateWv.mutate({ id, worldview: { [field]: next } });
  };

  /** AI 導演「用這個」：避免默默蓋掉手打的提示詞；套用後把視線帶到生成台提示詞框 */
  const applyDirectorPrompt = (text: string) => {
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
    !model ? "模型清單還在載入，稍等一下就能生成"
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
    // position:relative＋ref：游標座標（x 比例/y px）與覆蓋層都以這個容器為基準
    <div ref={collab.containerRef} onMouseMove={collab.onMouseMove} style={{ position: "relative" }}>
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
          <button
            style={{ padding: "4px 12px", fontSize: 12 }}
            disabled={archiveProject.isPending}
            onClick={() => {
              const to = p.status === "archived";
              if (to || window.confirm(`封存「${p.title}」？封存後會從作業台隱藏，需要時可還原（不會刪除內容）。`)) {
                archiveProject.mutate({ id, archived: !to });
              }
            }}
          >
            {p.status === "archived" ? "還原專案" : "封存專案"}
          </button>
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

      {/* #9 「從這裡開始」步驟列：用實際 state 判定完成打勾，點某步捲到對應區塊 */}
      <section className="card" data-fb="從這裡開始" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b style={{ fontSize: 14 }}>從這裡開始</b>
          <HelpTip text="這是製作一支片的四個步驟。做到哪一步會自動打勾，點步驟可跳到對應區塊。" />
          <span style={{ flex: "1 1 auto" }} />
          {allStepsDone && <span className="chip" style={{ fontSize: 12 }}>全部完成 🎉</span>}
          <button
            style={{ padding: "2px 10px", fontSize: 12 }}
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
                    padding: "8px 12px", borderRadius: 10, cursor: "pointer",
                    border: s.done ? "1px solid var(--primary)" : "1px solid var(--border)",
                    background: s.done ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "transparent",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 22, height: 22, borderRadius: "50%", fontSize: 12, fontWeight: 700,
                      border: s.done ? "none" : "1px solid var(--border)",
                      background: s.done ? "var(--primary)" : "transparent",
                      color: s.done ? "#fff" : "inherit",
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

      <div className="cols">
        <div className="stack">
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
                    marginLeft: 8, fontSize: 13, fontWeight: 400, color: "var(--primary)",
                    opacity: wvSaved === "fading" ? 0 : 1, transition: "opacity 0.6s",
                  }}
                >
                  已儲存 ✓
                </span>
              ) : null}
            </h2>
            <label>一句話故事（logline）</label>
            <input
              defaultValue={wv.logline}
              placeholder="例：陳師姐從憂鬱低谷透過印心佛法走出重生"
              onBlur={(e) => e.target.value !== wv.logline && updateWv.mutate({ id, worldview: { logline: e.target.value } })}
            />
            <label>一句關鍵訊息（一片一訊息）</label>
            <input
              defaultValue={wv.message}
              placeholder="例：把心交給佛，煩惱就交給了光"
              onBlur={(e) => e.target.value !== wv.message && updateWv.mutate({ id, worldview: { message: e.target.value } })}
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
          <KnowledgeBase projectId={id} />

          {/* AI 導演建議（會讀取上方知識庫） */}
          <DirectorCard projectId={id} onUse={applyDirectorPrompt} />

          {/* AI 拆分鏡：貼腳本 → 自動建分鏡草稿 */}
          <ScriptSplitCard projectId={id} />

          {/* 角色定裝卡：勾選後生成自動注入外觀錨點 */}
          <p className="hint" style={{ margin: "0 0 6px", fontSize: 13 }}>
            角色定裝卡<HelpTip text="角色長相鎖定，勾了跨鏡頭不走樣。" />
          </p>
          <CharacterCards projectId={id} selectedIds={charIds} onToggle={toggleChar} />

          {/* 場景設定卡：勾選後生成自動注入色板/光線錨點 */}
          <ScenePresetCards projectId={id} selectedIds={sceneIds} onToggle={toggleScene} />

          {/* 素材庫：上傳參考素材（提案核心「把素材丟進去」的入口）＋生成成品自動入庫 */}
          <CollabZone {...zoneProps(COLLAB_ZONES.assets)}>
            {/* data-fb 讓元件回饋標定「上傳素材」；透明包裹，不影響版面 */}
            <div data-fb="上傳素材">
              <AssetLibrary
                projectId={id}
                selectedSourceId={sourceAsset?.id ?? null}
                onPickSource={(a) => { setSourceAsset(a); setSourceUrl(""); setSourceUrlError(""); }}
              />
            </div>
          </CollabZone>

          {/* 回收桶：素材／分鏡／知識的軟刪除還原（收合式，就近放在素材庫下方） */}
          <RecycleBin projectId={id} />

          {/* 生成台（11 類 × 旗艦/經濟/最低成本） */}
          <CollabZone {...zoneProps(COLLAB_ZONES.studio)}>
          <section className="card" data-fb="生成台">
            <h2>創作生成</h2>
            <ModelPicker onChange={setModel} />
            {model?.needs && (
              <>
                <label>{model.sourceHint ?? "來源素材"}</label>
                {sourceOptions.length > 0 && (
                  <select
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
                    <button style={{ marginLeft: 8, padding: "1px 8px", fontSize: 11 }} onClick={() => setSourceAsset(null)}>
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
            <label>{model?.kind === "audio" && model.needs == null ? "要唸的文字/音樂描述" : "提示詞（世界觀會自動帶入，不必重講背景）"}</label>
            {/* id 是「用這個」等功能捲動聚焦的錨點，別拿掉 */}
            <textarea id="gen-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例：清晨禪堂，柔和光線灑落，一炷香的靜謐" />
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="primary"
                data-fb="生成按鈕"
                disabled={disableReason != null || submit.isPending}
                onClick={() => setConfirming(true)}
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
                  預估 <b style={{ color: "var(--primary)", fontSize: 18 }}>約 {model.points} 點</b>
                  {quota.data && (
                    <span className="hint" style={{ marginLeft: 8 }}>
                      {quota.data.totalRemaining != null ? `目前剩 ${quota.data.totalRemaining.toLocaleString()} 點` : "額度不限"}
                      {quota.data.weeklyQuota != null ? `・本週 ${quota.data.weeklyUsed}/${quota.data.weeklyQuota}` : ""}
                      {quota.data.dailyQuota != null ? `・今日 ${quota.data.dailyUsed}/${quota.data.dailyQuota}` : ""}
                    </span>
                  )}
                </p>
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
            {submit.error && <p className="error">{submit.error.message}</p>}
            <GenerationList projectId={id} />
          </section>
          </CollabZone>

          {/* 提示詞庫：成功生成的咒語一鍵再用 */}
          <PromptLibrary projectId={id} onUse={(text) => setPrompt(text)} />

          {/* 工作流（一鍵串鏈） */}
          <WorkflowCard projectId={id} />

          {/* 分鏡與交付 */}
          <CollabZone {...zoneProps(COLLAB_ZONES.scenes)}>
            {/* data-fb 讓元件回饋標定「打包下載」（分鏡與交付區）；透明包裹，不影響版面。id 供引導步驟與交付指引捲動定位 */}
            <div data-fb="打包下載" id="onboard-delivery">
              <p className="hint" style={{ margin: "0 0 6px", fontSize: 13 }}>
                分鏡・交付<HelpTip text="把成品排成一支片的順序，可送審與打包交付。" />
              </p>
              <SceneList projectId={id} isLeader={isLeader} onUsePrompt={(text) => setPrompt(text)} />
            </div>
          </CollabZone>
        </div>

        {/* 組內留言 */}
        <CollabZone {...zoneProps(COLLAB_ZONES.messages)}>
          <MessagePanel projectId={id} />
        </CollabZone>
      </div>
    </div>
  );
}
