/**
 * 靈感頻道貼文的前端型別。
 *
 * 刻意手寫而不是從 router 推型別：這一份是「畫面需要什麼」，
 * 欄位增刪時 TypeScript 會在元件上報錯，而不是靜靜地讓畫面少一塊。
 */
export type InspirationPost = {
  id: string;
  title: string;
  description?: string | null;
  promptText?: string | null;
  modelId?: string | null;
  mediaKind: string;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  sourceType: string;
  useCount: number;
  likeCount: number;
  likedByMe?: boolean;
  publishedAt: string | Date;
  status?: string;
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
  /** 作者手寫標籤 */
  tags?: string[] | null;
  /** 自動細化分類（`facet:value`） */
  autoTags?: string[] | null;
  /** 主分類（autoTags 之一） */
  category?: string | null;
};

/**
 * 由貼文 id 推一個穩定色相：沒有縮圖的貼文（提示詞、設定卡）靠它得到專屬底色。
 * 用途純視覺，只要「同一則永遠同一色、不同則盡量不同色」即可。
 */
export function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

/** 這則貼文有沒有可播放／可顯示的視覺媒體 */
export function hasVisualMedia(post: InspirationPost): boolean {
  return Boolean(post.mediaUrl) && (post.mediaKind === "image" || post.mediaKind === "video");
}
