import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DESKTOP_MQ, PHONE_MAX_WIDTH, PHONE_MQ } from "./viewport";
import { atRuleBlocks, mediaPreludeOf, topLevelCss } from "../test/cssBlocks";

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
    // 逐一挖掉每個 at-rule 區塊（真的配對大括號），剩下的頂層內容必須是空的。
    // 舊寫法用一個貪婪 regex 從第一個區塊刪到檔尾，第一個區塊之後的頂層規則
    // 全被吃掉，等於永遠驗不到。
    expect(topLevelCss(css)).toBe("");

    // 每一個 at-rule 都必須是「手機以下」——不能有 min-width、也不能有別的寬度。
    // 舊寫法只掃 max-width，塞一個 @media (min-width: 768px) 進來照樣綠。
    const blocks = atRuleBlocks(css);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.prelude, `這個 at-rule 不是手機專屬：${block.prelude}`)
        .toContain(`max-width: ${PHONE_MAX_WIDTH}px`);
      expect(block.prelude, `這個 at-rule 會套用到桌面：${block.prelude}`)
        .not.toContain("min-width");
    }
  });

  it("舊的 820／821 斷點已從產品切換點全面退場（掃全部 CSS 與 TS，不只挑幾個檔）", () => {
    // 舊版只掃四個 CSS 檔，掃不到 .ts/.tsx，也掃不到其他樣式表——
    // 少列一個檔就等於那個檔可以偷偷留著舊斷點。改成走整個 client/src。
    const root = path.join(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(css|ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(100);

    /**
     * 唯一允許保留 820 的地方：BrandLogo 的 <picture> source。
     * 那是「DPR 高的小螢幕改抓 62KB webp」的**圖片來源**斷點，不是 Phone/Desktop
     * 的產品切換點——刻意不動（見 brand.ts 的註解）。列成白名單而不是放寬條件，
     * 這樣任何**新的** 820 都還是會紅。
     */
    const ALLOWED = new Set([path.join(root, "components", "BrandLogo.tsx")]);

    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.has(file) || file.endsWith("viewport.test.ts")) continue;
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/max-width:\s*820px|min-width:\s*821px/.test(text)) {
        offenders.push(path.relative(root, file));
      }
    }
    expect(offenders, `這些檔案還留著舊的產品切換斷點：${offenders.join(", ")}`).toEqual([]);
  });

  it("底部分頁列與 MenuSurface 的 sheet 走同一條界線", () => {
    // 兩者錯開的話會出現「有底欄卻是桌面下拉」或反過來的區間。
    // 舊寫法是 `slice(indexOf(...))` 再驗長度 > 0 —— indexOf 找不到時回 -1、
    // slice(-1) 回最後一個字元、長度 1，斷言照樣通過，等於什麼都沒驗。
    const navPrelude = mediaPreludeOf(read("styles.css"), ".mobile-nav {");
    expect(navPrelude, "底部分頁列不在任何 media query 內——桌面會看到它").not.toBeNull();
    expect(navPrelude).toContain(`max-width: ${PHONE_MAX_WIDTH}px`);

    const menuSurface = read("app/components/MenuSurface.tsx");
    expect(menuSurface).toContain("export const MENU_SHEET_MQ = PHONE_MQ;");
  });
});
