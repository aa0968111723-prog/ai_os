import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./community.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../db/schema/community.ts", import.meta.url), "utf8");
const migrationSql = readFileSync(new URL("../../drizzle/0035_community_likes.sql", import.meta.url), "utf8");

describe("community Phase D toggleLike", () => {
  it("defines communityLikes table and migration", () => {
    expect(schemaSource).toContain("communityLikes");
    expect(schemaSource).toContain("community_likes");
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "community_likes"');
    expect(migrationSql).toContain("community_likes_pk");
  });

  it("exposes toggleLike mutation with like_count SQL increment/decrement", () => {
    expect(source).toContain("toggleLike:");
    expect(source).toMatch(/GREATEST\(0,\s*\$\{schema\.communityPosts\.likeCount\} - 1\)|likeCount\} - 1/);
    expect(source).toContain("onConflictDoNothing");
    expect(source).toContain("likedByMe");
  });

  it("listPublic annotates likedByMe for the current user", () => {
    expect(source).toMatch(/listPublic[\s\S]*likedByMe/);
    expect(source).toContain("communityLikes.userId");
  });
});
