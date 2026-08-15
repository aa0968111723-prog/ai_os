/**
 * 樣式契約測試用的小工具：真正的大括號配對，取代 regex 與 slice。
 *
 * ## 為什麼需要它
 *
 * 站內的「這條規則只准活在手機 media query 內」契約測試原本都靠字串操作，
 * 而那些寫法各有一個逃生口，讓測試在功能壞掉時照樣綠：
 *
 * - `css.replace(/@media \(max-width: 767.98px\)\s*\{[\s\S]*\}/, "")`
 *   是**貪婪**的：它從第一個手機 media 的左括號一路刪到全檔最後一個 `}`，
 *   於是第一個區塊之後的任何頂層規則都被一起吃掉，永遠驗不到。
 *
 * - `css.slice(css.indexOf("@media (max-width: 767.98px)"))`
 *   不是「那個 media 區塊」，而是「從第一個手機 media 到檔尾」——實測是
 *   styles.css 的 93%，等於斷言幾乎整個檔案，什麼都測不出來。
 *
 * - `slice(css.indexOf("..."))` 在找不到時 `indexOf` 回 -1，`slice(-1)` 回
 *   最後一個字元，長度 1 —— `expect(length).toBeGreaterThan(0)` 照樣通過。
 *
 * 這裡改成掃括號深度，把每個 at-rule 區塊的邊界真的找出來。
 */

/** 去掉 CSS 註解——註解裡的大括號與關鍵字會騙過所有掃描 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

export interface CssAtRuleBlock {
  /** at-rule 的前導，例如 `@media (max-width: 767.98px)` */
  prelude: string;
  /** 大括號內的內容（不含外層括號） */
  body: string;
}

/**
 * 取出所有頂層 at-rule 區塊（@media / @supports / @container…），
 * 以大括號深度配對，巢狀區塊留在 body 裡。
 */
export function atRuleBlocks(css: string): CssAtRuleBlock[] {
  const src = stripComments(css);
  const out: CssAtRuleBlock[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "@") continue;
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    // 非區塊型 at-rule（@import/@charset 等）沒有大括號主體
    if (prelude.includes(";")) continue;
    let depth = 0;
    let end = -1;
    for (let j = open; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end < 0) break;
    out.push({ prelude, body: src.slice(open + 1, end) });
    i = end;
  }
  return out;
}

/** 只留 media 區塊，可選擇以前導字串過濾 */
export function mediaBlocks(css: string, contains?: string): CssAtRuleBlock[] {
  return atRuleBlocks(css)
    .filter((b) => b.prelude.startsWith("@media"))
    .filter((b) => (contains ? b.prelude.includes(contains) : true));
}

/**
 * 把所有 at-rule 區塊挖掉之後剩下的頂層 CSS。
 *
 * 「這個檔案不准影響桌機」的契約就是驗這個結果為空——而且是**逐一**挖掉每個
 * 區塊，不是一個貪婪 regex 從頭刪到尾。
 */
export function topLevelCss(css: string): string {
  const src = stripComments(css);
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "@") {
      const open = src.indexOf("{", i);
      const semi = src.indexOf(";", i);
      if (open < 0 || (semi >= 0 && semi < open)) {
        // @import 之類：整條跳過
        i = semi < 0 ? src.length : semi + 1;
        continue;
      }
      let depth = 0;
      let end = src.length;
      for (let j = open; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") {
          depth--;
          if (depth === 0) { end = j; break; }
        }
      }
      i = end + 1;
      continue;
    }
    out += src[i];
    i++;
  }
  return out.trim();
}

/**
 * 找出某個選擇器所屬的 media 前導；不在任何 media 內回 null。
 * 找不到該選擇器時丟例外——「找不到」必須是失敗，不能靜靜當成通過。
 */
export function mediaPreludeOf(css: string, selector: string): string | null {
  const src = stripComments(css);
  if (!src.includes(selector)) {
    throw new Error(`選擇器不存在於樣式表：${selector}`);
  }
  for (const block of atRuleBlocks(css)) {
    if (block.body.includes(selector)) return block.prelude;
  }
  return null;
}
