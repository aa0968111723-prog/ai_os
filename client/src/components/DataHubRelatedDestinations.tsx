import { Suspense, useEffect } from "react";
import { Link } from "wouter";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { Icon } from "./Icon";
import { Card, Hint } from "./ui";

/**
 * 資料中心承接的相鄰去處（全站導覽去重 PR 4）。
 *
 * 知識地圖仍吃同一支 `knowledgeMap.graph`／`KnowledgeMapCard`，不另建資料源。
 * 元件本身在 PlannerPage，這裡 lazy 載入，避免把整份排程頁打進資料中心 chunk。
 * 共用下載的真頁仍是 `/downloads`；這裡只放入口與錨點。
 */
const KnowledgeMapCard = lazyWithRetry(() =>
  import("../pages/PlannerPage").then((m) => ({ default: m.KnowledgeMapCard })),
);

const HUB_HASHES = new Set(["knowledge-map", "hub-downloads"]);

function scrollHubAnchor() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!HUB_HASHES.has(hash)) return;
  const deadline = Date.now() + 3000;
  const tick = () => {
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ block: "start" });
    else if (Date.now() < deadline) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function DataHubRelatedDestinations({ groupId }: { groupId: string }) {
  useEffect(() => {
    scrollHubAnchor();
    window.addEventListener("hashchange", scrollHubAnchor);
    return () => window.removeEventListener("hashchange", scrollHubAnchor);
  }, []);

  return (
    <>
      <section id="knowledge-map" className="hub-knowledge-map" aria-labelledby="hub-knowledge-map-title">
        <h2 id="hub-knowledge-map-title" className="hub-section-title">
          <Icon name="Waypoints" size={16} /> 知識地圖
        </h2>
        <Hint style={{ marginTop: 0 }}>
          本組知識、筆記、行程與資料表的關聯圖。與筆記排程裡的是同一份資料，不是第二套地圖。
        </Hint>
        <Suspense fallback={<Hint>正在載入知識地圖…</Hint>}>
          <KnowledgeMapCard groupId={groupId} initiallyOpen />
        </Suspense>
      </section>

      <Card as="section" id="hub-downloads" className="hub-downloads-card" aria-labelledby="hub-downloads-title">
        <h2 id="hub-downloads-title" className="hub-section-title" style={{ marginTop: 0 }}>
          <Icon name="Download" size={16} /> 共用下載
        </h2>
        <Hint style={{ marginTop: 0 }}>
          團隊文件與電腦版程式。完整清單與實際下載仍在原頁，這裡只是資料中心的入口。
        </Hint>
        <p style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "10px 0 0" }}>
          <Link href="/downloads">打開共用下載</Link>
          <Link href="/downloads#desktop-app">電腦版應用程式</Link>
        </p>
      </Card>
    </>
  );
}
