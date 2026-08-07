/**
 * 靈感牆的一格。
 *
 * Flow 的關鍵不是格子好不好看，而是**不點開就能看到 prompt**——
 * 這個頻道的價值全在「偷看別人怎麼寫」，把 prompt 藏在詳情頁裡會讓價值歸零。
 * 所以字幕層壓在畫面上：滑鼠移入淡入，觸控裝置常駐（見 styles.inspiration.css）。
 */
import { useRef } from "react";
import { inspirationTagLabel } from "@shared/inspirationTaxonomy";
import { Icon, type IconName } from "../../components/Icon";
import { hasVisualMedia, hueFromId, type InspirationPost } from "./types";

const KIND_ICON: Record<string, IconName> = {
  audio: "Music",
  card: "User",
  video: "Clapperboard",
  image: "Image",
  text: "Lightbulb",
};

/** 提示詞卡的引文：優先完整 prompt，沒有就退回標題 */
function posterQuote(post: InspirationPost): string {
  const prompt = post.promptText?.trim();
  return prompt || post.title;
}

export function FlowTile({
  post,
  onOpen,
}: {
  post: InspirationPost;
  onOpen: (post: InspirationPost) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const visual = hasVisualMedia(post);
  const prompt = post.promptText?.trim();
  const categoryLabel = post.category ? inspirationTagLabel(post.category) : null;
  // 主分類之外再露一個次分類：一格塞兩個標籤就足以說明「這是什麼樣的東西」。
  // 跳過 modality（圖片／影片／音訊）——右邊的種類圖示已經說了同一件事，
  // 佔掉這一格等於用兩個位置講一句話。
  const secondary = (post.autoTags ?? []).find(
    (t) => t !== post.category && !t.startsWith("modality:"),
  );

  /** 影片滑過即預覽——但只在有 hover 的裝置，行動網路不該被自動播放偷流量 */
  const previewOn = () => {
    const el = videoRef.current;
    if (!el || !window.matchMedia?.("(hover: hover)").matches) return;
    el.play().catch(() => {
      /* 自動播放被瀏覽器策略擋下不是錯誤，靜靜留在第一幀即可 */
    });
  };
  const previewOff = () => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  };

  return (
    <button
      type="button"
      className="flow-tile"
      style={{ ["--flow-hue" as string]: String(hueFromId(post.id)) }}
      onClick={() => onOpen(post)}
      onMouseEnter={previewOn}
      onMouseLeave={previewOff}
      aria-label={`${post.title}——開啟細節`}
    >
      {visual ? (
        post.mediaKind === "video" ? (
          <video
            ref={videoRef}
            className="flow-tile__media"
            src={post.mediaUrl ?? undefined}
            poster={post.thumbnailUrl ?? undefined}
            muted
            loop
            playsInline
            preload="metadata"
          />
        ) : (
          <img
            className="flow-tile__media"
            src={post.mediaUrl ?? undefined}
            alt={post.title}
            loading="lazy"
            decoding="async"
          />
        )
      ) : (
        <div className="flow-tile__poster">
          <div className="flow-tile__poster-quote">{posterQuote(post)}</div>
        </div>
      )}

      <div className="flow-tile__badges">
        {categoryLabel && <span className="flow-tile__badge flow-tile__badge--primary">{categoryLabel}</span>}
        {secondary && <span className="flow-tile__badge">{inspirationTagLabel(secondary)}</span>}
        <span className="flow-tile__badge">
          <Icon name={KIND_ICON[post.mediaKind] ?? "Lightbulb"} size={11} style={{ verticalAlign: "-1px" }} />
        </span>
      </div>

      {post.mediaKind === "video" && (
        <span className="flow-tile__play" aria-hidden="true">
          <Icon name="Play" size={16} />
        </span>
      )}

      {/* 有圖：字幕疊在畫面上（hover 淡入、觸控常駐）。
          純文字卡：卡面內容已經流到底部，字幕必須是正常流的一列，否則兩層會疊字。 */}
      <div className={visual ? "flow-tile__scrim" : "flow-tile__caption"}>
        <div className="flow-tile__prompt">{visual && prompt ? prompt : post.title}</div>
        <div className="flow-tile__meta">
          {post.modelId && <span>{post.modelId}</span>}
          {post.likeCount > 0 && <span>讚 {post.likeCount}</span>}
          {post.useCount > 0 && <span>再用 {post.useCount}</span>}
        </div>
      </div>
    </button>
  );
}
