import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/** 粗剪預覽播放器吃的最小分鏡形狀（來自 scenes.listByProject） */
export type StoryboardPlayerScene = {
  id: string;
  title: string;
  durationSec: number;
  voiceover: string | null;
  assetUrl: string | null;
  assetKind: string | null;
};

/** 每鏡至少停留 1 秒，避免 durationSec 為 0/空時瞬間跳過看不到 */
const clampDur = (s: number) => Math.max(1, Number.isFinite(s) ? s : 0);

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const scene = scenes[Math.min(index, Math.max(0, total - 1))];

  // 分鏡被刪到剩比目前索引少時，把索引夾回範圍內，避免讀到 undefined
  useEffect(() => {
    if (index > total - 1) setIndex(Math.max(0, total - 1));
  }, [total, index]);

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

  // 自動換鏡計時器：只在「播放中＋開啟自動換鏡」時跑，換鏡（index 變）會自動重置
  useEffect(() => {
    if (!playing || !autoAdvance || !scene) return;
    const t = window.setTimeout(autoNext, clampDur(scene.durationSec) * 1000);
    return () => window.clearTimeout(t);
  }, [index, playing, autoAdvance, scene, autoNext]);

  // video 的實際播放/暫停跟隨 playing（換鏡因 key 重掛而重置）
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, index]);

  // 開啟時把焦點放到播放器，讓鍵盤操作立即可用
  useEffect(() => {
    stageRef.current?.focus();
  }, []);

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
      <div style={overlay} role="dialog" aria-modal="true" aria-label="粗剪預覽">
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
      <style>{`@keyframes sbp-fill { from { width: 0%; } to { width: 100%; } }`}</style>

      {/* 頂部：第 i/N 鏡・標題 ＋ 分段進度條 */}
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
          <span className="mono" style={{ color: "#e8a883", fontSize: 14 }}>
            第 {index + 1}/{total} 鏡
          </span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{scene.title}</span>
          <span className="mono" style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>
            {clampDur(scene.durationSec)}s・{kind ?? "無素材"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }} aria-hidden="true">
          {scenes.map((s, i) => (
            <div
              key={s.id}
              style={{
                flex: 1,
                height: 5,
                borderRadius: 999,
                overflow: "hidden",
                background: "rgba(251, 247, 240, 0.2)",
              }}
            >
              <div
                // 目前這鏡用動畫填滿；key 綁 index 讓每次進到本鏡都重跑動畫
                key={i === index ? `cur-${index}` : `seg-${i}`}
                style={{
                  height: "100%",
                  background: "#c2613f",
                  width: i < index ? "100%" : "0%",
                  animation:
                    i === index && playing && autoAdvance
                      ? `sbp-fill ${clampDur(scene.durationSec)}s linear forwards`
                      : "none",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 中央大畫面：image / video / 佔位 */}
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
            <div style={{ fontSize: 40, marginBottom: 10 }}>{kind === "audio" ? "🎵" : "🎬"}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#fbf7f0" }}>{scene.title}</div>
            <div className="mono" style={{ fontSize: 13, marginTop: 6, opacity: 0.8 }}>
              {kind === "audio" ? "配音／音訊鏡" : "尚無素材"}・停留 {clampDur(scene.durationSec)} 秒
            </div>
          </div>
        )}
      </div>

      {/* 底部字幕條：這鏡的配音詞 */}
      <div
        style={{
          width: "min(1000px, 94vw)",
          minHeight: 46,
          marginTop: 12,
          borderRadius: 12,
          background: "rgba(20, 17, 13, 0.72)",
          color: "#fbf7f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "10px 18px",
          textAlign: "center",
          fontSize: 16,
          lineHeight: 1.5,
        }}
      >
        {scene.voiceover ? (
          scene.voiceover
        ) : (
          <span style={{ opacity: 0.5, fontSize: 14 }}>（此鏡無配音）</span>
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
        <button style={btn} onClick={restart} aria-label="重頭播" title="重頭播">
          ↺ 重頭
        </button>
        <button style={btn} onClick={goPrev} disabled={index === 0} aria-label="上一鏡" title="上一鏡（←）">
          ⏮ 上一鏡
        </button>
        <button
          style={{ ...btn, background: "#c2613f", borderColor: "transparent", padding: "10px 22px", fontWeight: 600 }}
          onClick={togglePlay}
          aria-label={playing ? "暫停" : "播放"}
          title="播放／暫停（空白鍵）"
        >
          {playing ? "⏸ 暫停" : "▶ 播放"}
        </button>
        <button
          style={btn}
          onClick={goNext}
          disabled={index >= total - 1}
          aria-label="下一鏡"
          title="下一鏡（→）"
        >
          下一鏡 ⏭
        </button>
        {onClose && (
          <button style={btn} onClick={onClose} aria-label="關閉" title="關閉（Esc）">
            ✕ 關閉
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
