import type { DeterministicMediaMetadata } from "@shared/universalIntake";

function metadataFromElement(file: File): Promise<DeterministicMediaMetadata> {
  return new Promise((resolve) => {
    const isVideo = file.type.startsWith("video/");
    const element = document.createElement(isVideo ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const finish = (metadata: DeterministicMediaMetadata) => {
      URL.revokeObjectURL(url);
      element.removeAttribute("src");
      resolve(metadata);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      const video = element as HTMLVideoElement;
      finish({
        duration: Number.isFinite(element.duration) ? element.duration : undefined,
        ...(isVideo ? {
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        hasAudio: video.mozHasAudio
          ?? (video.webkitAudioDecodedByteCount != null
            ? video.webkitAudioDecodedByteCount > 0
            : undefined),
        } : { hasAudio: true }),
        createdAt: file.lastModified ? new Date(file.lastModified).toISOString() : undefined,
      });
    };
    element.onerror = () => finish({ createdAt: file.lastModified ? new Date(file.lastModified).toISOString() : undefined });
    element.src = url;
  });
}

export async function readLocalMediaMetadata(file: File): Promise<DeterministicMediaMetadata> {
  const createdAt = file.lastModified ? new Date(file.lastModified).toISOString() : undefined;
  if (file.type.startsWith("image/")) {
    try {
      const bitmap = await createImageBitmap(file);
      const result = { width: bitmap.width, height: bitmap.height, createdAt };
      bitmap.close();
      return result;
    } catch {
      return { createdAt };
    }
  }
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) return metadataFromElement(file);
  return { createdAt };
}

declare global {
  interface HTMLVideoElement {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
  }
}
