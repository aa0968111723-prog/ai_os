import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(__dirname, file), "utf8");

/**
 * 手機分頁的共同契約：**bump 分頁參數不得清空畫面**。
 *
 * react-query 把查詢輸入當成 key，所以「多抓一頁」＝換一支全新的查詢：
 * `data` 瞬間變 `undefined`、`isLoading` 變 `true`。任何寫成
 * `isLoading && !data → 骨架` 的元件都會在使用者按下「載入更多／看全部」的當下
 * 把**已經載好的內容整片換成骨架**，捲動位置一併被夾回頂端——分頁的本意剛好相反。
 *
 * 這個站踩過兩次同一個坑：先在 MobileHome 修好，卻沒有回頭掃同一種寫法，
 * MobileAssetSheet 原封不動地又犯一次。所以這條測試不綁單一檔案，而是列舉
 * 「所有把分頁參數放進 query key 的手機元件」，逐一要求它們保留前一份資料。
 *
 * 加新的分頁畫面時把它加進 PAGED 陣列——漏加不會被這裡抓到，但漏寫
 * placeholderData 會。
 */
const PAGED = [
  { file: "MobileHome.tsx", surface: "手機首頁「看全部專案」" },
  { file: "MobileAssetSheet.tsx", surface: "手機素材抽屜「載入更多」" },
];

describe("手機分頁契約", () => {
  it.each(PAGED)("$surface 換分頁參數時保留前一份資料", ({ file }) => {
    const src = read(file);
    // 前提：這個檔案真的把分頁參數放進了 query key（否則這條測試在測空氣）
    expect(src, `${file} 沒有分頁參數，PAGED 名單可能過期`).toMatch(/limit/);
    expect(
      src.replace(/\/\*[\s\S]*?\*\//g, ""),
      `${file} 的分頁查詢缺少 placeholderData：按下去會把已載入的內容換成骨架`,
    ).toContain("placeholderData: (previous) => previous");
  });

  it.each(PAGED)("$surface 的骨架分支要同時看 isLoading 與 data", ({ file }) => {
    // placeholderData 之所以有效，靠的是骨架分支有 `&& !data` 這一半；
    // 只看 isLoading 的話，保留了資料也照樣會閃回骨架。
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    const skeleton = /is(Loading|Pending)\s*&&\s*!\w+\.?\w*data/i;
    expect(skeleton.test(src), `${file} 的載入分支沒有同時檢查既有資料`).toBe(true);
  });
});
