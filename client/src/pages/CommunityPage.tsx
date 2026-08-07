/**
 * 靈感頻道（Flow 風格視覺牆）：全站共用的提示詞與多模態素材。
 *
 * 三件事，順序就是使用者的動線：
 *  1. **看得到** —— 深色舞台上的 masonry 作品牆，prompt 直接壓在畫面上（FlowWall/FlowTile）。
 *  2. **找得到** —— 自動細化分類的 facet 篩選列，每個 chip 都帶數量（FlowFacetRail）。
 *  3. **拿得走 / 放得上** —— 分享連結、一鍵再用、直接上傳發布（FlowLightbox/InspirationComposer）。
 *
 * 清單檢視保留給低頻寬與偏好純文字的人；兩種檢視共用同一個細節浮層，
 * 動作只有一份實作，不會兩邊行為分岔。
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { inspirationTagLabel } from "@shared/inspirationTaxonomy";
import { trpc } from "../api";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Button, Card, Chip, Hint, Meta, Skeleton } from "../components/ui";
import { Icon } from "../components/Icon";
import { applyCommunityRemixToProject } from "../lib/communityRemix";
import { FlowWall } from "../features/inspiration/FlowWall";
import { FlowFacetRail } from "../features/inspiration/FlowFacetRail";
import { FlowLightbox } from "../features/inspiration/FlowLightbox";
import { InspirationComposer } from "../features/inspiration/InspirationComposer";
import { buildFacetRail, toggleFacet } from "../features/inspiration/facetRail";
import {
  buildInspirationShareText,
  buildInspirationShareUrl,
  shareInspirationPost,
} from "../features/inspiration/shareInspiration";
import type { InspirationPost } from "../features/inspiration/types";

type SortMode = "recent" | "popular";
type MediaFilter = "all" | "text" | "image" | "video" | "audio" | "card";
type TabMode = "feed" | "mine";
type ViewMode = "wall" | "list";

const MEDIA_FILTERS: { id: MediaFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "text", label: "提示詞" },
  { id: "image", label: "圖片" },
  { id: "video", label: "影片" },
  { id: "audio", label: "音訊" },
  { id: "card", label: "設定卡" },
];

const SOURCE_LABEL: Record<string, string> = {
  prompt: "提示詞",
  generation: "生成",
  asset: "素材",
  character: "角色卡",
  scene_preset: "場景卡",
  prop: "道具卡",
};

/** 網址帶 ?post=<id> 進站時直接打開那一則（分享連結的落點） */
function deepLinkedPostId(): string | null {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get("post");
  return id && id.length <= 64 ? id : null;
}

