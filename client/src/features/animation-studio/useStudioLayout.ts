import { useEffect, useMemo, useState } from "react";
import { useMatchMedia } from "../../lib/useMatchMedia";
import { resolveStudioLayout, type StudioLayout } from "./studioLayout";

/**
 * 版面模式的 React 接線。決策本身在 `resolveStudioLayout`（純函式、可測），
 * 這裡只負責把「視窗寬度／是不是觸控／像素比」餵給它並跟著變化重算。
 *
 * 之所以追寬度而不是只用一條 media query：輕量版的判斷還吃「觸控 × 中等寬度」
 * （平板橫向），單一 media query 表達不了，而把兩個條件拆成兩條 query 再組合，
 * 條件就散在兩個地方了。
 */
export function useStudioLayout(): StudioLayout {
  const coarsePointer = useMatchMedia("(pointer: coarse)");
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const [dpr, setDpr] = useState(() => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      setDpr(window.devicePixelRatio || 1);
    };
    onResize();
    window.addEventListener("resize", onResize);
    // 手機轉向後 innerWidth 有時要下一幀才更新，orientationchange 補一次
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return useMemo(
    () => resolveStudioLayout({ viewportWidth, coarsePointer, devicePixelRatio: dpr }),
    [viewportWidth, coarsePointer, dpr],
  );
}
