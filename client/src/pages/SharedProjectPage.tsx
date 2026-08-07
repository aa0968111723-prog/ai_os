/**
 * 分享連結的唯讀檢視頁（/s/:token）——拿到連結的人不必登入就能看完整個專案。
 *
 * 這頁刻意「只會讀」：整頁只打一支 share.view，沒有任何 mutation、沒有任何寫入控制項。
 * 對外公開哪些欄位由後端 services/projectShare.ts 的 buildSharedProjectView 決定，
 * 這裡只負責把拿到的東西排版；要多分享什麼請改後端那一個出口。
 */
import { useEffect } from "react";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { AssetAudio, AssetImg, AssetVideo } from "../components/MediaFallback";
import { Card, Hint, Meta, Pill, Skeleton } from "../components/ui";

/** 素材簽名網址效期 1 小時（後端 SHARE_MEDIA_TTL_SECONDS）——過期前重抓一次，圖才不會突然變破圖。
 *  這也讓「建立者撤銷連結」最慢在一輪之內生效，而不是等使用者自己重新整理。 */
const REFRESH_MS = 45 * 60_000;

const KNOWLEDGE_KIND_LABEL: Record<string, string> = {
  transcript: "開示逐字稿",
  testimony: "見證故事",
  script: "腳本",
  note: "筆記",
};

const SCENE_STATUS: Record<string, { label: string; status: "queued" | "running" | "done" | "neutral" }> = {
  todo: { label: "未開始", status: "queued" },
  doing: { label: "進行中", status: "running" },
  done: { label: "完成", status: "done" },
};

function isVideo(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("video/");
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 24 }} aria-label={title}>
      <h2 style={{ fontSize: "var(--fs-18)", margin: "0 0 10px" }}>
        {title}
        {count != null && <Meta as="span" style={{ marginLeft: 8 }}>{count}</Meta>}
      </h2>
      {children}
    </section>
  );
}

/** 世界觀是自由格式 jsonb：只把「有值的字串欄位」列出來，不猜結構、不硬套版型 */
function worldviewEntries(worldview: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(worldview)
    .map(([key, raw]) => ({
      key,
      value: Array.isArray(raw) ? raw.filter((v) => typeof v === "string").join("、") : typeof raw === "string" ? raw : "",
    }))
    .filter((entry) => entry.value.trim().length > 0);
}

