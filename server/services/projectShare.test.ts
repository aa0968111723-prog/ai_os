/**
 * 分享連結的「能不能用」規則與 token 形狀——這是全庫唯一免登入的內容出口，
 * 每一條擋人的規則都要有測試盯著，不能只靠 router 裡讀起來對的程式碼。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHARE_PATH_PREFIX,
  classifyShareLink,
  generateShareToken,
  hashShareToken,
  isWellFormedShareToken,
} from "./projectShare";

const HOUR = 3600_000;
const now = new Date("2026-08-07T00:00:00Z");

describe("classifyShareLink（連結可用性）", () => {
  it("沒有期限、沒被撤銷的連結可以用", () => {
    expect(classifyShareLink({ expiresAt: null, revokedAt: null }, now)).toEqual({ ok: true });
  });

  it("還沒到期的連結可以用；到期時刻起就不能用", () => {
    expect(classifyShareLink({ expiresAt: new Date(now.getTime() + HOUR), revokedAt: null }, now).ok).toBe(true);
    expect(classifyShareLink({ expiresAt: new Date(now.getTime() - 1), revokedAt: null }, now))
      .toEqual({ ok: false, reason: "expired" });
    // 邊界：expiresAt 正好等於現在＝已過期（<= 而非 <），避免「剛好那一毫秒還能開」
    expect(classifyShareLink({ expiresAt: now, revokedAt: null }, now))
      .toEqual({ ok: false, reason: "expired" });
  });

  it("撤銷優先於期限——撤銷後即使還沒到期也擋，且理由要說是被收回", () => {
    const verdict = classifyShareLink(
      { expiresAt: new Date(now.getTime() + HOUR), revokedAt: new Date(now.getTime() - HOUR) },
      now,
    );
    expect(verdict).toEqual({ ok: false, reason: "revoked" });
  });

  it("查無此列＝not-found（不透露專案是否存在）", () => {
    expect(classifyShareLink(undefined, now)).toEqual({ ok: false, reason: "not-found" });
    expect(classifyShareLink(null, now)).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("分享 token", () => {
  it("是 64 字小寫 hex（32 bytes 亂數），每次都不同", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(isWellFormedShareToken(a)).toBe(true);
  });

  it("形狀不對的一律先擋掉，不必打 DB", () => {
    for (const bad of ["", "abc", "Z".repeat(64), "a".repeat(63), "a".repeat(65), "../../etc/passwd"]) {
      expect(isWellFormedShareToken(bad)).toBe(false);
    }
  });

  it("DB 只認雜湊：同一 token 穩定、不同 token 不同，且雜湊不等於原文", () => {
    const token = generateShareToken();
    expect(hashShareToken(token)).toBe(hashShareToken(token));
    expect(hashShareToken(token)).not.toBe(token);
    expect(hashShareToken(token)).not.toBe(hashShareToken(generateShareToken()));
  });

  it("前端路由前綴與後端產生的網址一致", () => {
    expect(SHARE_PATH_PREFIX).toBe("/s/");
  });
});

describe("公開出口的資料界線（buildSharedProjectView 原始碼契約）", () => {
  const source = readFileSync(new URL("./projectShare.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function buildSharedProjectView"));

  it("知識庫與素材一律過濾回收桶——刪掉的逐字稿不能從公開連結復活", () => {
    expect(body).toContain("isNull(schema.knowledge.deletedAt)");
    expect(body).toContain("isNull(schema.assets.deletedAt)");
    expect(body).toContain("isNull(schema.scenes.deletedAt)");
  });

  it("不外洩任何人的身分——公開包裡沒有 createdBy／uploadedBy／ownerId 欄位", () => {
    for (const field of ["createdBy:", "uploadedBy:", "ownerId:", "groupId:"]) {
      expect(body).not.toContain(field);
    }
  });
});

describe("公開端點的守衛（share router 原始碼契約）", () => {
  const source = readFileSync(new URL("../routers/share.ts", import.meta.url), "utf8");
  const view = source.slice(source.indexOf("view: publicProcedure"));

  it("view 是整支 router 唯一的 publicProcedure，其餘都要登入", () => {
    expect(source.match(/publicProcedure/g)).toHaveLength(2); // import 一次、使用一次
    expect(source.match(/authedProcedure/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("公開端點先限流再解析 token（掃描打不動 DB）", () => {
    expect(view.indexOf("consumeRateLimit")).toBeLessThan(view.indexOf("resolveShareLink"));
  });

  it("建立與撤銷都要求「可編輯」——檢視者不能對外開連結", () => {
    expect(source).toContain("assertProjectEditable");
    const create = source.slice(source.indexOf("create: authedProcedure"), source.indexOf("revoke: authedProcedure"));
    const revoke = source.slice(source.indexOf("revoke: authedProcedure"), source.indexOf("view: publicProcedure"));
    expect(create).toContain("loadEditableProject");
    expect(revoke).toContain("loadEditableProject");
  });

  it("清單不回傳 token 雜湊——連內部人也不該從 API 拿到可比對的憑證材料", () => {
    const list = source.slice(source.indexOf("list: authedProcedure"), source.indexOf("create: authedProcedure"));
    expect(list).not.toContain("tokenHash");
  });
});
