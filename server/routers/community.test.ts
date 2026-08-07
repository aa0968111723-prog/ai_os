import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./community.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../db/schema/community.ts", import.meta.url), "utf8");
const taxonomyService = readFileSync(new URL("../services/communityTaxonomy.ts", import.meta.url), "utf8");
const migrationSql = readFileSync(new URL("../../drizzle/0035_community_likes.sql", import.meta.url), "utf8");
const migration0036 = readFileSync(
  new URL("../../drizzle/0036_community_likes_surrogate_pk.sql", import.meta.url),
  "utf8",
);
const migration0042 = readFileSync(
  new URL("../../drizzle/0042_community_taxonomy.sql", import.meta.url),
  "utf8",
);

describe("community Phase D toggleLike", () => {
  it("defines communityLikes table and migration", () => {
    expect(schemaSource).toContain("communityLikes");
    expect(schemaSource).toContain("community_likes");
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "community_likes"');
    expect(migrationSql).toContain("community_likes_pkey");
  });

  it("uses surrogate uuid PK + unique(post_id,user_id) to avoid drizzle-kit composite PK crash", () => {
    // Final schema shape — must not keep table-level composite primaryKey().
    expect(schemaSource).toMatch(/id:\s*uuid\("id"\)\.primaryKey\(\)/);
    expect(schemaSource).toContain('uniqueIndex("community_likes_post_user_uq")');
    expect(schemaSource).not.toMatch(/primaryKey\(\s*\{\s*name:\s*"community_likes_pk"/);
    expect(migrationSql).toContain("community_likes_post_user_uq");
    expect(migration0036).toContain("community_likes_pkey");
    expect(migration0036).toContain("community_likes_post_user_uq");
    expect(migration0036).toContain('DROP CONSTRAINT IF EXISTS "community_likes_pk"');
  });

  it("exposes toggleLike mutation with like_count SQL increment/decrement", () => {
    expect(source).toContain("toggleLike:");
    expect(source).toMatch(/GREATEST\(0,\s*\$\{schema\.communityPosts\.likeCount\} - 1\)|likeCount\} - 1/);
    expect(source).toContain("onConflictDoNothing");
    // surrogate PK 後必須明示 target，否則只對 id 生效
    expect(source).toMatch(/onConflictDoNothing\(\s*\{\s*target:\s*\[\s*schema\.communityLikes\.postId/);
    expect(source).toContain("likedByMe");
  });

  it("listPublic annotates likedByMe for the current user", () => {
    expect(source).toMatch(/listPublic[\s\S]*likedByMe/);
    expect(source).toContain("communityLikes.userId");
  });
});

describe("community Phase E 自動細化分類", () => {
  it("stores auto tags, primary category and dictionary version alongside author tags", () => {
    // autoTags 與作者 tags 必須是兩個欄位：重算分類時只覆寫前者，作者寫的字永遠不被機器蓋掉
    expect(schemaSource).toContain('autoTags: jsonb("auto_tags")');
    expect(schemaSource).toContain('category: text("category")');
    expect(schemaSource).toContain('taxonomyVersion: integer("taxonomy_version")');
    expect(schemaSource).toContain('tags: jsonb("tags")');

    expect(migration0042).toContain('ADD COLUMN IF NOT EXISTS "auto_tags" jsonb');
    expect(migration0042).toContain('ADD COLUMN IF NOT EXISTS "category" text');
    expect(migration0042).toContain('ADD COLUMN IF NOT EXISTS "taxonomy_version" integer');
    // 分類欄位一律 IF NOT EXISTS：重跑無害才進得了 legacy adoption bridge 的計數
    for (const line of migration0042.split("\n")) {
      if (line.startsWith("ALTER TABLE")) expect(line).toContain("IF NOT EXISTS");
      if (line.startsWith("CREATE INDEX")) expect(line).toContain("IF NOT EXISTS");
    }
  });

  it("indexes auto_tags with GIN so jsonb containment filters can use an index", () => {
    expect(schemaSource).toContain('index("community_posts_auto_tags_idx").using("gin"');
    expect(migration0042).toContain('USING gin ("auto_tags")');
    expect(migration0042).toContain('"community_posts_category_idx"');
  });

  it("classifies on publish and re-classifies on republish", () => {
    expect(source).toContain("taxonomyFieldsFor");
    // 發布時把分類欄位一起寫進快照
    expect(source).toMatch(/const taxonomy = taxonomyFieldsFor\(/);
    expect(source).toContain("...taxonomy,");
    expect(source).toContain("republish:");
  });

  it("heals stale classifications on read instead of requiring a backfill deploy", () => {
    expect(source).toContain("healInspirationTaxonomy");
    // feed 與「我的發布」兩條讀取路徑都要修復，否則作者永遠看到舊分類
    expect(source).toMatch(/listPublic[\s\S]*healInspirationTaxonomy/);
    expect(source).toMatch(/myPosts[\s\S]*healInspirationTaxonomy/);
    // 回寫不得動 updated_at：重新分類不是作者編輯
    expect(taxonomyService).not.toMatch(/set\(\{[^}]*updatedAt/);
    // 回寫失敗只能記錄，不能讓整頁 feed 掛掉
    expect(taxonomyService).toContain(".catch(");
  });

  it("filters by facet tags with AND semantics and validates them against the dictionary", () => {
    expect(source).toContain("facetTagSchema");
    expect(source).toContain("isKnownInspirationTag");
    // 多個 facet 各推一條 @> 條件進同一個 and(...)：交集而非聯集
    expect(source).toMatch(/for \(const facet of input\.facets \?\? \[\]\) \{\s*conditions\.push/);
    expect(source).toContain("autoTags} @> ");
  });

  it("exposes facetCounts for the filter rail", () => {
    expect(source).toContain("facetCounts:");
    expect(source).toContain("jsonb_array_elements_text");
    // 計數必須跟著目前的篩選條件收斂，否則點下去又是空的
    expect(source).toMatch(/facetCounts[\s\S]*input\.facets \?\? \[\]/);
  });
});

describe("community 上傳直發", () => {
  it("lets an uploaded asset carry the prompt that made it — and only an asset", () => {
    expect(source).toContain("promptText: z.string().max(20_000).optional()");
    expect(source).toContain("modelId: z.string().max(120).optional()");
    // prompt／generation 的 promptText 是系統快照的事實，不接受貼文覆寫
    const assetBranch = source.slice(
      source.indexOf('} else if (input.sourceType === "asset") {'),
      source.indexOf('} else if (input.sourceType === "character") {'),
    );
    expect(assetBranch).toContain("promptText = input.promptText?.trim() || null");
    expect(assetBranch).toContain("modelId = input.modelId?.trim() || null");

    const promptBranch = source.slice(
      source.indexOf('if (input.sourceType === "prompt") {'),
      source.indexOf('} else if (input.sourceType === "generation") {'),
    );
    expect(promptBranch).not.toContain("input.promptText");
  });

  it("feeds the uploaded file name into classification without exposing it", () => {
    expect(source).toContain("fileNameFromAssetMeta");
    expect(source).toContain("fileName,");
  });

  it("keeps every publish path behind the existing project ACL", () => {
    // 上傳直發不是新的寫入管線：素材仍由 /api/upload 落地，這裡只是把快照發布出去，
    // 所以每一條來源分支都必須維持組隔離＋專案可編輯檢查
    const branches = source.match(/requireGroup\(ctx\.auth, row\.groupId\)/g) ?? [];
    expect(branches.length).toBe(6);
    const acl = source.match(/assertProjectEditable\(ctx\.auth, \{ id: row\.projectId/g) ?? [];
    expect(acl.length).toBe(6);
  });
});

describe("community republish", () => {
  it("is author-only, refuses admin removals and survives the source-active unique index", () => {
    const republish = source.slice(source.indexOf("republish:"), source.indexOf("/** 一鍵再用時呼叫"));
    expect(republish).toContain("只能上架自己的貼文");
    // removed＝管理員下架，作者不得自行復原
    expect(republish).toContain('post.status !== "hidden"');
    expect(republish).toContain("community_posts_source_active_uq");
    expect(republish).toContain('code: "CONFLICT"');
  });
});
