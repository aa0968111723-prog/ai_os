export const DATABASE_DETAIL_TAB_IDS = ["rows", "files", "connect"] as const;
export type DatabaseDetailTab = (typeof DATABASE_DETAIL_TAB_IDS)[number];

/** WAI-ARIA tabs keyboard order：左右方向鍵循環，Home/End 跳到首尾。 */
export function databaseDetailTabForKey(
  current: DatabaseDetailTab,
  key: string,
): DatabaseDetailTab | null {
  const index = DATABASE_DETAIL_TAB_IDS.indexOf(current);
  if (key === "Home") return DATABASE_DETAIL_TAB_IDS[0];
  if (key === "End") return DATABASE_DETAIL_TAB_IDS[DATABASE_DETAIL_TAB_IDS.length - 1];
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const delta = key === "ArrowRight" ? 1 : -1;
  return DATABASE_DETAIL_TAB_IDS[
    (index + delta + DATABASE_DETAIL_TAB_IDS.length) % DATABASE_DETAIL_TAB_IDS.length
  ];
}
