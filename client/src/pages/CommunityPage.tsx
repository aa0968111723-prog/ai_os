/**
 * 靈感頻道（Flow-TV 風格）：全站共用提示詞與多模態素材
 * - listPublic feed
 * - Show Prompt
 * - 一鍵再用（recordUse + 複製 prompt）
 */
import { useState } from "react";
import { trpc } from "../api";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Button, Card, Chip, EmptyState, Hint, Meta, Skeleton } from "../components/ui";
import { Icon } from "../components/Icon";

type SortMode = "recent" | "popular";
type MediaFilter = "all" | "text" | "image" | "video" | "audio" | "card";

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

export function CommunityPage() {
  const [sort, setSort] = useState<SortMode>("recent");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const [reuseFlash, setReuseFlash] = useState<string | null>(null);

  const list = trpc.community.listPublic.useQuery({
    limit: 24,
    sort,
    mediaKind: mediaFilter === "all" ? undefined : mediaFilter,
  });

  const recordUse = trpc.community.recordUse.useMutation({
    onSuccess: (_d, vars) => {
      setReuseFlash(vars.postId);
      setTimeout(() => setReuseFlash((s) => (s === vars.postId ? null : s)), 1600);
    },
  });

  const items = list.data?.items ?? [];
  const empty = !list.isLoading && items.length === 0;

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

  const onReuse = (post: { id: string; promptText: string | null }) => {
    if (post.promptText) {
      navigator.clipboard.writeText(post.promptText).catch(() => {});
    }
    recordUse.mutate({ postId: post.id });
  };

  return (
    <div data-fb="靈感頻道" style={{ maxWidth: 920, margin: "0 auto", padding: "0 12px 48px" }}>
      <SecondaryPageHeader
        eyebrow="全站共用"
        title="靈感頻道"
        icon="Sparkles"
        description={
          <>
            別人發布的提示詞、生成結果與設定卡——可偷看完整 prompt、一鍵複製再用。
            在專案的提示詞庫按「發布」即可上架。
          </>
        }
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, alignItems: "center" }}>
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
      </div>

      {list.isLoading && (
        <div style={{ marginTop: 20 }} aria-busy="true">
          <Skeleton height={88} style={{ marginBottom: 12 }} />
          <Skeleton height={88} style={{ marginBottom: 12 }} />
          <Skeleton height={88} />
        </div>
      )}

      {list.error && (
        <p className="error" style={{ marginTop: 16 }}>
          {list.error.message}
        </p>
      )}

      {empty && (
        <EmptyState
          icon={<Icon name="Sparkles" />}
          title={<>還沒有公開貼文</>}
          description={
            <>
              到專案提示詞庫按「發布」，把好用的咒語上架到靈感頻道，讓全站夥伴都能偷看與再用。
            </>
          }
          style={{ marginTop: 24 }}
        />
      )}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((post) => {
          const expanded = expandedId === post.id;
          const hasPrompt = Boolean(post.promptText?.trim());
          return (
            <Card key={post.id} as="article" style={{ padding: "12px 14px" }}>
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
                    <strong style={{ fontSize: "var(--fs-14)" }}>{post.title}</strong>
                    <Chip style={{ fontSize: "var(--fs-11)" }}>
                      {SOURCE_LABEL[post.sourceType] ?? post.sourceType}
                    </Chip>
                    {post.mediaKind !== "text" && (
                      <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
                        {post.mediaKind}
                      </Meta>
                    )}
                  </div>
                  {post.description && (
                    <p style={{ margin: "4px 0 0", fontSize: "var(--fs-13)", opacity: 0.85 }}>
                      {post.description}
                    </p>
                  )}
                  <Meta as="div" style={{ marginTop: 4, fontSize: "var(--fs-11)" }}>
                    {[
                      post.modelId ? `模型 ${post.modelId}` : "",
                      post.useCount > 0 ? `再用 ${post.useCount}` : "",
                      post.likeCount > 0 ? `讚 ${post.likeCount}` : "",
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
                    {hasPrompt && (
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        disabled={recordUse.isPending}
                        onClick={() => onReuse(post)}
                        title="複製提示詞並記一次再用"
                      >
                        {reuseFlash === post.id ? "已記再用 ✓" : "一鍵再用"}
                      </Button>
                    )}
                    {post.mediaUrl && (
                      <a href={post.mediaUrl} target="_blank" rel="noreferrer" style={{ fontSize: "var(--fs-12)" }}>
                        開媒體
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Hint style={{ marginTop: 24 }}>
        提示：目前「一鍵再用」會複製完整 prompt 到剪貼簿並增加使用次數；之後會支援直接帶入你指定的專案生成台。
      </Hint>
    </div>
  );
}
