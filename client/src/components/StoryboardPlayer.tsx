import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  TIMELINE_FPS,
  framesToSec,
  layoutTimeline,
  secToFrames,
  sourceInFrames,
  type Frames,
} from "@shared/timeline";
import { resolutionForFormat } from "@shared/options";
import { detectRenderSupport } from "../features/preview-render/capability";
import { buildRenderPlan, renderPlanBlocker } from "../features/preview-render/renderPlan";
import { Icon } from "./Icon";
import { useFocusTrap } from "./interactions";

/** 粗剪預覽播放器吃的最小分鏡形狀（來自 scenes.listByProject） */
export type StoryboardPlayerScene = {
  id: string;
  title: string;
  durationSec: number;
  voiceover: string | null;
  assetUrl: string | null;
  assetKind: string | null;
  /** 逐鏡配音音檔（同步播放；沒有就靜靜跳過） */
  narrationUrl?: string | null;
  /** 逐鏡環境音；預覽時不播（會蓋掉旁白），但輸出 MP4 時混進去 */
  ambienceUrl?: string | null;
  /** 畫面素材來源入點（毫秒）；語義見 shared/timeline.ts 的 ShotSource */
  trimStartMs?: number | null;
  /** 畫面素材來源出點（毫秒）；null＝未修剪 */
  trimEndMs?: number | null;
};

