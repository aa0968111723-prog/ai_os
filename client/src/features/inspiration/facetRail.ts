/**
 * 細化分類篩選列的資料整形（純函式，跟 React 無關 → 可以直接測）。
 *
 * 伺服器回的是扁平的 `{ tag, count }`；畫面要的是「依 facet 分組、每組內依數量排序、
 * 已選中的一定看得到」。這段邏輯放元件裡會被 render 分支淹沒，抽出來才守得住。
 */
import { INSPIRATION_FACETS, describeInspirationTag } from "@shared/inspirationTaxonomy";
import type { FacetId } from "@shared/inspirationTaxonomy";

export type FacetCount = { tag: string; count: number };

export type FacetRailOption = {
  tag: string;
  label: string;
  count: number;
  selected: boolean;
};

export type FacetRailGroup = {
  id: FacetId;
  label: string;
  options: FacetRailOption[];
};

/**
 * 組出篩選列。
 *
 * - 只顯示「這批貼文真的有」的分類：字典有 60 個標籤，全列出來等於沒有篩選。
 * - 已選中的標籤即使數量掉到 0 也保留，否則使用者一選就看不到自己選了什麼、無法取消。
 * - 每個 facet 最多 `maxPerFacet` 個，其餘收在「更多」（由呼叫端決定要不要展開）。
 */
export function buildFacetRail(
  counts: readonly FacetCount[],
  selected: readonly string[],
  options?: { maxPerFacet?: number; expanded?: readonly FacetId[] },
): FacetRailGroup[] {
  const maxPerFacet = options?.maxPerFacet ?? 6;
  const expanded = new Set(options?.expanded ?? []);
  const selectedSet = new Set(selected);
  const countByTag = new Map(counts.map((c) => [c.tag, c.count]));

  // 已選但這批沒有的標籤（例如翻頁後數量歸零）：補一個 0 進來，chip 才不會消失
  for (const tag of selectedSet) {
    if (!countByTag.has(tag)) countByTag.set(tag, 0);
  }

  const groups: FacetRailGroup[] = [];
  for (const facet of INSPIRATION_FACETS) {
    const rows: FacetRailOption[] = [];
    for (const [tag, count] of countByTag) {
      const described = describeInspirationTag(tag);
      if (!described || described.facet !== facet.id) continue;
      rows.push({ tag, label: described.label, count, selected: selectedSet.has(tag) });
    }
    if (rows.length === 0) continue;

    rows.sort((a, b) => {
      // 選中的永遠排在最前面：使用者要能一眼找到「取消」的地方
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, "zh-Hant");
    });

    groups.push({
      id: facet.id,
      label: facet.label,
      options: expanded.has(facet.id) ? rows : rows.slice(0, maxPerFacet),
    });
  }
  return groups;
}

/** 某個 facet 是否還有沒顯示出來的選項（決定要不要出「更多」鈕） */
export function facetHasMore(
  counts: readonly FacetCount[],
  selected: readonly string[],
  facetId: FacetId,
  maxPerFacet = 6,
): boolean {
  const full = buildFacetRail(counts, selected, { maxPerFacet: Number.MAX_SAFE_INTEGER });
  const group = full.find((g) => g.id === facetId);
  return (group?.options.length ?? 0) > maxPerFacet;
}

/** 點一下標籤：已選就取消、沒選就加入（順序穩定，避免 query key 抖動） */
export function toggleFacet(selected: readonly string[], tag: string): string[] {
  return selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag];
}
