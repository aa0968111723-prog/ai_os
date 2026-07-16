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
  /** 該鏡已生成的旁白音檔（有就同步播，W5：粗剪含音檔） */
  narrationUrl?: string | null;
};

/** 每鏡至少停留 1 秒，避免 durationSec 為 0/空時瞬間跳過看不到 */
const clampDur = (s: number) => Math.max(1, Number.isFinite(s) ? s : 0);

/** 秒 → m:ss（時間軸讀數用） */
const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

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
 * 粗剪預覽：把分鏡依順序串起來播一次，讓剪輯人員打包前先看整支片的節奏。
 * 純前端、不真合成——image 停 durationSec 秒、video 播完（或播 durationSec）、audio/無素材顯示佔位。
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
  // W5 時間軸引擎：目前這鏡已播秒數（0.1s 粒度）。取代舊的單發 setTimeout——
  // 有了逐格 elapsed 才做得出「整支片時間讀數＋比例時間軸＋暫停續播不歸零」。
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const scene = scenes[Math.min(index, Math.max(0, total - 1))];

  // 分鏡被刪到剩比目前索引少時，把索引夾回範圍內，避免讀到 undefined
  useEffect(() => {
    if (index > total - 1) setIndex(Math.max(0, total - 1));
  }, [total, index]);

  // 換鏡即歸零這鏡的已播秒數
  useEffect(() => {
    elapsedRef.current = 0;
    setElapsed(0);
  }, [index]);

  // 整支片時間軸：各鏡累計起點與總長（durationSec 變動時重算）
  const durations = scenes.map((s) => clampDur(s.durationSec));
  const totalSec = durations.reduce((a, b) => a + b, 0);
  const startOf = (i: number) => durations.slice(0, i).reduce((a, b) => a + b, 0);
  const globalSec = startOf(index) + Math.min(elapsed, durations[index] ?? 0);

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

  // 手動切鏡：夾在 0..N-1，不改變播放/暫停狀態
  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setIndex((i) => Math.min(total - 1, i + 1)), [total]);
  const restart = useCallback(() => {
    setIndex(0);
    elapsedRef.current = 0;
    setElapsed(0);
    setPlaying(true);
  }, []);
  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      // 已播到片尾（停在最後一鏡）再按播放＝從頭重播
      if (!p && index >= total - 1) {
        setIndex(0);
        return true;
      }
      return !p;
    });
  }, [index, total]);

  // 自動換鏡計時：播放中＋自動換鏡才走錶；暫停保留 elapsed，續播從中斷點接續
  useEffect(() => {
    if (!playing || !autoAdvance || !scene) return;
    const dur = clampDur(scene.durationSec);
    const startedAt = Date.now() - elapsedRef.current * 1000;
    const t = window.setInterval(() => {
      const e = (Date.now() - startedAt) / 1000;
      if (e >= dur) {
        elapsedRef.current = 0;
        setElapsed(0);
        autoNext();
      } else {
        elapsedRef.current = e;
        setElapsed(e);
      }
    }, 100);
    return () => window.clearInterval(t);
    // elapsed 刻意不進依賴：走錶本身在改它，進了會每 0.1 秒重建計時器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, playing, autoAdvance, scene?.id, autoNext]);

  // video 的實際播放/暫停跟隨 playing（換鏡因 key 重掛而重置）
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, index]);

  // W5 旁白音檔：本鏡有 narrationUrl 就同步播（換鏡 key 重掛從頭播；暫停跟著停）
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.play().catch(() => {}); // 行動裝置若擋自動播放，靜默略過（字幕仍在）
    else a.pause();
  }, [playing, index, scene?.narrationUrl]);

  // 開啟時把焦點鎖進播放器（Tab 不外漏）＋鎖背景捲動；關閉後焦點自動還給開啟者
  useFocusTrap(stageRef, true);

  // 鍵盤：空白鍵＝播放/暫停、左右鍵＝切鏡、Esc＝關閉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Escape" && onClose) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, goNext, goPrev, onClose]);

  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(43, 38, 32, 0.92)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    boxSizing: "border-box",
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
      <div style={overlay} role="dialog" aria-modal="true" aria-label="粗剪預覽" ref={stageRef} tabIndex={-1}>
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

  return (
    <div
      style={overlay}
      role="dialog"
      aria-modal="true"
      aria-label="粗剪預覽播放器"
      ref={stageRef}
      tabIndex={-1}
    >
      <style>{`@keyframes sbp-fade { from { opacity: 0; } to { opacity: 1; } }`}</style>

      {/* 頂部：第 i/N 鏡・標題・時間讀數 ＋ 比例時間軸（段寬＝該鏡秒數，可點跳鏡） */}
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
          {scene.narrationUrl && (
            <span className="mono" style={{ fontSize: "var(--fs-12)", opacity: 0.85, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name="Volume2" size={13} /> 旁白
            </span>
          )}
          <span className="mono" style={{ marginLeft: "auto", fontSize: "var(--fs-12)", opacity: 0.7 }}>
            {fmtTime(globalSec)} / {fmtTime(totalSec)}・{clampDur(scene.durationSec)}s・{kind ?? "無素材"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 3 }} role="group" aria-label="時間軸（點段落跳到該鏡）">
          {scenes.map((s, i) => {
            const dur = clampDur(s.durationSec);
            const fill = i < index ? 100 : i === index ? Math.min(100, (elapsed / dur) * 100) : 0;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  elapsedRef.current = 0;
                  setElapsed(0);
                  setIndex(i);
                }}
                title={`第 ${i + 1} 鏡・${s.title}（${fmtTime(startOf(i))} 起・${dur}s）`}
                aria-label={`跳到第 ${i + 1} 鏡：${s.title}`}
                style={{
                  // 段寬與該鏡秒數成正比＝真正的時間軸模擬，一眼看出每鏡佔整支片的比重
                  flex: `${dur} 1 0%`,
                  height: 10,
                  padding: 0,
                  border: i === index ? "1px solid rgba(251,247,240,0.75)" : "1px solid transparent",
                  borderRadius: 999,
                  overflow: "hidden",
                  background: "rgba(251, 247, 240, 0.2)",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    background: "var(--primary)",
                    width: `${fill}%`,
                    transition: playing && i === index ? "width 0.1s linear" : "none",
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* 中央大畫面：image / video / 佔位。key 綁鏡 id＋淡入動畫＝換鏡過場（減少動態偏好者不動畫） */}
      <div
        style={{
          width: "min(1000px, 94vw)",
          height: "min(58vh, 620px)",
          borderRadius: 16,
          overflow: "hidden",
          background: "#1f1b16",
          boxShadow: "0 18px 50px -20px rgba(0,0,0,0.6)",
        }}
      >
        <div
          key={scene.id}
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: reducedMotion ? "none" : "sbp-fade 0.45s ease",
          }}
        >
          {hasVisual && kind === "image" && (
            <img
              src={scene.assetUrl!}
              alt={scene.title}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
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
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", background: "#000" }}
            />
          )}
          {!hasVisual && (
            <div style={{ textAlign: "center", color: "#d9cfc0", padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                {kind === "audio" ? <Icon name="Music" size={40} /> : <Icon name="Clapperboard" size={40} />}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "#fbf7f0" }}>{scene.title}</div>
              <div className="mono" style={{ fontSize: 13, marginTop: 6, opacity: 0.8 }}>
                {kind === "audio" ? "配音／音訊鏡" : "尚無素材"}・停留 {clampDur(scene.durationSec)} 秒
              </div>
            </div>
          )}
        </div>
      </div>

      {/* W5 旁白音檔：本鏡有已生成旁白就同步播（換鏡 key 重掛從頭播；不顯示控制條，時間軸統一指揮） */}
      {scene.narrationUrl && (
        <audio key={scene.id} ref={audioRef} src={scene.narrationUrl} autoPlay={playing} preload="auto" />
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
          scene.voiceover
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

      {/* 自動換鏡開關：減少動態偏好者預設關閉，可手動一鏡一鏡看 */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          margin: "12px 0 0",
          color: "#d9cfc0",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={autoAdvance}
          onChange={(e) => setAutoAdvance(e.target.checked)}
          style={{ width: "auto" }}
        />
        自動換鏡{reducedMotion ? "（系統偏好減少動態，預設已關閉）" : ""}
      </label>
    </div>
  );
}
