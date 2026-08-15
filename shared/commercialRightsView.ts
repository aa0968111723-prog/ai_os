/**
 * Presentation helpers for commercial-rights status — the half the browser needs.
 *
 * `shared/commercialRights.ts` is the domain module: it evaluates evidence, parses
 * licence text and fingerprints decisions, which means it imports `node:crypto`
 * and the full zod schema set. Pulling `rightsChip()` out of there dragged both
 * into the client graph and broke `vite build` outright ("createHash is not
 * exported by __vite-browser-external").
 *
 * These functions are pure label mapping with no dependency on either. The types
 * still come from the domain module via `import type`, which is erased at build
 * time — so this file stays a leaf in the browser's module graph.
 * The domain module re-exports everything here, so server callers are unaffected.
 */
import type { RightsProfile, RightsSourceType, RightsStatus, TriState } from "./commercialRights";

export function rightsChip(status: RightsStatus): { symbol: "ok" | "warn" | "no" | "unknown"; label: string } {
  if (status === "CLEAR") return { symbol: "ok", label: "可商用" };
  if (status === "CONDITIONAL") return { symbol: "ok", label: "可商用（有條件）" };
  if (status === "REVIEW_REQUIRED") return { symbol: "warn", label: "需要確認" };
  if (status === "BLOCKED") return { symbol: "no", label: "不建議商用" };
  return { symbol: "unknown", label: "資訊不足" };
}

export function sourceTypeLabel(type: RightsSourceType): string {
  const labels: Record<RightsSourceType, string> = {
    USER_OWNED: "自己上傳",
    TEAM_OWNED: "團隊素材",
    CLIENT_PROVIDED: "客戶提供",
    STOCK_MEDIA: "素材庫／Stock",
    CREATIVE_COMMONS: "創用 CC",
    PUBLIC_DOMAIN: "公眾領域",
    WEB_UNKNOWN: "網路圖片（來源不明）",
    AI_GENERATED: "AI 生成",
    GENERATED_BY_AIOS: "Aios 生成",
    THIRD_PARTY_AI: "外部 AI 產出",
    LICENSED_BRAND_ASSET: "已授權品牌素材",
    UNKNOWN: "還不知道",
  };
  return labels[type];
}

export function rightsDetailRows(profile: RightsProfile): Array<{ label: string; value: string }> {
  const yn = (v: TriState, yes = "可以", no = "不可以") => (v === true ? yes : v === false ? no : "還不知道");
  return [
    { label: "商用使用", value: yn(profile.grants.commercialUseAllowed) },
    { label: "修改", value: yn(profile.grants.modificationAllowed) },
    { label: "署名", value: profile.grants.attributionRequired ? (profile.grants.attributionText ?? "需要") : profile.grants.attributionRequired === false ? "不需要" : "還不知道" },
    { label: "AI 訓練", value: yn(profile.grants.trainingAllowed, "可以", "不可以") },
    { label: "來源", value: sourceTypeLabel(profile.sourceType) },
  ];
}

export const emptyStatusCounts = (): Record<RightsStatus, number> => ({
  CLEAR: 0,
  CONDITIONAL: 0,
  REVIEW_REQUIRED: 0,
  BLOCKED: 0,
  UNKNOWN: 0,
});

export function summarizeProjectRights(profiles: Array<Pick<RightsProfile, "rightsStatus">>): {
  total: number;
  counts: Record<RightsStatus, number>;
  usable: number;
  needsAttention: number;
} {
  const counts = emptyStatusCounts();
  for (const row of profiles) counts[row.rightsStatus] += 1;
  return {
    total: profiles.length,
    counts,
    usable: counts.CLEAR + counts.CONDITIONAL,
    needsAttention: counts.REVIEW_REQUIRED + counts.BLOCKED + counts.UNKNOWN,
  };
}
