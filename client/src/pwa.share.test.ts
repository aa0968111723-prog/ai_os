/**
 * Web Share Target 契約守衛：manifest、Service Worker、接收頁三端的交握是純字串約定
 * （cache 命名空間、meta key、路由路徑），任何一端改名其他端不會有編譯錯誤——鎖在這裡。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("Web Share Target contract", () => {
  it("manifest 宣告 share_target：POST multipart 到 /share-target、檔案欄位名 media", () => {
    const manifest = JSON.parse(read("client/public/manifest.webmanifest")) as {
      share_target?: { action: string; method: string; enctype: string; params: { files: { name: string }[] } };
    };
    expect(manifest.share_target?.action).toBe("/share-target");
    expect(manifest.share_target?.method).toBe("POST");
    expect(manifest.share_target?.enctype).toBe("multipart/form-data");
    expect(manifest.share_target?.params.files?.[0]?.name).toBe("media");
  });

  it("sw.js 攔 POST /share-target、寫入 aios-share-inbox、303 轉接收頁", () => {
    const sw = read("client/public/sw.js");
    expect(sw).toContain('"aios-share-inbox"');
    expect(sw).toContain('url.pathname === "/share-target"');
    expect(sw).toContain('form.getAll("media")');
    expect(sw).toContain('Response.redirect("/share-target", 303)');
    // 檔案清單契約：接收頁靠 meta 索引檔案
    expect(sw).toContain('"/share-payload/meta"');
  });

  it("接收頁讀同一個 cache 命名空間與 meta key，路由已註冊", () => {
    const page = read("client/src/pages/ShareTargetPage.tsx");
    expect(page).toContain('"aios-share-inbox"');
    expect(page).toContain('"/share-payload/meta"');
    const routes = read("client/src/app/AppRoutes.tsx");
    // 已分組與未分組兩個路由表都要接得住分享
    expect(routes.match(/path="\/share-target"/g)?.length).toBe(2);
  });
});
