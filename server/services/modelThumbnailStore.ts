/**
 * 模型縮圖：讀 docs/model-audit/model-thumbnails.json（Fal metadata.thumbnail_url）。
 * 無檔／無對應時回 null，UI 用類別占位圖。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { endpointOf, getModel } from "../../shared/models";

type ThumbFile = {
  generatedAt?: string;
  byModelId?: Record<string, string>;
  byEndpoint?: Record<string, string>;
};

let cached: { at: number; data: ThumbFile | null } = { at: 0, data: null };
const TTL_MS = 60_000;

function load(): ThumbFile | null {
  const now = Date.now();
  if (cached.data && now - cached.at < TTL_MS) return cached.data;
  const path = join(process.cwd(), "docs/model-audit/model-thumbnails.json");
  if (!existsSync(path)) {
    cached = { at: now, data: null };
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as ThumbFile;
    cached = { at: now, data };
    return data;
  } catch {
    cached = { at: now, data: null };
    return null;
  }
}

/** 解析模型縮圖 URL（https only） */
export function getModelThumbnailUrl(modelId: string): string | null {
  const data = load();
  if (!data) return null;
  const fromId = data.byModelId?.[modelId];
  if (isHttps(fromId)) return fromId!;
  const m = getModel(modelId);
  const ep = m ? endpointOf(m) : modelId;
  const fromEp = data.byEndpoint?.[ep] ?? data.byEndpoint?.[modelId];
  if (isHttps(fromEp)) return fromEp!;
  // any-llm#variant → base
  if (modelId.includes("#")) {
    const base = modelId.split("#")[0]!;
    const u = data.byModelId?.[base] ?? data.byEndpoint?.[base];
    if (isHttps(u)) return u!;
  }
  return null;
}

function isHttps(u: string | undefined | null): boolean {
  return typeof u === "string" && u.startsWith("https://");
}

export function clearModelThumbnailCache(): void {
  cached = { at: 0, data: null };
}
