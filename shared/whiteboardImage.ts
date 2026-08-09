export const WHITEBOARD_IMAGE_MODES = [
  {
    id: "fast",
    label: "快速",
    description: "快速確認方向，適合反覆試構圖。",
    preference: "speed",
  },
  {
    id: "quality",
    label: "高品質",
    description: "正式分鏡的品質與成本平衡。",
    preference: "quality",
  },
  {
    id: "ultra",
    label: "最精緻",
    description: "只使用健康的旗艦級模型，成本較高時會明確顯示。",
    preference: "quality",
  },
] as const;

export type WhiteboardImageMode = (typeof WHITEBOARD_IMAGE_MODES)[number]["id"];

export function whiteboardImageModeLabel(mode: WhiteboardImageMode): string {
  return WHITEBOARD_IMAGE_MODES.find((item) => item.id === mode)?.label ?? mode;
}
