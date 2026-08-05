/**
 * 靜態契約：前端渲染路徑不得出現會 throw 的 `worldviewSchema.parse(...)`。
 *
 * 背景：專案頁曾整頁掉進 ErrorBoundary（「畫面出了點狀況」）——原因是 render 時直接
 * `worldviewSchema.parse(p.worldview ?? {})`，一遇到 legacy／畸形 worldview（超長字串、
 * 陣列超標、非字串成員）就丟例外，使用者連專案都打不開。前端一律走 parseWorldviewSafe。
 *
 * 後端可以繼續用會 throw 的 parse（寫入要拒絕壞資料），這條線只管 client。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const clientSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue; // 測試造資料可以用嚴格 parse
    out.push(full);
  }
  return out;
}

describe("client worldview parsing is crash-proof", () => {
  it("no client source calls the throwing worldviewSchema.parse", () => {
    const offenders = sourceFiles(clientSrc)
      .filter((f) => /worldviewSchema\s*\.\s*parse\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(clientSrc, f));

    expect(
      offenders,
      `這些檔案要改用 parseWorldviewSafe（見 @shared/parseWorldviewSafe）：${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("ProjectPage reads worldview through parseWorldviewSafe", () => {
    const src = readFileSync(join(clientSrc, "pages", "ProjectPage.tsx"), "utf8");
    expect(src).toMatch(/from ["']@shared\/parseWorldviewSafe["']/);
    expect(src).toMatch(/parseWorldviewSafe\(p\.worldview\)/);
  });
});