/** 播放頭 → m:ss.ff（ff＝影格）。剪輯台要看得到影格，不然標入出點只能靠猜。 */
function fmtTimecode(frames: Frames): string {
  const safe = Math.max(0, Math.round(frames));
  const totalSec = Math.floor(safe / TIMELINE_FPS);
  const ff = safe % TIMELINE_FPS;
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}.${String(ff).padStart(2, "0")}`;
}

/** 毫秒 ← 影格（寫回修剪欄位用；欄位是整數毫秒） */
const framesToMs = (frames: Frames) => Math.round((frames * 1000) / TIMELINE_FPS);

/**
 * 播放刻度（秒）。0.1s＝3 影格：夠滑順又不至於每秒 30 次 re-render。
 * 鍵盤步進不走這個刻度，是精確的 ±1 影格——標入出點必須點得準。
 */
const TICK_SEC = 0.1;

/** 影片實際播放位置與播放頭差超過這個秒數就重新對位（正常播放時的自然漂移不必每格都糾正） */
const RESYNC_TOLERANCE_SEC = 0.35;

/** 偵測系統「減少動態」偏好：預設就把自動播放關掉，讓怕動態的人自己控制 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/**
 * 粗剪預覽台：把分鏡串成一條可拖曳的時間軸，讓人在打包前先看整支片的節奏、順手剪掉不要的段落。
 *
 * 與前一版的關鍵差別是**狀態模型**：先前是「第幾鏡 ＋ 鏡內經過秒數」，那個模型天生做不到
 * 全片 scrub——拖到片子 60% 的位置得先反推是第幾鏡、再反推鏡內偏移，兩份狀態很快就會不同步。
 * 現在只有一個全域播放頭（`posFrames`），鏡次與鏡內偏移都是從它算出來的衍生值。
 *
 * 時間全部走 `shared/timeline.ts` 的影格排版，與交付包（fcpxml／xmeml／srt／edl／剪映）同源：
 * 預覽裡看到的切點，就是交付出去的切點。
 *
 * - 畫面框依專案比例（16:9／9:16／1:1）letterbox，字幕與安全框畫在這個框上——
 *   看到的構圖就是輸出的構圖，不是被瀏覽器視窗形狀決定的。
 * - 標入出點（I／O）直接寫回該鏡的修剪欄位：播到想要的地方按 I、再按 O，初稿就剪好了。
 */
export function StoryboardPlayer({
  scenes,
  format,
  onClose,
  onTrim,
}: {
  scenes: StoryboardPlayerScene[];
  /** 專案比例（16:9／9:16／1:1）；決定畫面框與安全框形狀。未給＝橫式 */
  format?: string | null;
  onClose?: () => void;
  /** 標入出點時寫回修剪欄位；未給＝唯讀預覽（I／O 不啟用） */
  onTrim?: (sceneId: string, patch: { trimStartMs?: number; trimEndMs?: number | null }) => void;
}) {
  const total = scenes.length;
  const reducedMotion = usePrefersReducedMotion();
  const [posFrames, setPosFrames] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [narrationOn, setNarrationOn] = useState(true);
  const [safeGuides, setSafeGuides] = useState(false);
  // 素材檔遺失（後端 404）時的優雅降級：記住載入失敗的 URL，改渲染「此鏡素材遺失」佔位，
  // 讓預覽照常前進並明確告知，不再是一張大破圖停留整鏡。
  // ⚠️ 所有 hook 必須放在「沒有分鏡」那個早退之前——否則 0 鏡→有鏡的轉換會讓 hook 數量改變，
  // React 直接丟 #310，整個預覽掛掉。
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  // 使用者主動移動播放頭（拖曳／鍵盤／點分段）時要強制影片對位；正常播放的自然漂移則容忍
  const [seekNonce, setSeekNonce] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // 時間軸排版：與交付包同一份規則（含修剪）
  const layout = useMemo(() => layoutTimeline(scenes), [scenes]);
  const totalFrames = layout.totalFrames;

  // 播放頭 → 第幾鏡。夾在最後一鏡內，讓播到片尾時仍停在最後一格畫面而不是變成空白。
  const index = useMemo(() => {
    if (layout.shots.length === 0) return 0;
    const at = Math.min(posFrames, Math.max(0, totalFrames - 1));
    const found = layout.shots.findIndex((s) => at >= s.startFrames && at < s.endFrames);
    return found >= 0 ? found : layout.shots.length - 1;
  }, [layout, posFrames, totalFrames]);

  const shot = layout.shots[index];
  const scene = scenes[index];
  // 這一鏡已播到第幾影格（鏡內偏移）——由全域播放頭推出來，不另存一份狀態
  const localFrames = shot ? Math.max(0, Math.min(posFrames - shot.startFrames, shot.durationFrames)) : 0;

  /** 移動播放頭（夾在片長內）；一律標記為「使用者移動」以觸發影片對位 */
  const seekTo = useCallback((frames: Frames) => {
    setPosFrames(Math.max(0, Math.min(Math.round(frames), Math.max(0, totalFrames))));
    setSeekNonce((n) => n + 1);
  }, [totalFrames]);

  const nudge = useCallback((deltaFrames: number) => {
    setPlaying(false);
    seekTo(posFrames + deltaFrames);
  }, [seekTo, posFrames]);

  const jumpToShot = useCallback((i: number) => {
    const target = layout.shots[Math.max(0, Math.min(layout.shots.length - 1, i))];
    if (target) seekTo(target.startFrames);
  }, [layout, seekTo]);

  const togglePlay = useCallback(() => {
    // 已播到片尾再按播放＝從頭重播
    if (!playing && posFrames >= totalFrames) {
      seekTo(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  }, [playing, posFrames, totalFrames, seekTo]);

  // 播放：每刻度推進播放頭；到片尾停住（只播一次，不循環）
  useEffect(() => {
    if (!playing || totalFrames === 0) return;
    const step = Math.max(1, Math.round(TICK_SEC * TIMELINE_FPS));
    const t = window.setInterval(() => {
      setPosFrames((cur) => {
        const next = cur + step;
        if (next >= totalFrames) {
          setPlaying(false);
          return totalFrames;
        }
        return next;
      });
    }, TICK_SEC * 1000);
    return () => window.clearInterval(t);
  }, [playing, totalFrames]);

  // 影片播放／暫停跟隨狀態（換鏡因 key 重掛而重置）
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, index]);

  // 旁白跟著畫面走；暫停／關閉即停
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing && narrationOn) a.play().catch(() => {}); // 自動播音被瀏覽器擋下時安靜略過
    else a.pause();
  }, [playing, narrationOn, index]);

  // 影片對位：素材上的目標位置＝該鏡來源入點＋鏡內偏移。
  // 使用者移動播放頭時一定重設；正常播放時只在漂移超過容忍值才糾正，否則每刻度 seek 會一直卡頓。
  // metadata 未載入時 currentTime 設不進去，所以 loadedmetadata 也要再對一次。
  const targetSourceSec = scene && shot ? framesToSec(sourceInFrames(scene) + localFrames) : 0;
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const align = () => {
      if (Math.abs(v.currentTime - targetSourceSec) > RESYNC_TOLERANCE_SEC) v.currentTime = targetSourceSec;
    };
    align();
    v.addEventListener("loadedmetadata", align);
    return () => v.removeEventListener("loadedmetadata", align);
    // targetSourceSec 每刻度都會變，但 align 內含容忍值，不會每次都真的 seek
  }, [targetSourceSec, seekNonce, index]);

  // 旁白對位：旁白是為整鏡生成的，從鏡頭開始算，不套畫面的修剪入點
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const want = framesToSec(localFrames);
    if (Math.abs(a.currentTime - want) > RESYNC_TOLERANCE_SEC) a.currentTime = want;
  }, [seekNonce, index, localFrames]);

  // ── 標入出點：把播放頭寫回該鏡的修剪欄位 ──────────────────────────
  // 播放頭在時間軸上，修剪點在素材上，兩者差一個「該鏡起點」的位移。
  const sourceAtPlayhead = scene && shot ? sourceInFrames(scene) + localFrames : 0;
  const canTrim = !!onTrim && !!scene && !!shot && scene.assetKind === "video";

  const markIn = useCallback(() => {
    if (!canTrim || !scene || !shot) return;
    // 入點必須早於出點，否則是零長度剪輯
    if (sourceAtPlayhead >= shot.sourceOutFrames) return;
    // 先把出點固化成目前的實際出點：出點還是 null 時鏡長會退回 durationSec，
    // 只改入點會變成「開頭往後挪、長度不變」——那不是剪掉頭，是整段位移。
    onTrim!(scene.id, {
      trimStartMs: framesToMs(sourceAtPlayhead),
      trimEndMs: framesToMs(shot.sourceOutFrames),
    });
  }, [canTrim, scene, shot, sourceAtPlayhead, onTrim]);

  const markOut = useCallback(() => {
    if (!canTrim || !scene || !shot) return;
    if (sourceAtPlayhead <= shot.sourceInFrames) return;
    onTrim!(scene.id, { trimEndMs: framesToMs(sourceAtPlayhead) });
  }, [canTrim, scene, shot, sourceAtPlayhead, onTrim]);

  // ── 輸出 MP4（給夥伴看用的預覽畫質；精修仍走交付包） ──────────────
  // mediabunny 只在真的按下輸出時才載入：它是整包裡最大的相依之一，
  // 而大多數人開預覽台只是想看節奏，不該為此多背一份 bundle。
  const [render, setRender] = useState<
    { state: "idle" } | { state: "running"; label: string; pct: number } | { state: "error"; message: string }
  >({ state: "idle" });
  const renderAbort = useRef<AbortController | null>(null);

  const exportMp4 = useCallback(async () => {
    const plan = buildRenderPlan(scenes, format);
    const blocked = renderPlanBlocker(plan);
    if (blocked) {
      setRender({ state: "error", message: blocked });
      return;
    }
    setPlaying(false);
    setRender({ state: "running", label: "檢查瀏覽器支援", pct: 0 });
    try {
      const support = await detectRenderSupport(plan.width, plan.height);
      if (!support.ok) {
        setRender({ state: "error", message: support.reason });
        return;
      }
      const { renderTimelineToMp4 } = await import("../features/preview-render/renderTimeline");
      const ac = new AbortController();
      renderAbort.current = ac;
      const blob = await renderTimelineToMp4(plan, {
        codecs: support.codecs,
        signal: ac.signal,
        onProgress: (p) => {
          const label = p.phase === "audio" ? "混音" : p.phase === "video" ? "算圖" : "收檔";
          setRender({ state: "running", label, pct: p.total > 0 ? p.done / p.total : 0 });
        },
      });
      // 直接觸發下載：這支片是要傳給夥伴的，留在頁面上沒有意義
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "粗剪預覽.mp4";
      a.click();
      URL.revokeObjectURL(url);
      setRender(
        support.codecs.audio
          ? { state: "idle" }
          : { state: "error", message: "已輸出，但這個瀏覽器編不動任何音訊格式，成品沒有聲音。要有聲請改用 Chrome／Edge，或走交付包。" },
      );
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") {
        setRender({ state: "idle" });
        return;
      }
      setRender({ state: "error", message: err instanceof Error ? err.message : "輸出失敗。" });
    } finally {
      renderAbort.current = null;
    }
  }, [scenes, format]);

  // 關閉預覽台時中止還在跑的輸出——不然編碼器會在背景繼續吃 CPU 直到分頁關掉
  useEffect(() => () => renderAbort.current?.abort(), []);

  // 開啟時把焦點鎖進播放器（Tab 不外漏）＋鎖背景捲動；關閉後焦點自動還給開啟者
  useFocusTrap(stageRef, true);

  // ── 鍵盤：剪輯台慣用鍵位 ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 焦點在控件上時空白鍵不攔：要能勾核取方塊、啟動所聚焦的按鈕
      //（全域無條件 preventDefault 會讓純鍵盤使用者永遠按不動這些控件，違反 WCAG 2.1.1）
      // 事件目標不一定是元素——focus 在 document／window 上時 e.target 沒有 closest，
      // 直接呼叫會丟 TypeError 並讓整組鍵盤操作失效。先確認型別再問。
      const target = e.target instanceof Element ? e.target : null;
      const onControl = !!target?.closest("input, textarea, select, button, a");
      const inText = !!target?.closest("input, textarea, select");
      if ((e.code === "Space" || e.key === " ") && !onControl) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight" && !inText) {
        e.preventDefault();
        nudge(e.shiftKey ? TIMELINE_FPS : 1); // Shift＝一秒，否則一格
      } else if (e.key === "ArrowLeft" && !inText) {
        e.preventDefault();
        nudge(e.shiftKey ? -TIMELINE_FPS : -1);
      } else if ((e.key === "l" || e.key === "L") && !inText) {
        e.preventDefault();
        setPlaying(true);
      } else if ((e.key === "k" || e.key === "K") && !inText) {
        e.preventDefault();
        setPlaying(false);
      } else if ((e.key === "j" || e.key === "J") && !inText) {
        // J 在專業機器上是倒帶；這裡是預覽台，倒退一秒比倒放實用且不會與影片解碼打架
        e.preventDefault();
        nudge(-TIMELINE_FPS);
      } else if ((e.key === "i" || e.key === "I") && !inText) {
        e.preventDefault();
        markIn();
      } else if ((e.key === "o" || e.key === "O") && !inText) {
        e.preventDefault();
        markOut();
      } else if (e.key === "Home" && !inText) {
        e.preventDefault();
        seekTo(0);
      } else if (e.key === "End" && !inText) {
        e.preventDefault();
        seekTo(totalFrames);
      } else if (e.key === "Escape" && onClose) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, nudge, markIn, markOut, seekTo, totalFrames, onClose]);

  // ── 時間軸拖曳（scrub）：整條軌都是可拖曳區，不是一鏡一顆按鈕 ──────
  const seekFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el || totalFrames === 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekTo(Math.round(ratio * totalFrames));
  }, [seekTo, totalFrames]);

  const onTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setPlaying(false);
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  }, [seekFromClientX]);

  const onTrackPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekFromClientX(e.clientX);
  }, [seekFromClientX]);

  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(28, 25, 23, 0.92)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "20px",
    boxSizing: "border-box",
    overflowY: "auto",
  };
  const btn: CSSProperties = {
    background: "rgba(250, 249, 247, 0.12)",
    color: "#faf9f7",
    border: "1px solid rgba(250, 249, 247, 0.28)",
    borderRadius: 999,
    padding: "8px 14px",
    fontSize: 15,
    cursor: "pointer",
    lineHeight: 1,
  };

  const res = resolutionForFormat(format);

  if (total === 0 || !scene || !shot) {
    return (
      <div style={{ ...overlay, justifyContent: "center" }} role="dialog" aria-modal="true" aria-label="粗剪預覽" ref={stageRef} tabIndex={-1}>
        <p style={{ color: "#faf9f7", fontSize: 15 }}>還沒有分鏡可以預覽——先加入分鏡再回來看整支片節奏。</p>
        {onClose && (
          <button style={{ ...btn, marginTop: 16 }} onClick={onClose}>
            關閉
          </button>
        )}
      </div>
    );
  }

  const kind = scene.assetKind;
  const hasVisual = !!scene.assetUrl && (kind === "image" || kind === "video");
  const assetBroken = hasVisual && scene.assetUrl === brokenUrl;
  // 這一鏡要同步播的音：優先逐鏡配音；音訊鏡（配樂/原音）播素材本身
  const audioSrc = scene.narrationUrl ?? (kind === "audio" ? scene.assetUrl : null);
  const fadeAnim = reducedMotion ? undefined : "sbp-fade 0.45s var(--ease-out) both";
  const trimmed = sourceInFrames(scene) > 0 || (scene.trimEndMs != null);

  return (
    <div
      style={overlay}
      role="dialog"
      aria-modal="true"
      aria-label="粗剪預覽播放器"
      ref={stageRef}
      tabIndex={-1}
      // 觸控退路：點暗背景即關（手機沒有 Esc 鍵；控制列的關閉鈕在矮螢幕可能被擠到捲動範圍外）
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      {onClose && (
        <button
          style={{ ...btn, position: "fixed", top: 14, right: 14, zIndex: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, padding: 0 }}
          onClick={onClose}
          aria-label="關閉預覽"
          title="關閉（Esc）"
        >
          <Icon name="X" size={18} />
        </button>
      )}
      <div
        style={{ margin: "auto", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}
        onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
      >
      <style>{`
        @keyframes sbp-fade { from { opacity: 0; } to { opacity: 1; } }
        .sbp-track { position: relative; height: 26px; display: flex; gap: 3px; align-items: center;
          cursor: pointer; touch-action: none; }
        .sbp-seg { position: relative; height: 8px; border-radius: 999px; overflow: hidden;
          background: rgba(250,249,247,0.2); min-width: 6px; pointer-events: none; }
        .sbp-seg[data-current="true"] { height: 12px; }
        .sbp-seg-fill { position: absolute; inset: 0 auto 0 0; background: var(--primary); }
        .sbp-seg-trim { position: absolute; inset: 0; border: 1px dashed rgba(255,171,107,0.9); border-radius: 999px; }
        .sbp-seg-mic { position: absolute; right: 3px; top: 50%; transform: translateY(-50%); width: 4px; height: 4px;
          border-radius: 999px; background: rgba(250,249,247,0.85); }
        .sbp-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #ffab6b;
          pointer-events: none; box-shadow: 0 0 6px rgba(255,171,107,0.8); }
        .sbp-safe { position: absolute; border: 1px solid rgba(255,255,255,0.35); pointer-events: none; }
        .sbp-safe-title { border-style: dashed; border-color: rgba(255,171,107,0.6); }
      `}</style>

      {/* 頂部：第 i/N 鏡・標題・影格時間碼 */}
      <div style={{ width: "min(1000px, 94vw)", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, color: "#faf9f7", marginBottom: 8, flexWrap: "wrap" }}>
          <span className="mono" style={{ color: "#ffab6b", fontSize: "var(--fs-14)" }}>
            第 {index + 1}/{total} 鏡
          </span>
          <span style={{ fontSize: "var(--fs-16)", fontWeight: 600 }}>{scene.title}</span>
          {trimmed && (
            <span className="mono" style={{ fontSize: "var(--fs-12)", color: "#ffab6b" }} title="這一鏡已修剪">
              已修剪
            </span>
          )}
          {audioSrc && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--fs-12)", opacity: 0.85 }}>
              <Icon name="Volume2" size={13} />{scene.narrationUrl ? "旁白" : "音訊"}
            </span>
          )}
          <span className="mono" style={{ marginLeft: "auto", fontSize: "var(--fs-12)", opacity: 0.75 }}>
            {fmtTimecode(posFrames)} / {fmtTimecode(totalFrames)}・{kind ?? "無素材"}
          </span>
        </div>

        {/* 時間軸：整條可拖曳（scrub）。分段只是視覺刻度，指標事件全交給軌道本身處理，
            否則拖到分段邊界會被子元素攔截、播放頭跳一下。 */}
        <div
          ref={trackRef}
          className="sbp-track"
          role="slider"
          tabIndex={0}
          aria-label="時間軸播放頭（左右鍵一格、Shift＋左右鍵一秒）"
          aria-valuemin={0}
          aria-valuemax={totalFrames}
          aria-valuenow={posFrames}
          aria-valuetext={`${fmtTimecode(posFrames)}，第 ${index + 1} 鏡`}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
        >
          {layout.shots.map((s, i) => {
            const sc = scenes[i];
            const filled = posFrames >= s.endFrames ? 1 : posFrames <= s.startFrames ? 0 : (posFrames - s.startFrames) / s.durationFrames;
            return (
              <div
                key={sc.id}
                className="sbp-seg"
                data-current={i === index ? "true" : "false"}
                style={{ flexGrow: s.durationFrames, flexBasis: 0 }}
                title={`第 ${i + 1} 鏡「${sc.title}」・${framesToSec(s.durationFrames)}s${sc.narrationUrl ? "・有旁白" : ""}`}
              >
                <span className="sbp-seg-fill" style={{ width: `${filled * 100}%` }} />
                {(sourceInFrames(sc) > 0 || sc.trimEndMs != null) && <span className="sbp-seg-trim" aria-hidden="true" />}
                {sc.narrationUrl && <span className="sbp-seg-mic" aria-hidden="true" />}
              </div>
            );
          })}
          <span
            className="sbp-playhead"
            aria-hidden="true"
            style={{ left: `${totalFrames > 0 ? Math.min(100, (posFrames / totalFrames) * 100) : 0}%` }}
          />
        </div>
      </div>

      {/* 畫面框：依專案比例 letterbox——看到的構圖就是輸出的構圖 */}
      <div
        style={{
          position: "relative",
          width: "min(1000px, 94vw)",
          maxHeight: "min(58vh, 620px)",
          aspectRatio: `${res.width} / ${res.height}`,
          margin: "0 auto",
          borderRadius: 16,
          overflow: "hidden",
          background: "#0d0c0b",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 18px 50px -20px rgba(0,0,0,0.6)",
        }}
      >
        {hasVisual && !assetBroken && kind === "image" && (
          <img
            key={`${scene.id}-img`}
            src={scene.assetUrl!}
            alt={scene.title}
            onError={() => setBrokenUrl(scene.assetUrl!)}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", animation: fadeAnim }}
          />
        )}
        {hasVisual && !assetBroken && kind === "video" && (
          <video
            key={scene.id}
            ref={videoRef}
            src={scene.assetUrl!}
            muted
            playsInline
            preload="auto"
            onError={() => setBrokenUrl(scene.assetUrl!)}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", background: "#000", animation: fadeAnim }}
          />
        )}
        {(!hasVisual || assetBroken) && (
          <div key={`${scene.id}-ph`} style={{ textAlign: "center", color: "#d2cfca", padding: 24, animation: fadeAnim }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
              {assetBroken ? <Icon name="XCircle" size={40} /> : kind === "audio" ? <Icon name="Music" size={40} /> : <Icon name="Clapperboard" size={40} />}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#faf9f7" }}>{scene.title}</div>
            <div className="mono" style={{ fontSize: 13, marginTop: 6, opacity: 0.8 }}>
              {assetBroken ? "此鏡素材遺失——回分鏡「重生這一格」可補回" : kind === "audio" ? "配音／音訊鏡" : "尚無素材"}
            </div>
          </div>
        )}

        {/* 安全框：外框＝動作安全（93%）、虛線＝標題安全（90%），廣電慣例。
            重要的字放進虛線內，各家播放器裁切都不會吃掉。 */}
        {safeGuides && (
          <>
            <span className="sbp-safe" style={{ inset: "3.5%" }} aria-hidden="true" />
            <span className="sbp-safe sbp-safe-title" style={{ inset: "5%" }} aria-hidden="true" />
          </>
        )}

        {/* 字幕疊在畫面上（不是畫面下方另一條）：交付的 SRT 燒進去就是這個位置，
            預覽台要讓人看到字會不會壓到畫面主體。 */}
        {scene.voiceover && (
          <div
            key={`${scene.id}-vo`}
            style={{
              position: "absolute",
              left: "8%",
              right: "8%",
              bottom: "7%",
              textAlign: "center",
              color: "#fff",
              fontSize: "clamp(14px, 2.2vw, 22px)",
              lineHeight: 1.45,
              textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)",
              animation: fadeAnim,
              pointerEvents: "none",
            }}
          >
            {scene.voiceover}
          </div>
        )}
      </div>

      {/* 同步旁白：key 綁鏡＝換鏡重掛；播放/暫停/對位由 effect 控制 */}
      {audioSrc && narrationOn && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- 旁白文字已疊在畫面上
        <audio key={`${scene.id}-audio`} ref={audioRef} src={audioSrc} preload="auto" />
      )}

      {/* 控制列 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap", justifyContent: "center" }}>
        <button style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => { seekTo(0); setPlaying(true); }} aria-label="重頭播" title="重頭播（Home）">
          <Icon name="RotateCcw" size={18} /> 重頭
        </button>
        <button style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => jumpToShot(index - 1)} disabled={index === 0} aria-label="上一鏡" title="上一鏡">
          <Icon name="SkipBack" size={18} /> 上一鏡
        </button>
        <button
          style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6, background: "var(--primary-solid)", borderColor: "transparent", padding: "10px 22px", fontWeight: 600 }}
          onClick={togglePlay}
          aria-label={playing ? "暫停" : "播放"}
          title="播放／暫停（空白鍵；L 播、K 停）"
        >
          {playing ? (<><Icon name="Pause" size={18} /> 暫停</>) : (<><Icon name="Play" size={18} /> 播放</>)}
        </button>
        <button style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => jumpToShot(index + 1)} disabled={index >= total - 1} aria-label="下一鏡" title="下一鏡">
          下一鏡 <Icon name="SkipForward" size={18} />
        </button>
      </div>

      {/* 修剪列：播到想要的地方按 I／O，初稿就剪好了。非影片鏡沒有「取素材哪一段」可言，按鈕停用。 */}
      {onTrim && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button style={{ ...btn, padding: "6px 12px", fontSize: 13 }} onClick={markIn} disabled={!canTrim} aria-label="標記修剪起點" title="把播放頭設為這一鏡的修剪起點（I）">
            標入點 I
          </button>
          <button style={{ ...btn, padding: "6px 12px", fontSize: 13 }} onClick={markOut} disabled={!canTrim} aria-label="標記修剪結束點" title="把播放頭設為這一鏡的修剪結束點（O）">
            標出點 O
          </button>
          <button
            style={{ ...btn, padding: "6px 12px", fontSize: 13 }}
            onClick={() => scene && onTrim(scene.id, { trimStartMs: 0, trimEndMs: null })}
            disabled={!canTrim || !trimmed}
            aria-label="取消這一鏡的修剪"
            title="取消這一鏡的修剪"
          >
            取消修剪
          </button>
          <span className="mono" style={{ color: "#d2cfca", fontSize: 12 }}>
            {canTrim ? `素材位置 ${fmtTimecode(sourceAtPlayhead)}` : "此鏡不是影片，無法修剪"}
          </span>
        </div>
      )}

      {/* 輸出 MP4：給夥伴看用的預覽畫質。精修仍走交付包（見研究報告定案） */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap", justifyContent: "center", maxWidth: "min(1000px, 94vw)" }}>
        {render.state === "running" ? (
          <>
            <span className="mono" style={{ color: "#faf9f7", fontSize: 13 }}>
              {render.label} {Math.round(render.pct * 100)}%
            </span>
            <button style={{ ...btn, padding: "6px 12px", fontSize: 13 }} onClick={() => renderAbort.current?.abort()}>
              取消輸出
            </button>
          </>
        ) : (
          <button
            style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px" }}
            onClick={exportMp4}
            aria-label="輸出 MP4"
            title="在本機算成一支 MP4（預覽畫質，方便傳給夥伴看）"
          >
            <Icon name="Download" size={16} /> 輸出 MP4
          </button>
        )}
        {render.state === "error" && (
          <span role="status" style={{ color: "#ffab6b", fontSize: 13, maxWidth: 620, lineHeight: 1.5 }}>
            {render.message}
          </span>
        )}
      </div>

      {/* 開關列 */}
      <div style={{ display: "flex", gap: 18, margin: "12px 0 0", flexWrap: "wrap", justifyContent: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#d2cfca", fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={narrationOn} onChange={(e) => setNarrationOn(e.target.checked)} style={{ width: "auto" }} />
          同步播旁白／音訊
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#d2cfca", fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={safeGuides} onChange={(e) => setSafeGuides(e.target.checked)} style={{ width: "auto" }} />
          安全框
        </label>
        <span className="mono" style={{ color: "#8f8a85", fontSize: 12 }}>
          空白＝播停・←→＝一格・Shift＋←→＝一秒・I／O＝標入出點
        </span>
      </div>
      </div>
    </div>
  );
}
