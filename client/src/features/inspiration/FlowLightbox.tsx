/**
 * 靈感貼文細節浮層。
 *
 * 一格點開之後要能**一次做完所有事**：看完整 prompt、複製、分享、帶進自己的專案。
 * 若還要關掉浮層回列表找按鈕，等於白開一層。
 */
import { useEffect, useRef, useState } from "react";
import { groupInspirationTags } from "@shared/inspirationTaxonomy";
import { Icon } from "../../components/Icon";
import { hasVisualMedia, type InspirationPost } from "./types";

export type FlowLightboxProps = {
  post: InspirationPost;
  onClose: () => void;
  /** feed 才有讚；我的發布分頁不顯示 */
  onToggleLike?: (post: InspirationPost) => void;
  likePending?: boolean;
  onCopyPrompt: (post: InspirationPost) => void;
  copied?: boolean;
  onShare: (post: InspirationPost) => void;
  /** 分享結果提示（"已複製連結" / "已分享"），null＝不顯示 */
  shareNote?: string | null;
  /** 一鍵再用：選專案後帶入生成台 */
  onReuse?: (post: InspirationPost, projectId: string) => void;
  projects?: { id: string; title: string }[];
  projectsLoading?: boolean;
  reused?: boolean;
  /** 作者操作 */
  onUnpublish?: (post: InspirationPost) => void;
  onRepublish?: (post: InspirationPost) => void;
  mutating?: boolean;
};

export function FlowLightbox({
  post,
  onClose,
  onToggleLike,
  likePending,
  onCopyPrompt,
  copied,
  onShare,
  shareNote,
  onReuse,
  projects,
  projectsLoading,
  reused,
  onUnpublish,
  onRepublish,
  mutating,
}: FlowLightboxProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [picking, setPicking] = useState(false);
  const visual = hasVisualMedia(post);
  const prompt = post.promptText?.trim();
  const facetGroups = groupInspirationTags(post.autoTags ?? []);

  // Esc 關閉：浮層蓋住整個畫面時，鍵盤使用者必須有出口
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="flow-lightbox"
      role="presentation"
      // 點背景關閉；點面板本身不該關（事件冒泡到這裡時 target 已不是背景）
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flow-lightbox__panel"
        role="dialog"
        aria-modal="true"
        aria-label={post.title}
        tabIndex={-1}
        ref={panelRef}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
          <strong style={{ flex: 1, fontSize: "var(--fs-15)", overflowWrap: "anywhere" }}>{post.title}</strong>
          <button type="button" className="flow-action" onClick={onClose} aria-label="關閉">
            <Icon name="X" size={15} />
          </button>
        </div>

        {visual &&
          (post.mediaKind === "video" ? (
            <video className="flow-lightbox__media" src={post.mediaUrl ?? undefined} controls playsInline />
          ) : (
            <img className="flow-lightbox__media" src={post.mediaUrl ?? undefined} alt={post.title} />
          ))}
        {post.mediaKind === "audio" && post.mediaUrl && (
          <audio src={post.mediaUrl} controls style={{ width: "100%", marginTop: 8 }} />
        )}

        {post.description && (
          <p style={{ margin: "12px 0 0", fontSize: "var(--fs-13)", lineHeight: 1.65, opacity: 0.86 }}>
            {post.description}
          </p>
        )}

        {facetGroups.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            {facetGroups.map((group) =>
              group.tags.map((t) => (
                <span key={t.tag} className="flow-tile__badge" title={group.facet.label}>
                  {group.facet.label}·{t.label}
                </span>
              )),
            )}
          </div>
        )}

        {prompt ? (
          <pre className="flow-lightbox__prompt mono">{prompt}</pre>
        ) : (
          <p style={{ marginTop: 12, fontSize: "var(--fs-12)", opacity: 0.6 }}>
            這則沒有附提示詞——發布時可以補上，別人才能一鍵再用。
          </p>
        )}

        <div style={{ marginTop: 10, fontSize: "var(--fs-11)", opacity: 0.62 }}>
          {[
            post.modelId ? `模型 ${post.modelId}` : "",
            post.likeCount > 0 ? `讚 ${post.likeCount}` : "",
            post.useCount > 0 ? `再用 ${post.useCount}` : "",
            new Date(post.publishedAt).toLocaleDateString(),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>

        <div className="flow-lightbox__actions">
          {onToggleLike && (
            <button
              type="button"
              className="flow-action"
              disabled={likePending}
              onClick={() => onToggleLike(post)}
              style={post.likedByMe ? { color: "var(--flow-accent, #f2b24c)", fontWeight: 600 } : undefined}
            >
              <Icon name="Star" size={14} />
              {post.likedByMe ? "已讚" : "讚"}
              {post.likeCount > 0 ? ` ${post.likeCount}` : ""}
            </button>
          )}
          {prompt && (
            <button type="button" className="flow-action" onClick={() => onCopyPrompt(post)}>
              <Icon name="Copy" size={14} />
              {copied ? "已複製" : "複製 Prompt"}
            </button>
          )}
          <button type="button" className="flow-action" onClick={() => onShare(post)}>
            <Icon name="Share2" size={14} />
            {shareNote ?? "分享"}
          </button>
          {post.mediaUrl && (
            <a className="flow-action" href={post.mediaUrl} target="_blank" rel="noreferrer">
              <Icon name="Download" size={14} />
              開媒體
            </a>
          )}
          {onReuse && prompt && (
            <button
              type="button"
              className="flow-action flow-action--primary"
              onClick={() => setPicking((v) => !v)}
            >
              <Icon name="Sparkles" size={14} />
              {reused ? "已帶入 ✓" : "一鍵再用"}
            </button>
          )}
          {onUnpublish && post.status === "published" && (
            <button type="button" className="flow-action" disabled={mutating} onClick={() => onUnpublish(post)}>
              下架
            </button>
          )}
          {onRepublish && post.status === "hidden" && (
            <button type="button" className="flow-action" disabled={mutating} onClick={() => onRepublish(post)}>
              重新上架
            </button>
          )}
        </div>

        {picking && onReuse && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(246,242,234,.14)",
              background: "rgba(246,242,234,.05)",
            }}
          >
            <div style={{ fontSize: "var(--fs-12)", opacity: 0.7, marginBottom: 8 }}>
              選一個專案帶入（會預填生成台並跳過去）
            </div>
            {projectsLoading && <div style={{ fontSize: "var(--fs-12)", opacity: 0.7 }}>載入專案…</div>}
            {projects && projects.length === 0 && (
              <div style={{ fontSize: "var(--fs-12)", opacity: 0.7 }}>
                你還沒有專案——先到今日工作台建立一個。
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(projects ?? []).slice(0, 20).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="flow-action"
                  onClick={() => {
                    onReuse(post, p.id);
                    setPicking(false);
                  }}
                >
                  {p.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
