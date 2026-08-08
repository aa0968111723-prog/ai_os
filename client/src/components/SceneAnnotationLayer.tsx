import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { containedBox, mediaPointFromEvent, type MediaBox } from "@shared/mediaPoint";
import { dotVisibleAt } from "@shared/timecode";

/** 一則畫在圖上的標注（只取畫圓點需要的欄位） */
export interface SceneAnnotationDot {
  id: string;
  ax: number;
  ay: number;
  resolvedAt: Date | string | null;
  /** 顯示用編號（1,2,3…）——阿拉伯數字在小螢幕上才看得清 */
  index: number;
  /** 影片時間碼（毫秒）；null＝靜態圖標注。圓點只在播放頭接近它時顯示（shared/timecode）。 */
  tMs?: number | null;
}

/**
 * 觸控裝置上，按下與放開之間位移超過這個距離就當成捲動而不是點擊。
 * 沒有這道門檻的話，在手機上想捲動舞台就會不斷產生誤標。
 */
const TAP_SLOP_PX = 20;

/**
 * 圖上定點標注的疊層。
 *
 * 兩件事是這個元件存在的理由，兩件都做錯了不會有任何症狀：
 *
 * 1. **座標一律相對「媒體內容框」而非元素框。** 舞台是 `object-fit: contain`，元素框裡有
 *    letterbox 留白——16:9 素材配手機直式版面幾乎必然如此。用元素 rect 算的話所有標注會
 *    系統性偏移，而圓點畫得出來、點得到、存得進去，沒有人會發現。換算全部走
 *    `shared/mediaPoint.ts` 的純函式（有測試），這裡只負責量測與事件。
 * 2. **量測要跟著版面變。** 素材是延遲載入的（載入前 naturalWidth 為 0），視窗會縮放，
 *    ≤900px 時 CSS 還會把 max-height 降一級。任何一次沒有重新量，圓點就會停在舊位置上。
 *    所以 ResizeObserver ＋ load 事件都要接。
 *
 * 手機與桌機共用同一個元件——`SceneStudio` 在 ≤900px 已是單欄、≤560px 已是全寬貼底 sheet，
 * 專案裡「同一個東西長成兩份」（MessagePanel 的桌機側欄與手機 sheet）已經有前例，不再來一次。
 */
