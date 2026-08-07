/**
 * Story Workspace 的純規則（可測；不含 React）：
 * autosave 的「該不該收養遠端內容」與存檔狀態機，抽出來讓協作覆蓋行為測得到——
 * 這條規則錯了會默默蓋掉夥伴剛打的字（比 UI 壞掉更難發現）。
 */

export type StorySaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** autosave 去抖延遲（毫秒）：邊打字邊存但不轟炸伺服器 */
export const STORY_AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * 遠端內容變了，本地要不要跟？
 * 只有「本地沒有未存修改」（idle/saved）時才收養遠端——正在打字（dirty/saving/error）時
 * 收養等於把使用者手上的字直接換掉。錯誤態也不收養：使用者要先看得到自己沒存成功的內容。
 */
export function shouldAdoptRemote(state: StorySaveState, local: string | null, remote: string): boolean {
  if (local === null) return true; // 尚未種初值：一律採用伺服器內容
  if (local === remote) return false;
  return state === "idle" || state === "saved";
}

/** 解析摘要 chips 的顯示順序與文案（單一真相：StoryStage 與測試共用） */
export function summaryChips(summary: {
  characters: number;
  locations: number;
  props: number;
  looks: number;
  storyScenes: number;
  shots: number;
}): Array<{ key: string; label: string }> {
  return [
    { key: "characters", label: `角色 ${summary.characters}` },
    { key: "locations", label: `場景 ${summary.locations}` },
    { key: "props", label: `道具 ${summary.props}` },
    ...(summary.looks > 0 ? [{ key: "looks", label: `造型 ${summary.looks}` }] : []),
    { key: "shots", label: `分鏡 ${summary.storyScenes} 場 ${summary.shots} 鏡` },
  ];
}