export function CommunityPage() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabMode>("feed");
  const [sort, setSort] = useState<SortMode>("recent");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [facets, setFacets] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("wall");
  const [openId, setOpenId] = useState<string | null>(() => deepLinkedPostId());
  const [composerOpen, setComposerOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [reusedId, setReusedId] = useState<string | null>(null);

  const mediaKind = mediaFilter === "all" ? undefined : mediaFilter;

  const feed = trpc.community.listPublic.useInfiniteQuery(
    { limit: 24, sort, mediaKind, facets: facets.length > 0 ? facets : undefined },
    { enabled: tab === "feed", getNextPageParam: (last) => last.nextCursor },
  );

  const mine = trpc.community.myPosts.useQuery({ limit: 50 }, { enabled: tab === "mine" });

  const facetCounts = trpc.community.facetCounts.useQuery(
    { mediaKind, facets: facets.length > 0 ? facets : undefined },
    { enabled: tab === "feed" },
  );

  const utils = trpc.useUtils();
  const invalidateFeed = () => {
    utils.community.listPublic.invalidate();
    utils.community.facetCounts.invalidate();
    utils.community.myPosts.invalidate();
  };

  const recordUse = trpc.community.recordUse.useMutation({
    onSuccess: (_d, vars) => {
      setReusedId(vars.postId);
      utils.community.listPublic.invalidate();
    },
  });
  const unpublish = trpc.community.unpublish.useMutation({ onSuccess: invalidateFeed });
  const republish = trpc.community.republish.useMutation({ onSuccess: invalidateFeed });
  const toggleLike = trpc.community.toggleLike.useMutation({ onSuccess: () => invalidateFeed() });

  const feedItems = useMemo(
    () => (feed.data?.pages ?? []).flatMap((p) => p.items) as InspirationPost[],
    [feed.data],
  );
  const mineItems = (mine.data?.items ?? []) as InspirationPost[];
  const items = tab === "feed" ? feedItems : mineItems;
  const isLoading = tab === "feed" ? feed.isLoading : mine.isLoading;
  const error = tab === "feed" ? feed.error : mine.error;

  // 分享連結進站時，那一則不一定在目前這頁裡——單獨取回來
  const inList = items.find((p) => p.id === openId) ?? null;
  const single = trpc.community.get.useQuery(
    { id: openId ?? "" },
    { enabled: !!openId && !inList },
  );
  const openPost = inList ?? ((single.data ?? null) as InspirationPost | null);

  const projects = trpc.projects.list.useQuery(undefined, { enabled: !!openPost });

  // 打開／關閉細節時同步網址，讓「複製網址列」與「分享」得到同一條連結
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (openId) url.searchParams.set("post", openId);
    else url.searchParams.delete("post");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [openId]);

  const facetGroups = useMemo(
    () => buildFacetRail(facetCounts.data?.counts ?? [], facets),
    [facetCounts.data, facets],
  );

  const onCopyPrompt = (post: InspirationPost) => {
    if (!post.promptText) return;
    navigator.clipboard.writeText(post.promptText).then(
      () => {
        setCopiedId(post.id);
        setTimeout(() => setCopiedId((cur) => (cur === post.id ? null : cur)), 1600);
      },
      () => {},
    );
  };

  const onShare = async (post: InspirationPost) => {
    const url = buildInspirationShareUrl(window.location.origin, post.id);
    const outcome = await shareInspirationPost({
      url,
      title: post.title,
      text: buildInspirationShareText({
        title: post.title,
        categoryLabel: post.category ? inspirationTagLabel(post.category) : null,
      }),
    });
    const note =
      outcome === "copied" ? "已複製連結" : outcome === "shared" ? "已分享" : "無法分享——請手動複製網址";
    setShareNote(note);
    setTimeout(() => setShareNote((cur) => (cur === note ? null : cur)), 2200);
  };

  const onReuse = (post: InspirationPost, projectId: string) => {
    applyCommunityRemixToProject(
      projectId,
      {
        promptText: post.promptText,
        modelId: post.modelId,
        characterIds: post.characterIds,
        scenePresetIds: post.scenePresetIds,
        propIds: post.propIds,
        title: post.title,
      },
      navigate,
    );
    recordUse.mutate({ postId: post.id });
  };

  const emptyTitle = tab === "mine" ? "你還沒發布過" : facets.length > 0 ? "這組分類還沒有素材" : "還沒有公開貼文";
  const emptyHint =
    tab === "mine"
      ? "上面的「上傳發布」可以直接把手上的圖片／影片放上來，或到專案提示詞庫按「發布」。"
      : facets.length > 0
        ? "換個分類條件，或清除條件看看全部。"
        : "到專案提示詞庫按「發布」，把好用的咒語上架，讓全站夥伴都能偷看與再用。";

  return (
    <div data-fb="靈感頻道" style={{ maxWidth: 1120, margin: "0 auto", padding: "0 12px 48px" }}>
      <SecondaryPageHeader
        eyebrow="全站共用"
        title="靈感頻道"
        icon="Sparkles"
        description={
          <>
            別人發布的提示詞、生成結果與設定卡——可偷看完整 prompt、一鍵帶入你的專案生成台。
            上傳的素材會自動細化分類，別人靠分類就找得到你的作品。
          </>
        }
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Button type="button" size="sm" variant={tab === "feed" ? "primary" : "ghost"} onClick={() => setTab("feed")}>
            Feed
          </Button>
          <Button type="button" size="sm" variant={tab === "mine" ? "primary" : "ghost"} onClick={() => setTab("mine")}>
            我的發布
          </Button>
        </div>

        <Button
          type="button"
          size="sm"
          variant={composerOpen ? "primary" : "tonal"}
          onClick={() => setComposerOpen((v) => !v)}
        >
          <Icon name="Plus" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          上傳發布
        </Button>

        {tab === "feed" && (
          <>
            <div style={{ display: "flex", gap: 6 }}>
              <Button
                type="button"
                size="sm"
                variant={sort === "recent" ? "primary" : "ghost"}
                onClick={() => setSort("recent")}
              >
                最新
              </Button>
              <Button
                type="button"
                size="sm"
                variant={sort === "popular" ? "primary" : "ghost"}
                onClick={() => setSort("popular")}
              >
                熱門
              </Button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {MEDIA_FILTERS.map((f) => (
                <Chip key={f.id} selected={mediaFilter === f.id} onClick={() => setMediaFilter(f.id)}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <Button
            type="button"
            size="sm"
            variant={view === "wall" ? "primary" : "ghost"}
            onClick={() => setView("wall")}
            title="視覺牆"
          >
            <Icon name="LayoutGrid" size={14} />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "list" ? "primary" : "ghost"}
            onClick={() => setView("list")}
            title="清單"
          >
            <Icon name="List" size={14} />
          </Button>
        </div>
      </div>

      {composerOpen && <InspirationComposer onPublished={invalidateFeed} />}

      {error && (
        <p className="error" style={{ marginTop: 16 }}>
          {error.message}
        </p>
      )}

      <div className="flow-stage">
        <div className="flow-stage__head">
          <span className="flow-stage__title">{tab === "mine" ? "My publications" : "Inspiration flow"}</span>
          <span className="flow-stage__count">
            {isLoading ? "載入中…" : `${items.length} 則${feed.hasNextPage && tab === "feed" ? "（可再載入）" : ""}`}
          </span>
        </div>

        {tab === "feed" && (
          <FlowFacetRail
            groups={facetGroups}
            selectedCount={facets.length}
            loading={facetCounts.isLoading}
            onToggle={(tag) => setFacets((cur) => toggleFacet(cur, tag))}
            onClear={() => setFacets([])}
          />
        )}

        {view === "wall" ? (
          <FlowWall
            posts={items}
            loading={isLoading}
            onOpen={(post) => setOpenId(post.id)}
            emptyTitle={emptyTitle}
            emptyHint={emptyHint}
          />
        ) : (
          <InspirationList posts={items} loading={isLoading} onOpen={(post) => setOpenId(post.id)} />
        )}

        {tab === "feed" && feed.hasNextPage && (
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button
              type="button"
              className="flow-action"
              disabled={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              {feed.isFetchingNextPage ? "載入中…" : "載入更多"}
            </button>
          </div>
        )}
      </div>

      {openPost && (
        <FlowLightbox
          post={openPost}
          onClose={() => setOpenId(null)}
          onToggleLike={tab === "feed" ? (post) => toggleLike.mutate({ postId: post.id }) : undefined}
          likePending={toggleLike.isPending}
          onCopyPrompt={onCopyPrompt}
          copied={copiedId === openPost.id}
          onShare={(post) => void onShare(post)}
          shareNote={shareNote}
          onReuse={onReuse}
          projects={projects.data}
          projectsLoading={projects.isLoading}
          reused={reusedId === openPost.id}
          onUnpublish={
            tab === "mine" ? (post) => unpublish.mutate({ postId: post.id }, { onSuccess: () => setOpenId(null) }) : undefined
          }
          onRepublish={tab === "mine" ? (post) => republish.mutate({ postId: post.id }) : undefined}
          mutating={unpublish.isPending || republish.isPending}
        />
      )}

      <Hint style={{ marginTop: 20 }}>
        「一鍵再用」會把完整 prompt（與模型／設定卡 id）寫進你選的專案草稿並跳到生成台；
        分類由標題、說明與提示詞自動判定，改了內容重新發布就會重新分類。
      </Hint>
    </div>
  );
}

/** 清單檢視：低頻寬／偏好文字時用；動作一律走同一個細節浮層 */
function InspirationList({
  posts,
  loading,
  onOpen,
}: {
  posts: InspirationPost[];
  loading?: boolean;
  onOpen: (post: InspirationPost) => void;
}) {
  if (loading) {
    return (
      <div aria-busy="true" style={{ display: "grid", gap: 10 }}>
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {posts.map((post) => (
        <Card
          key={post.id}
          as="article"
          style={{
            padding: "10px 12px",
            background: "rgba(246,242,234,.05)",
            border: "1px solid rgba(246,242,234,.12)",
            color: "inherit",
            opacity: post.status === "hidden" ? 0.6 : 1,
          }}
        >
          <button
            type="button"
            onClick={() => onOpen(post)}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              width: "100%",
              background: "none",
              border: "none",
              padding: 0,
              color: "inherit",
              textAlign: "left",
              cursor: "pointer",
              minHeight: 44,
            }}
          >
            <div style={{ flexShrink: 0, width: 56, height: 56 }}>
              {post.mediaUrl && post.mediaKind === "image" ? (
                <img
                  src={post.mediaUrl}
                  alt=""
                  loading="lazy"
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8 }}
                />
              ) : (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    background: "rgba(246,242,234,.08)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <Icon
                    name={
                      post.mediaKind === "audio"
                        ? "Music"
                        : post.mediaKind === "card"
                          ? "User"
                          : post.mediaKind === "video"
                            ? "Clapperboard"
                            : "Lightbulb"
                    }
                    size={18}
                  />
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--fs-14)", overflowWrap: "anywhere" }}>{post.title}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                {(post.autoTags ?? []).slice(0, 4).map((tag) => (
                  <span key={tag} className="flow-tile__badge">
                    {inspirationTagLabel(tag)}
                  </span>
                ))}
              </div>
              <Meta as="div" style={{ marginTop: 5, fontSize: "var(--fs-11)", color: "rgba(246,242,234,.62)" }}>
                {[
                  SOURCE_LABEL[post.sourceType] ?? post.sourceType,
                  post.status === "hidden" ? "已下架" : "",
                  post.likeCount > 0 ? `讚 ${post.likeCount}` : "",
                  post.useCount > 0 ? `再用 ${post.useCount}` : "",
                  new Date(post.publishedAt).toLocaleDateString(),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Meta>
            </div>
          </button>
        </Card>
      ))}
    </div>
  );
}
