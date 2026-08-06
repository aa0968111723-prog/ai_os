/**
 * 靈感頻道（Flow-TV 風格）：全站共用提示詞與多模態素材
 * - Feed / 我的發布
 * - Show Prompt、複製、一鍵再用（專案選擇器 + creationDraft）
 * - 下架（作者）
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../api";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Button, Card, Chip, EmptyState, Hint, Meta, Skeleton } from "../components/ui";
import { Icon } from "../components/Icon";
import { applyCommunityRemixToProject } from "../lib/communityRemix";

type SortMode = "recent" | "popular";
type MediaFilter = "all" | "text" | "image" | "video" | "audio" | "card";
type TabMode = "feed" | "mine";

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

type PostRow = {
  id: string;
  title: string;
  description?: string | null;
  promptText?: string | null;
  modelId?: string | null;
  mediaKind: string;
  mediaUrl?: string | null;
  sourceType: string;
  useCount: number;
  likeCount: number;
  /** Phase D：目前使用者是否已按讚（listPublic／get 回傳） */
  likedByMe?: boolean;
  publishedAt: string | Date;
  status?: string;
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
};

export function CommunityPage() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabMode>("feed");
  const [sort, setSort] = useState<SortMode>("recent");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const [reuseFlash, setReuseFlash] = useState<string | null>(null);
  const [pickerPostId, setPickerPostId] = useState<string | null>(null);

  const list = trpc.community.listPublic.useQuery(
    {
      limit: 24,
      sort,
      mediaKind: mediaFilter === "all" ? undefined : mediaFilter,
    },
    { enabled: tab === "feed" },
  );

  const mine = trpc.community.myPosts.useQuery({ limit: 30 }, { enabled: tab === "mine" });

  const projects = trpc.projects.list.useQuery(undefined, { enabled: !!pickerPostId });

  const utils = trpc.useUtils();
  const recordUse = trpc.community.recordUse.useMutation({
    onSuccess: (_d, vars) => {
      setReuseFlash(vars.postId);
      setTimeout(() => setReuseFlash((s) => (s === vars.postId ? null : s)), 1600);
      utils.community.listPublic.invalidate();
    },
  });

  const unpublish = trpc.community.unpublish.useMutation({
    onSuccess: () => {
      utils.community.myPosts.invalidate();
      utils.community.listPublic.invalidate();
    },
  });

  // Phase D：讚／取消讚；樂觀更新 likeCount + likedByMe
  const [likeFlash, setLikeFlash] = useState<Record<string, { liked: boolean; likeCount: number }>>({});
  const toggleLike = trpc.community.toggleLike.useMutation({
    onSuccess: (data, vars) => {
      setLikeFlash((prev) => ({ ...prev, [vars.postId]: { liked: data.liked, likeCount: data.likeCount } }));
      utils.community.listPublic.invalidate();
    },
  });

  const feedItems = (list.data?.items ?? []) as PostRow[];
  const mineItems = (mine.data?.items ?? []) as PostRow[];
  const items = tab === "feed" ? feedItems : mineItems;
  const isLoading = tab === "feed" ? list.isLoading : mine.isLoading;
  const error = tab === "feed" ? list.error : mine.error;
  const empty = !isLoading && items.length === 0;

  const onShowPrompt = (id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
  };

  const onCopyPrompt = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopyFlash(id);
        setTimeout(() => setCopyFlash((s) => (s === id ? null : s)), 1500);
      },
      () => {},
    );
  };

  const openRemixPicker = (postId: string) => {
    setPickerPostId(postId);
  };

  const applyRemix = (post: PostRow, projectId: string) => {
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
    setPickerPostId(null);
  };

  return (
    <div data-fb="靈感頻道" style={{ maxWidth: 920, margin: "0 auto", padding: "0 12px 48px" }}>
      <SecondaryPageHeader
        eyebrow="全站共用"
        title="靈感頻道"
        icon="Sparkles"
        description={
          <>
            別人發布的提示詞、生成結果與設定卡——可偷看完整 prompt、一鍵帶入你的專案生成台。
            在專案的提示詞庫或生成紀錄按「發布」即可上架。
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
        {tab === "feed" && (
          <>
            <div style={{ display: "flex", gap: 6 }}>
              <Button type="button" size="sm" variant={sort === "recent" ? "primary" : "ghost"} onClick={() => setSort("recent")}>
                最新
              </Button>
              <Button type="button" size="sm" variant={sort === "popular" ? "primary" : "ghost"} onClick={() => setSort("popular")}>
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
      </div>

      {isLoading && (
        <div style={{ marginTop: 20 }} aria-busy="true">
          <Skeleton height={88} style={{ marginBottom: 12 }} />
          <Skeleton height={88} style={{ marginBottom: 12 }} />
          <Skeleton height={88} />
        </div>
      )}

      {error && (
        <p className="error" style={{ marginTop: 16 }}>
          {error.message}
        </p>
      )}

      {empty && (
        <EmptyState
          icon={<Icon name="Sparkles" />}
          title={tab === "mine" ? <>你還沒發布過</> : <>還沒有公開貼文</>}
          description={
            tab === "mine" ? (
              <>到專案提示詞庫或生成紀錄按「發布」，上架後會出現在這裡，也可隨時下架。</>
            ) : (
              <>到專案提示詞庫按「發布」，把好用的咒語上架到靈感頻道，讓全站夥伴都能偷看與再用。</>
            )
          }
          style={{ marginTop: 24 }}
        />
      )}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((post) => {
          const expanded = expandedId === post.id;
          const hasPrompt = Boolean(post.promptText?.trim());
          const isHidden = post.status === "hidden";
          return (
            <Card key={post.id} as="article" style={{ padding: "12px 14px", opacity: isHidden ? 0.65 : 1 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: 72, height: 72 }}>
                  {post.mediaUrl && (post.mediaKind === "image" || post.mediaKind === "video") ? (
                    post.mediaKind === "video" ? (
                      <video
                        src={post.mediaUrl}
                        style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }}
                        muted
                        playsInline
                      />
                    ) : (
                      <img
                        src={post.mediaUrl}
                        alt=""
                        style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }}
                      />
                    )
                  ) : (
                    <div
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: 8,
                        background: "var(--surface-2, var(--border-soft))",
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
                        size={22}
                      />
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <strong style={{ fontSize: "var(--fs-14)", overflowWrap: "anywhere" }}>{post.title}</strong>
                    <Chip style={{ fontSize: "var(--fs-11)" }}>
                      {SOURCE_LABEL[post.sourceType] ?? post.sourceType}
                    </Chip>
                    {isHidden && (
                      <Chip style={{ fontSize: "var(--fs-11)" }}>已下架</Chip>
                    )}
                    {post.mediaKind !== "text" && (
                      <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
                        {post.mediaKind}
                      </Meta>
                    )}
                  </div>
                  {post.description && (
                    <p style={{ margin: "4px 0 0", fontSize: "var(--fs-13)", opacity: 0.85, overflowWrap: "anywhere" }}>
                      {post.description}
                    </p>
                  )}
                  <Meta as="div" style={{ marginTop: 4, fontSize: "var(--fs-11)" }}>
                    {[
                      post.modelId ? `模型 ${post.modelId}` : "",
                      post.useCount > 0 ? `再用 ${post.useCount}` : "",
                      (() => {
                        const flash = likeFlash[post.id];
                        const n = flash?.likeCount ?? post.likeCount;
                        return n > 0 ? `讚 ${n}` : "";
                      })(),
                      new Date(post.publishedAt).toLocaleDateString(),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Meta>

                  {expanded && hasPrompt && (
                    <pre
                      className="mono"
                      style={{
                        marginTop: 10,
                        padding: 10,
                        fontSize: "var(--fs-12)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        background: "var(--surface-2, rgba(0,0,0,0.04))",
                        borderRadius: 8,
                        maxHeight: 220,
                        overflow: "auto",
                      }}
                    >
                      {post.promptText}
                    </pre>
                  )}

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {tab === "feed" && !isHidden && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        title={(likeFlash[post.id]?.liked ?? post.likedByMe) ? "取消讚" : "按讚"}
                        disabled={toggleLike.isPending}
                        onClick={() => toggleLike.mutate({ postId: post.id })}
                        style={
                          (likeFlash[post.id]?.liked ?? post.likedByMe)
                            ? { color: "var(--gold-ink, #b8860b)", fontWeight: 600 }
                            : undefined
                        }
                      >
                        <Icon
                          name="Star"
                          size={13}
                          style={{ verticalAlign: "-2px", marginRight: 4 }}
                        />
                        {(likeFlash[post.id]?.liked ?? post.likedByMe) ? "已讚" : "讚"}
                        {((likeFlash[post.id]?.likeCount ?? post.likeCount) > 0) &&
                          ` ${likeFlash[post.id]?.likeCount ?? post.likeCount}`}
                      </Button>
                    )}
                    {hasPrompt && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => onShowPrompt(post.id)}>
                        {expanded ? "收起 Prompt" : "Show Prompt"}
                      </Button>
                    )}
                    {hasPrompt && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onCopyPrompt(post.id, post.promptText!)}
                      >
                        {copyFlash === post.id ? "已複製" : "複製 Prompt"}
                      </Button>
                    )}
                    {hasPrompt && tab === "feed" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        disabled={recordUse.isPending}
                        onClick={() => openRemixPicker(post.id)}
                        title="選擇專案，預填生成台並跳轉"
                      >
                        {reuseFlash === post.id ? "已記再用 ✓" : "一鍵再用"}
                      </Button>
                    )}
                    {tab === "mine" && post.status === "published" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={unpublish.isPending}
                        onClick={() => unpublish.mutate({ postId: post.id })}
                      >
                        下架
                      </Button>
                    )}
                    {post.mediaUrl && (
                      <a href={post.mediaUrl} target="_blank" rel="noreferrer" className="m-touch" style={{ fontSize: "var(--fs-12)" }}>
                        開媒體
                      </a>
                    )}
                  </div>

                  {pickerPostId === post.id && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 10,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--surface-2, rgba(0,0,0,0.03))",
                      }}
                    >
                      <Meta as="div" style={{ marginBottom: 8 }}>
                        選擇要帶入的專案（會預填生成台並開啟工作台）
                      </Meta>
                      {projects.isLoading && <Meta>載入專案…</Meta>}
                      {projects.data && projects.data.length === 0 && (
                        <Meta>你還沒有專案——先到今日工作台建立一個。</Meta>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {(projects.data ?? []).slice(0, 20).map((p) => (
                          <Button
                            key={p.id}
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => applyRemix(post, p.id)}
                          >
                            {p.title}
                          </Button>
                        ))}
                        <Button type="button" size="sm" variant="ghost" onClick={() => setPickerPostId(null)}>
                          取消
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Hint style={{ marginTop: 24 }}>
        「一鍵再用」會把完整 prompt（與模型／設定卡 id）寫進你選的專案草稿，並跳到生成台；同時累加再用次數。
      </Hint>
    </div>
  );
}
