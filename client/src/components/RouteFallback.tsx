import { useEffect, useState } from "react";
import { Button, Meta } from "./ui";

/**
 * lazy 路由的 Suspense fallback。
 *
 * 純「載入中…」在 chunk 抓不到（剛部署、SW 舊快取、網路抖）時會永遠卡住，
 * 使用者以為整站壞了。超過軟門檻後改成可操作的提示＋強制重整。
 */
const SOFT_MS = 5_000;
const HARD_MS = 12_000;

export function RouteFallback() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - t0), 500);
    return () => window.clearInterval(id);
  }, []);

  if (elapsed < SOFT_MS) {
    return <Meta as="p" role="status" aria-busy="true">載入中…</Meta>;
  }

  return (
    <div role="status" aria-busy={elapsed < HARD_MS} style={{ maxWidth: 420, margin: "24px auto", padding: "0 16px" }}>
      <Meta as="p" style={{ marginBottom: 12 }}>
        {elapsed >= HARD_MS
          ? "這一頁的程式檔可能沒載入完成（常見於剛更新後）。請強制重新整理。"
          : "頁面還在載入，比平常慢一點…"}
      </Meta>
      {elapsed >= HARD_MS && (
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("_r", String(Date.now()));
            window.location.replace(url.toString());
          }}
        >
          強制重新整理
        </Button>
      )}
    </div>
  );
}
