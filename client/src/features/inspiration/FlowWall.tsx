/**
 * 靈感牆：masonry 排版的作品牆（見 styles.inspiration.css 的 .flow-wall）。
 *
 * 用 CSS columns 而不是 grid：每張圖的長寬比不同，grid 只能靠裁切對齊，
 * 而裁切會把「作者選的構圖」切掉——這面牆展示的正是構圖。
 */
import { FlowTile } from "./FlowTile";
import type { InspirationPost } from "./types";

export function FlowWall({
  posts,
  onOpen,
  loading,
  emptyTitle,
  emptyHint,
}: {
  posts: InspirationPost[];
  onOpen: (post: InspirationPost) => void;
  loading?: boolean;
  emptyTitle: string;
  emptyHint: string;
}) {
  if (loading) {
    return (
      <div className="flow-wall" aria-busy="true">
        {/* 骨架也走 masonry：載入完不會整面重排 */}
        {[220, 300, 180, 260, 200, 320].map((h, i) => (
          <div
            key={i}
            className="flow-tile"
            style={{ height: h, background: "rgba(246,242,234,.05)", cursor: "default" }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="flow-empty">
        <div style={{ fontSize: "var(--fs-15)", marginBottom: 6 }}>{emptyTitle}</div>
        <div>{emptyHint}</div>
      </div>
    );
  }

  return (
    <div className="flow-wall">
      {posts.map((post) => (
        <FlowTile key={post.id} post={post} onOpen={onOpen} />
      ))}
    </div>
  );
}
