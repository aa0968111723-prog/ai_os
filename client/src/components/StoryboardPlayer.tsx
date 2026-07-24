import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
  /** 逐鏡配音音檔（W5 同步播放；沒有就靜靜跳過） */
  narrationUrl?: string | null;
};

/** 每鏡至少停留 1 秒，避免 durationSec 為 0/空時瞬間跳過看不到 */
const clampDur = (s: number) => Math.max(1, Number.isFinite(s) ? s : 0);

/** 秒數 → m:ss（時間軸經過/總長顯示用） */
const fmtTime = (s: number) => {
  const whole = Math.max(0, Math.round(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** 計時器刻度（秒）：0.2s 夠滑順又不至於每秒 60 次 re-render */
const TICK_SEC = 0.2;

/** 偵測系統「減少動態」偏好：預設就把自動換鏡關掉，讓怕動態的人手動一鏡一鏡看 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/**
 * 粗剪預覽（W5 時間軸模擬）：把分鏡依順序串起來播一次，讓剪輯人員打包前先看整支片的節奏。
 * 純前端、不真合成——image 停 durationSec 秒、video 播完（或播 durationSec）、audio/無素材顯示佔位。
 * - 時間軸：分段寬度與各鏡秒數成比例、可點按跳鏡；顯示 經過/總長。
 * - 同步旁白：這一鏡有配音音檔（narrationUrl）就跟著畫面播；音訊鏡（assetKind=audio）播素材本身。
 * - 過場：換鏡淡入＋圖像鏡緩慢推近（Ken Burns）；系統偏好減少動態時全部關閉。
 */
export function StoryboardPlayer({
  scenes,
  onClose,
}: {
  scenes: StoryboardPlayerScene[];
  onClose?: () => void;
}) {
  const total = scenes.length;
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  // 減少動態偏好：預設不自動換鏡（仍可讓使用者自己勾開）
  const [autoAdvance, setAutoAdvance] = useState(!reducedMotion);
  // 同步播旁白（W5）：預設開；瀏覽器擋自動播音時 play() 會被 catch，使用者按一次播放/暫停即可解鎖
  const [narrationOn, setNarrationOn] = useState(true);
  // 目前這一鏡已播秒數：驅動時間軸填色與經過時間；暫停保留、換鏡歸零
  const [elapsed, setElapsed] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const scene = scenes[Math.min(index, Math.max(0, total - 1))];

  // 分鏡被刪到剩比目前索引少時，把索引夾回範圍內，避免讀到 undefined
  useEffect(() => {
    if (index > total - 1) setIndex(Math.max(0, total - 1));
  }, [total, index]);

  // 換鏡：本鏡計時歸零
  useEffect(() => setElapsed(0), [index]);

  // 自動前進；播到最後一鏡就停（只播一次，不循環）
  const autoNext = useCallback(() => {
    setIndex((cur) => {
      if (cur >= total - 1) {
        setPlaying(false);
        return cur;
      }
      return cur + 1;
    });
  }, [total]);

  // 手動切鏡：夾在 0..N-1，不改變播放/暫停狀態；一律把本鏡計時歸零（點同一鏡＝從頭播，
  // index 沒變不會觸發歸零 effect；有變則與 effect 重複歸零，無害）
  const jumpTo = useCallback((i: number) => {
    setElapsed(0);
    setIndex(Math.max(0, Math.min(total - 1, i)));
  }, [total]);
  const goPrev = useCallback(() => jumpTo(index - 1), [jumpTo, index]);
  const goNext = useCallback(() => jumpTo(index + 1), [jumpTo, index]);
  const restart = useCallback(() => {
    jumpTo(0);
    setPlaying(true);
  }, [jumpTo]);
  const togglePlay = useCallback(() => {
    // 已播到片尾（停在最後一鏡）再按播放＝從頭重播
    if (!playing && index >= total - 1) {
      jumpTo(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  }, [playing, index, total, jumpTo]);

  const dur = scene ? clampDur(scene.durationSec) : 1;

  // 播放中計時：驅動時間軸與經過時間；暫停即停、保留進度（舊版 setTimeout 一暫停就整鏡重來）
  useEffect(() => {
    if (!playing || !scene) return;
    const t = window.setInterval(() => setElapsed((e) => e + TICK_SEC), TICK_SEC * 1000);
    return () => window.clearInterval(t);
  }, [playing, index, scene]);

  // 本鏡播滿：自動換鏡開啟就前進（video 也照 durationSec 切，與舊版一致；提早播完由 onEnded 換）；
  // 關閉自動換鏡則把進度夾在滿格，等使用者手動切
  useEffect(() => {
    if (elapsed < dur) return;
    if (playing && autoAdvance) autoNext();
    else if (elapsed > dur) setElapsed(dur);
  }, [elapsed, dur, playing, autoAdvance, autoNext]);

  // video 的實際播放/暫停跟隨 playing（換鏡因 key 重掛而重置）
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, index]);

  // 旁白音檔跟著畫面走：播放中且開啟旁白才播；暫停/關閉即停（換鏡因 key 重掛從頭播）
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing && narrationOn) a.play().catch(() => {}); // 自動播音被瀏覽器擋下時安靜略過
    else a.pause();
  }, [playing, narrationOn, index]);

  // 開啟時把焦點鎖進播放器（Tab 不外漏）＋鎖背景捲動；關閉後焦點自動還給開啟者
  useFocusTrap(stageRef, true);

  // 鍵盤：空白鍵＝播放/暫停、左右鍵＝切鏡、Esc＝關閉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 焦點在控件上時空白鍵不攔：要能勾「自動換鏡」核取方塊、啟動所聚焦的按鈕
      //（全域無條件 preventDefault 會讓純鍵盤使用者永遠按不動這些控件，違反 WCAG 2.1.1）；
      // Esc 永遠放行（焦點鎖常駐在按鈕上）、方向鍵只讓給文字輸入類控件
      const target = e.target as HTMLElement | null;
      const onControl = !!target?.closest("input, textarea, select, button, a");
      if ((e.code === "Space" || e.key === " ") && !onControl) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight" && !target?.closest("input, textarea, select")) {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" && !target?.closest("input, textarea, select")) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Escape" && onClose) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, goNext, goPrev, onClose]);

  // 可捲動遮罩：矮螢幕（橫向手機/放大字級）總高超過視窗時，內容要捲得到、關閉鈕不能被擠出畫面外。
  // 置中改由內層 wrapper 的 margin:auto 達成——overflow 容器用 justify-content:center 會把
  // 超出的上緣裁到捲不到。
  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(43, 38, 32, 0.92)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "20px",
    boxSizing: "border-box",
    overflowY: "auto",
  };
  const btn: CSSProperties = {
    background: "rgba(251, 247, 240, 0.12)",
    color: "#fbf7f0",
    border: "1px solid rgba(251, 247, 240, 0.28)",
    borderRadius: 999,
    padding: "8px 14px",
    fontSize: 15,
    cursor: "pointer",
    lineHeight: 1,
  };

  if (total === 0 || !scene) {
    return (
      <div style={{ ...overlay, justifyContent: "center" }} role="dialog" aria-modal="true" aria-label="粗剪預覽" ref={stageRef} tabIndex={-1}>
        <p style={{ color: "#fbf7f0", fontSize: 15 }}>還沒有分鏡可以預覽——先加入分鏡再回來看整支片節奏。</p>
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
  // 這一鏡要同步播的音：優先逐鏡配音；音訊鏡（配樂/原音）播素材本身
  const audioSrc = scene.narrationUrl ?? (kind === "audio" ? scene.assetUrl : null);

  // 時間軸總長與經過（各鏡秒數累計；經過＝之前所有鏡＋本鏡進度）
  const totalSec = scenes.reduce((sum, s) => sum + clampDur(s.durationSec), 0);
  const elapsedTotal = scenes.slice(0, index).reduce((sum, s) => sum + clampDur(s.durationSec), 0) + Math.min(elapsed, dur);

  // 過場（reduced motion 全關）：換鏡淡入；圖像鏡在停留期間緩慢推近（Ken Burns，暫停跟著停）
  const fadeAnim = reducedMotion ? undefined : "sbp-fade 0.45s var(--ease-out) both";
  const kenburnsAnim = reducedMotion ? undefined : `sbp-fade 0.45s var(--ease-out) both, sbp-kenburns ${Math.max(dur, 3)}s linear both`;

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
      {/* 常駐關閉鈕：釘在視窗右上角（fixed 不隨遮罩內容捲動），任何螢幕高度都搆得到 */}
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
        @keyframes sbp-kenburns { from { transform: scale(1); } to { transform: scale(1.06); } }
        .sbp-seg { position: relative; padding: 0; border: 0; cursor: pointer; background: rgba(251,247,240,0.2);
          height: 8px; border-radius: 999px; overflow: hidden; min-width: 8px;
          transition: height var(--dur-fast), box-shadow var(--dur-fast); }
        .sbp-seg:hover, .sbp-seg:focus-visible { height: 12px; box-shadow: 0 0 0 2px rgba(251,247,240,0.35); outline: none; }
        .sbp-seg-fill { position: absolute; inset: 0 auto 0 0; background: var(--primary); }
        .sbp-seg-mic { position: absolute; right: 3px; top: 50%; transform: translateY(-50%); width: 4px; height: 4px;
          border-radius: 999px; background: rgba(251,247,240,0.85); }
      `}</style>

      {/* 頂部：第 i/N 鏡・標題・經過/總長 ＋ 時間軸（分段寬度∝秒數、可點跳鏡） */}
      <div style={{ width: "min(1000px, 94vw)", marginBottom: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            color: "#fbf7f0",
            marginBottom: 8,
            flexWrap: "wrap",
          }}
        >
          <span className="mono" style={{ color: "#e8a883", fontSize: "var(--fs-14)" }}>
            第 {index + 1}/{total} 鏡
          </span>
          <span style={{ fontSize: "var(--fs-16)", fontWeight: 600 }}>{scene.title}</span>
          {audioSrc && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--fs-12)", opacity: 0.85 }}>
              <Icon name="Volume2" size={13} />{scene.narrationUrl ? "旁白" : "音訊"}
            </span>
          )}
          <span className="mono" style={{ marginLeft: "auto", fontSize: "var(--fs-12)", opacity: 0.7 }}>
            {fmtTime(elapsedTotal)} / {fmtTime(totalSec)}・{dur}s・{kind ?? "無素材"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }} role="group" aria-label="時間軸（點一段跳到那一鏡）">
          {scenes.map((s, i) => {
            const segDur = clampDur(s.durationSec);
            return (
              <button
                key={s.id}
                className="sbp-seg"
                // 寬度與秒數成比例：一眼看出哪鏡長哪鏡短（W5 時間軸）
                style={{ flexGrow: segDur, flexBasis: 0 }}
                title={`第 ${i + 1} 鏡「${s.title}」・${segDur}s${s.narrationUrl ? "・有旁白" : ""}`}
                aria-label={`跳到第 ${i + 1} 鏡「${s.title}」（${segDur} 秒）`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => jumpTo(i)}
              >
                <span
                  className="sbp-seg-fill"
                  style={{
                    width: i < index ? "100%" : i === index ? `${Math.min(100, (Math.min(elapsed, dur) / dur) * 100)}%` : "0%",
                    // 只在本鏡且以刻度推進時做等速補間，跳鏡/回頭時不要倒著滑
                    transition: i === index && playing ? `width ${TICK_SEC}s linear` : "none",
                  }}
                />
                {s.narrationUrl && <span className="sbp-seg-mic" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 中央大畫面：image / video / 佔位（換鏡淡入；圖像鏡 Ken Burns 緩慢推近） */}
      <div
        style={{
          width: "min(1000px, 94vw)",
          height: "min(58vh, 620px)",
          borderRadius: 16,
          overflow: "hidden",
          background: "#1f1b16",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 18px 50px -20px rgba(0,0,0,0.6)",
        }}
      >
        {hasVisual && kind === "image" && (
          <img
            key={`${scene.id}-${index}`}
            src={scene.assetUrl!}
            alt={scene.title}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              animation: kenburnsAnim,
              animationPlayState: playing ? "running" : "paused",
            }}
          />
        )}
        {hasVisual && kind === "video" && (
          <video
            key={scene.id}
            ref={videoRef}
            src={scene.assetUrl!}
            muted
            autoPlay={playing}
            playsInline
            onEnded={() => {
              if (playing && autoAdvance) autoNext();
            }}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", background: "#000", animation: fadeAnim }}
          />
        )}
        {!hasVisual && (
          <div key={`${scene.id}-ph`} style={{ textAlign: "center", color: "#d9cfc0", padding: 24, animation: fadeAnim }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
              {kind === "audio" ? <Icon name="Music" size={40} /> : <Icon name="Clapperboard" size={40} />}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#fbf7f0" }}>{scene.title}</div>
            <div className="mono" style={{ fontSize: 13, marginTop: 6, opacity: 0.8 }}>
              {kind === "audio" ? "配音／音訊鏡" : "尚無素材"}・停留 {dur} 秒
            </div>
          </div>
        )}
      </div>

      {/* 同步旁白（W5）：key 綁鏡＝換鏡從頭播；播放/暫停/開關由 effect 控制 */}
      {audioSrc && narrationOn && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- 旁白文字已顯示在下方字幕條
        <audio key={`${scene.id}-${index}`} ref={audioRef} src={audioSrc} autoPlay={playing} preload="auto" />
      )}

      {/* 底部字幕條：這鏡的配音詞 */}
      <div
        style={{
          width: "min(1000px, 94vw)",
          minHeight: 46,
          marginTop: 12,
          borderRadius: "var(--r-12)",
          background: "rgba(20, 17, 13, 0.72)",
          color: "#fbf7f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "10px 18px",
          textAlign: "center",
          fontSize: "var(--fs-16)",
          lineHeight: 1.5,
        }}
      >
        {scene.voiceover ? (
          <span key={`${scene.id}-vo`} style={{ animation: fadeAnim }}>{scene.voiceover}</span>
        ) : (
          <span style={{ opacity: 0.5, fontSize: "var(--fs-14)" }}>（此鏡無配音）</span>
        )}
      </div>

      {/* 控制列 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 16,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <button style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={restart} aria-label="重頭播" title="重頭播">
          <Icon name="RotateCcw" size={18} /> 重頭
        </button>
        <button style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={goPrev} disabled={index === 0} aria-label="上一鏡" title="上一鏡（←）">
          <Icon name="SkipBack" size={18} /> 上一鏡
        </button>
        <button
          style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6, background: "var(--primary-solid)", borderColor: "transparent", padding: "10px 22px", fontWeight: 600 }}
          onClick={togglePlay}
          aria-label={playing ? "暫停" : "播放"}
          title="播放／暫停（空白鍵）"
        >
          {playing ? (
            <><Icon name="Pause" size={18} /> 暫停</>
          ) : (
            <><Icon name="Play" size={18} /> 播放</>
          )}
        </button>
        <button
          style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6 }}
          onClick={goNext}
          disabled={index >= total - 1}
          aria-label="下一鏡"
          title="下一鏡（→）"
        >
          下一鏡 <Icon name="SkipForward" size={18} />
        </button>
        {onClose && (
          <button style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={onClose} aria-label="關閉" title="關閉（Esc）">
            <Icon name="X" size={18} /> 關閉
          </button>
        )}
      </div>

      {/* 開關列：自動換鏡（減少動態偏好者預設關）＋同步旁白 */}
      <div style={{ display: "flex", gap: 18, margin: "12px 0 0", flexWrap: "wrap", justifyContent: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#d9cfc0", fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => setAutoAdvance(e.target.checked)}
            style={{ width: "auto" }}
          />
          自動換鏡{reducedMotion ? "（系統偏好減少動態，預設已關閉）" : ""}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#d9cfc0", fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={narrationOn}
            onChange={(e) => setNarrationOn(e.target.checked)}
            style={{ width: "auto" }}
          />
          同步播旁白／音訊
        </label>
      </div>
      </div>
    </div>
  );
}
