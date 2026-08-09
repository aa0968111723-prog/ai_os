export const EXTERNAL_TOOL_CAPABILITIES = ["image", "video", "audio", "music", "text"] as const;
export type ExternalToolCapability = (typeof EXTERNAL_TOOL_CAPABILITIES)[number];

export interface ExternalToolDirectoryItem {
  key: string;
  name: string;
  url: string;
  capabilities: ExternalToolCapability[];
  instructions: string;
  builtIn: boolean;
  favorite: boolean;
}

export const BUILT_IN_EXTERNAL_TOOLS: readonly ExternalToolDirectoryItem[] = [
  { key: "flow", name: "Flow", url: "https://labs.google/fx/tools/flow", capabilities: ["video"], instructions: "適合使用 Veo 製作影片。", builtIn: true, favorite: true },
  { key: "runway", name: "Runway", url: "https://app.runwayml.com", capabilities: ["video", "image"], instructions: "影片生成與影像處理。", builtIn: true, favorite: true },
  { key: "kling", name: "Kling", url: "https://klingai.com", capabilities: ["video", "image"], instructions: "影片與圖片生成。", builtIn: true, favorite: true },
  { key: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com", capabilities: ["image", "text"], instructions: "圖片與文字創作。", builtIn: true, favorite: false },
  { key: "gemini", name: "Gemini", url: "https://gemini.google.com", capabilities: ["image", "video", "text"], instructions: "圖片、影片與文字創作。", builtIn: true, favorite: false },
  { key: "midjourney", name: "Midjourney", url: "https://www.midjourney.com", capabilities: ["image"], instructions: "圖片生成。", builtIn: true, favorite: false },
  { key: "elevenlabs", name: "ElevenLabs", url: "https://elevenlabs.io/app", capabilities: ["audio"], instructions: "語音與聲音生成。", builtIn: true, favorite: false },
  { key: "suno", name: "Suno", url: "https://suno.com/create", capabilities: ["music", "audio"], instructions: "音樂生成。", builtIn: true, favorite: false },
  { key: "comfyui", name: "ComfyUI", url: "http://127.0.0.1:8188", capabilities: ["image", "video"], instructions: "自架工作流；網址可在「我的 AI 工具」新增成自己的站點。", builtIn: true, favorite: false },
] as const;

export function externalToolForTarget(targetType: string, capabilities: readonly ExternalToolCapability[]): boolean {
  if (targetType === "music") return capabilities.includes("music") || capabilities.includes("audio");
  if (targetType === "audio") return capabilities.includes("audio");
  if (targetType === "image") return capabilities.includes("image");
  if (targetType === "video") return capabilities.includes("video");
  return true;
}
