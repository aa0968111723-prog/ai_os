/**
 * 遺失素材的優雅佔位（後端對實體檔遺失回 404 後的前端配套）：
 * DB 還有記錄（url 非 null）但檔案已遺失（例如存在非持久磁碟、伺服器重新部署後不見）時，
 * <img>/<video>/<audio> 載入必失敗——沒有 onError 就是一顆瀏覽器破圖 icon，
 * 使用者無從分辨「系統壞了」還是「素材遺失需重生」。這裡提供帶 onError 佔位的共用包裝，
 * 素材庫／分鏡列／粗剪預覽／生成紀錄／參考圖等處統一使用，遺失與未生成兩種狀態視覺可區分。
 */
import { useEffect, useState } from "react";
import type { CSSProperties, ImgHTMLAttributes, VideoHTMLAttributes, AudioHTMLAttributes } from "react";
import { Icon } from "./Icon";

/** 遺失佔位方塊：icon＋一句話，尺寸交由呼叫端配合原媒體的版位 */
export function MissingMediaBox({
  label = "素材遺失",
  height = 96,
  iconSize = 20,
  style,
  className,
}: {
  label?: string;
  height?: number | string;
  iconSize?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        width: "100%",
        height,
        background: "var(--muted)",
        borderRadius: 8,
        ...style,
      }}
    >
      <Icon name="XCircle" size={iconSize} />
      <span className="hint" style={{ fontSize: 11 }}>{label}</span>
    </div>
  );
}

type FallbackProps = { fallbackLabel?: string; fallbackHeight?: number | string; fallbackIconSize?: number; fallbackStyle?: CSSProperties; fallbackClassName?: string };

/** <img> 包裝：載入失敗改渲染「素材遺失」佔位；src 更換（重生成）時自動重試 */
export function AssetImg(props: ImgHTMLAttributes<HTMLImageElement> & FallbackProps) {
  const { fallbackLabel, fallbackHeight, fallbackIconSize, fallbackStyle, fallbackClassName, ...img } = props;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [img.src]);
  if (failed) return <MissingMediaBox label={fallbackLabel} height={fallbackHeight} iconSize={fallbackIconSize} style={fallbackStyle} className={fallbackClassName} />;
  return <img {...img} onError={() => setFailed(true)} />;
}

/** <video> 包裝：同上（controls 播放器載不到檔時原生只顯示灰底錯誤，難以理解） */
export function AssetVideo(props: VideoHTMLAttributes<HTMLVideoElement> & FallbackProps) {
  const { fallbackLabel, fallbackHeight, fallbackIconSize, fallbackStyle, fallbackClassName, ...video } = props;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [video.src]);
  if (failed) return <MissingMediaBox label={fallbackLabel ?? "影片素材遺失"} height={fallbackHeight} iconSize={fallbackIconSize} style={fallbackStyle} className={fallbackClassName} />;
  return <video {...video} onError={() => setFailed(true)} />;
}

/** <audio> 包裝：載入失敗改顯示一行提示（音訊控制列較矮，用文字提示即可） */
export function AssetAudio(props: AudioHTMLAttributes<HTMLAudioElement> & { fallbackLabel?: string }) {
  const { fallbackLabel, ...audio } = props;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [audio.src]);
  if (failed) {
    return (
      <div className="hint" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
        <Icon name="XCircle" size={11} />{fallbackLabel ?? "音檔遺失（可能是伺服器重啟前的舊檔）"}
      </div>
    );
  }
  return <audio {...audio} onError={() => setFailed(true)} />;
}