export function SceneAnnotationLayer({
  children,
  annotations,
  annotating,
  onPick,
  onSelect,
  selectedId,
}: {
  /** 舞台上的媒體元素（img／video）；本元件會自己找到它來量測 */
  children: ReactNode;
  annotations: SceneAnnotationDot[];
  /** 標注模式：游標變十字、點一下就收一個座標 */
  annotating: boolean;
  /** 媒體是影片時，point 會帶上點擊當下的播放頭（tMs 毫秒）——影片時間碼留言的來源 */
  onPick: (point: { ax: number; ay: number; tMs?: number }) => void;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 媒體內容框相對「本元件」的位置；null＝素材還沒載入完，此時不畫也不收點 */
  const [inner, setInner] = useState<MediaBox | null>(null);
  /** 觸控起點：用來分辨「點一下」與「捲動」 */
  const downAt = useRef<{ x: number; y: number } | null>(null);
  /**
   * 影片播放頭（毫秒）；null＝媒體不是影片。
   * 帶時間碼的圓點只在播放頭接近它時顯示（schema 註解從第一天就這樣承諾，這裡才真的做到）。
   * timeupdate 約 4Hz——夠讓圓點在正確的一兩秒內出現，又不會把整層拖進逐幀重繪。
   */
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const media = wrap?.querySelector<HTMLImageElement | HTMLVideoElement>("img, video");
    if (!wrap || !media) return setInner(null);
    const intrinsic = media instanceof HTMLVideoElement
      ? { w: media.videoWidth, h: media.videoHeight }
      : { w: media.naturalWidth, h: media.naturalHeight };
    const rect = media.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    // 換算成「相對本元件」的座標，圓點才能用 absolute 定位；containedBox 是純幾何，
    // 傳相對座標進去與傳視窗座標等價
    const box = containedBox(
      { left: rect.left - wrapRect.left, top: rect.top - wrapRect.top, width: rect.width, height: rect.height },
      intrinsic,
    );
    setInner(box);
  }, []);

  useLayoutEffect(measure);

  useEffect(() => {
    const wrap = wrapRef.current;
    const media = wrap?.querySelector<HTMLImageElement | HTMLVideoElement>("img, video");
    if (!wrap) return;
    // jsdom／舊瀏覽器沒有 ResizeObserver：量一次就好，圓點仍畫得出來，只是不跟著版面變
    //（沿用 WhiteboardCanvas 與 PlannerPage 的同一條守衛）
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(wrap);
    if (media && ro) ro.observe(media);
    // 素材載入前 naturalWidth/videoWidth 是 0，量到的內容框是 null——載入完成一定要重量一次
    media?.addEventListener("load", measure);
    media?.addEventListener("loadedmetadata", measure);
    window.addEventListener("resize", measure);
    // 影片才追播放頭；seeked 也要接——點留言跳到 00:18 時，不等下一次 timeupdate 圓點就要出現
    const isVideo = media instanceof HTMLVideoElement;
    const onTime = isVideo ? () => setPlayheadMs(Math.round(media.currentTime * 1000)) : null;
    if (isVideo && onTime) {
      setPlayheadMs(Math.round(media.currentTime * 1000));
      media.addEventListener("timeupdate", onTime);
      media.addEventListener("seeked", onTime);
    } else {
      setPlayheadMs(null);
    }
    return () => {
      ro?.disconnect();
      media?.removeEventListener("load", measure);
      media?.removeEventListener("loadedmetadata", measure);
      if (isVideo && onTime) {
        media.removeEventListener("timeupdate", onTime);
        media.removeEventListener("seeked", onTime);
      }
      window.removeEventListener("resize", measure);
    };
  }, [measure, children]);

  const handleUp = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!annotating) return;
    const start = downAt.current;
    downAt.current = null;
    // 觸控上「按下→拖曳→放開」是捲動，不是要標注這裡
    if (start && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > TAP_SLOP_PX) return;
    const wrap = wrapRef.current;
    const media = wrap?.querySelector<HTMLImageElement | HTMLVideoElement>("img, video");
    if (!media) return;
    const intrinsic = media instanceof HTMLVideoElement
      ? { w: media.videoWidth, h: media.videoHeight }
      : { w: media.naturalWidth, h: media.naturalHeight };
    const rect = media.getBoundingClientRect();
    // 點在 letterbox 留白上、或素材還沒載入，一律回 null——這時什麼都不做，
    // 而不是 clamp 成邊緣座標（那會讓圓點莫名跑到畫面邊上）
    const point = mediaPointFromEvent(rect, intrinsic, ev);
    if (!point) return;
    // 影片：一併記下點擊當下的播放頭。「這裡人物切太快」指的是**這一刻的**畫面，
    // 座標與時間碼缺一則標注就指不回原處。
    if (media instanceof HTMLVideoElement) {
      onPick({ ...point, tMs: Math.round(media.currentTime * 1000) });
    } else {
      onPick(point);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`scene-annot${annotating ? " is-annotating" : ""}`}
      onPointerDown={(ev) => { if (annotating) downAt.current = { x: ev.clientX, y: ev.clientY }; }}
      onPointerUp={handleUp}
    >
      {children}
      {inner && annotations.map((a) => {
        // 帶時間碼的圓點只在播放頭接近時顯示（±1.5s，見 shared/timecode）。
        // 隱藏用 return null 而不是 CSS：看不到的圓點也不該擋到影片的播放控制列。
        if (!dotVisibleAt(a.tMs, playheadMs)) return null;
        const resolved = !!a.resolvedAt;
        return (
          <button
            key={a.id}
            type="button"
            className={`scene-annot__dot${resolved ? " is-resolved" : ""}${selectedId === a.id ? " is-selected" : ""}`}
            style={{ left: inner.left + a.ax * inner.width, top: inner.top + a.ay * inner.height }}
            aria-label={`第 ${a.index} 則標注${resolved ? "（已改好）" : ""}`}
            aria-pressed={selectedId === a.id}
            onClick={(ev) => { ev.stopPropagation(); onSelect?.(a.id); }}
            // 圓點自己不該觸發「在這裡新增標注」——按到既有標注是要看它，不是再標一個
            onPointerDown={(ev) => ev.stopPropagation()}
            onPointerUp={(ev) => ev.stopPropagation()}
          >
            {a.index}
          </button>
        );
      })}
    </div>
  );
}