export function SharedProjectPage({ token }: { token: string }) {
  const view = trpc.share.view.useQuery(
    { token },
    { retry: false, refetchInterval: REFRESH_MS, refetchOnWindowFocus: true },
  );

  // 公開連結不該被搜尋引擎收錄——分享對象是「拿到連結的人」，不是全世界。
  // 這頁是 SPA 路由，index.html 的靜態 meta 管不到，掛載時自己補一顆、離開時收掉。
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow, noarchive";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  useEffect(() => {
    const title = view.data?.project.title;
    document.title = title ? `${title}｜專案檢視` : "專案檢視";
  }, [view.data?.project.title]);

  if (view.isLoading) {
    return (
      <div style={{ maxWidth: 860, margin: "24px auto", padding: "0 16px" }} role="status" aria-label="載入分享內容中…">
        <Skeleton style={{ height: 32, width: "50%" }} />
        <Skeleton style={{ height: 180, marginTop: 16 }} />
        <Skeleton style={{ height: 120, marginTop: 12 }} />
      </div>
    );
  }

  if (view.error || !view.data) {
    return (
      <div style={{ minHeight: "70dvh", display: "grid", placeItems: "center", padding: "0 16px" }}>
        <Card style={{ width: 420, maxWidth: "92vw" }}>
          <h1 style={{ fontSize: "var(--fs-24)", marginTop: 0 }}>這個分享連結打不開</h1>
          <p className="error" role="alert">{view.error?.message ?? "分享連結無效"}</p>
          <Hint layer="always">連結由專案成員產生，可能已被收回或設有期限——請向分享給你的人索取新連結。</Hint>
        </Card>
      </div>
    );
  }

  const { project, worldview, characters, scenePresets, props, knowledge, assets, scenes } = view.data;
  const wv = worldviewEntries(worldview);
  const cards = [
    { label: "角色定裝", items: characters.map((c) => ({ id: c.id, name: c.name, detail: c.appearance, notes: c.notes, imageUrl: c.imageUrl })) },
    { label: "場景設定", items: scenePresets.map((s) => ({ id: s.id, name: s.name, detail: s.palette, notes: s.lighting, imageUrl: s.imageUrl })) },
    { label: "素材設定", items: props.map((p) => ({ id: p.id, name: p.name, detail: p.appearance, notes: p.notes, imageUrl: p.imageUrl })) },
  ].filter((group) => group.items.length > 0);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "20px 16px 64px" }}>
      <Card variant="primary">
        <Meta as="p" style={{ margin: 0 }}>
          <Icon name="Share2" size={14} /> 唯讀檢視 · 由專案成員分享
        </Meta>
        <h1 style={{ fontSize: "var(--fs-28)", margin: "6px 0 10px" }}>{project.title}</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Pill>{project.kind}</Pill>
          <Pill>{project.format}</Pill>
          {project.status === "archived" && <Pill status="queued">已封存</Pill>}
          <Meta as="span">更新於 {new Date(project.updatedAt).toLocaleDateString("zh-TW")}</Meta>
        </div>
        {project.coverUrl && (
          <AssetImg
            src={project.coverUrl}
            alt=""
            style={{ width: "100%", maxHeight: 280, objectFit: "cover", borderRadius: 10, marginTop: 14 }}
          />
        )}
        <Hint layer="always" style={{ marginTop: 12 }}>
          這是分享連結的唯讀畫面：看得到內容，但不能編輯，也不會動到專案。
        </Hint>
      </Card>

      {wv.length > 0 && (
        <Section title="定調">
          <Card variant="std">
            <dl style={{ display: "grid", gap: 10, margin: 0 }}>
              {wv.map((entry) => (
                <div key={entry.key}>
                  <dt><Meta as="span">{entry.key}</Meta></dt>
                  <dd style={{ margin: "2px 0 0" }}>{entry.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </Section>
      )}

      {cards.map((group) => (
        <Section key={group.label} title={group.label} count={group.items.length}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {group.items.map((item) => (
              <Card key={item.id} variant="std">
                {item.imageUrl && (
                  <AssetImg
                    src={item.imageUrl}
                    alt=""
                    style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 8, marginBottom: 8 }}
                  />
                )}
                <strong>{item.name}</strong>
                <p style={{ margin: "4px 0 0" }}>{item.detail}</p>
                {item.notes && <Meta as="p" style={{ marginTop: 4 }}>{item.notes}</Meta>}
              </Card>
            ))}
          </div>
        </Section>
      ))}

      {knowledge.length > 0 && (
        <Section title="依據（知識庫）" count={knowledge.length}>
          <div style={{ display: "grid", gap: 10 }}>
            {knowledge.map((k) => (
              <Card as="details" variant="quiet" key={k.id}>
                <summary>
                  <strong>{k.title}</strong>
                  <Meta as="span" style={{ marginLeft: 8 }}>{KNOWLEDGE_KIND_LABEL[k.kind] ?? k.kind}</Meta>
                  {k.pinned && <Meta as="span" style={{ marginLeft: 6 }}>· 釘選</Meta>}
                </summary>
                <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{k.content}</p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {scenes.length > 0 && (
        <Section title="分鏡與交付" count={scenes.length}>
          <div style={{ display: "grid", gap: 12 }}>
            {scenes.map((scene, index) => (
              <Card key={scene.id} variant="std">
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <Meta as="span">#{index + 1}</Meta>
                  <strong>{scene.title}</strong>
                  <Pill status={SCENE_STATUS[scene.status]?.status ?? "neutral"}>
                    {SCENE_STATUS[scene.status]?.label ?? scene.status}
                  </Pill>
                  <Meta as="span">{scene.durationSec} 秒</Meta>
                </div>
                {scene.imageUrl && (
                  <AssetImg
                    src={scene.imageUrl}
                    alt=""
                    style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 8, marginTop: 8 }}
                  />
                )}
                {scene.voiceover && <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{scene.voiceover}</p>}
                {scene.ambience && (
                  <Meta as="p" style={{ marginTop: 6, marginBottom: 0 }}>
                    <Icon name="Music" size={13} /> {scene.ambience}
                  </Meta>
                )}
                {scene.ambienceUrl && (
                  <AssetAudio src={scene.ambienceUrl} controls style={{ width: "100%", marginTop: 6 }} />
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}

      {assets.length > 0 && (
        <Section title="素材庫" count={assets.length}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            {assets.map((asset) => (
              <Card key={asset.id} variant="std">
                {isVideo(asset.mime) ? (
                  <AssetVideo src={asset.url} controls style={{ width: "100%", borderRadius: 8 }} />
                ) : (
                  <AssetImg
                    src={asset.url}
                    alt={asset.title}
                    style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8 }}
                  />
                )}
                <Meta as="p" style={{ margin: "6px 0 0" }}>{asset.title}</Meta>
              </Card>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
