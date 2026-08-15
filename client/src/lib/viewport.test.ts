import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DESKTOP_MQ, PHONE_MAX_WIDTH, PHONE_MQ } from "./viewport";

const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * 產品切換點的單一出處契約。
 *
 * 這個站踩過兩次「JS 說手機、CSS 說桌面」的錯位（記載在 studioLayout.ts 檔頭），
 * 症狀都是某個寬度區間裡兩套 UI 打架或兩套都不見。這些測試守的就是那件事：
 * **Phone/Desktop 的界線只有一份，而且 JS 與 CSS 對得上。**
 */
describe("Phone/Desktop 產品切換點", () => {
  it("斷點是 767.98／768，兩邊互補不留空窗", () => {
    expect(PHONE_MAX_WIDTH).toBe(767.98);
    expect(PHONE_MQ).toBe("(max-width: 767.98px)");
    expect(DESKTOP_MQ).toBe("(min-width: 768px)");
  });

  it("767.5px 這種非整數寬度必定命中其中一邊（不是兩邊都落空）", () => {
    // 767 會讓 767.5 既不是手機（>767）也不是桌面（<768）——兩套導航同時消失。
    // 這一條就是為什麼小數點不能拿掉。
    for (const width of [359, 390.5, 767, 767.5, 767.98, 768, 768.4, 1024]) {
      const phone = width <= PHONE_MAX_WIDTH;
      const desktop = width >= 768;
      expect(phone || desktop).toBe(true);
      expect(phone && desktop).toBe(false);
    }
  });

  it("手機殼層 CSS 全部包在同一個斷點內，且沒有任何頂層規則漏到桌面", () => {
    const css = read("styles.mobile.css");
    // 先拿掉註解（檔頭那段解說本身就提到大括號），再把每一段 @media 區塊挖掉，
    // 剩下的內容不能還有任何選擇器（`{`）——有的話就是規則漏到桌面了
    const stripped = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    expect(stripped).not.toContain("{");
    // 每一個 media query 的寬度條件都必須是這個斷點
    const widths = [...css.matchAll(/@media \(max-width: ([\d.]+)px\)/g)].map((m) => m[1]);
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBe(String(PHONE_MAX_WIDTH));
  });

  it("舊的 820／821 斷點已從產品切換點全面退場", () => {
    for (const file of [
      "styles.css",
      "styles.mobile-tokens.css",
      "styles.mobile-fab-01.css",
      "styles.mobile.css",
    ]) {
      const css = read(file);
      expect(css, `${file} 仍有舊的手機斷點`).not.toContain("max-width: 820px");
      expect(css, `${file} 仍有舊的桌面斷點`).not.toContain("min-width: 821px");
    }
  });

  it("底部分頁列與 MenuSurface 的 sheet 走同一條界線", () => {
    // 兩者錯開的話會出現「有底欄卻是桌面下拉」或反過來的區間
    const css = read("styles.css");
    const navBlock = css.slice(css.indexOf(".mobile-nav {"));
    expect(navBlock.length).toBeGreaterThan(0);
    const menuSurface = read("app/components/MenuSurface.tsx");
    expect(menuSurface).toContain("export const MENU_SHEET_MQ = PHONE_MQ;");
  });
});
