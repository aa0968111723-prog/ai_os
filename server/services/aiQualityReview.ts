import { aiQualityReviewSchema, type AiQualityReview } from "../../shared/aiTrace";

export type AiQualityReviewParseMode = "strict" | "repaired" | "text_fallback";

const clip = (value: unknown, max: number): string =>
  (typeof value === "string" ? value : String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Finds the first balanced JSON object without being confused by braces inside strings. */
export function extractBalancedJsonObject(raw: string): string | null {
  for (let start = raw.indexOf("{"); start >= 0; start = raw.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return raw.slice(start, index + 1);
      }
    }
  }
  return null;
}

function repairCommonJson(candidate: string): string {
  return candidate
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function normalizeWarning(value: unknown, index: number): AiQualityReview["warnings"][number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const detail = clip(row.detail ?? row.reason ?? row.message, 1_000);
  const title = clip(row.title ?? row.name, 160) || `檢查提醒 ${index + 1}`;
  if (!detail) return null;
  const severityText = clip(row.severity, 30).toLowerCase();
  const severity = /warn|error|high|medium|警告|錯誤|高|中/.test(severityText) ? "warning" as const : "info" as const;
  const rawCode = clip(row.code, 80).toUpperCase().replace(/[^A-Z0-9_-]+/g, "_");
  const suggestion = clip(row.suggestion ?? row.fix, 1_000);
  return {
    code: rawCode || `REVIEW_${index + 1}`,
    severity,
    title,
    detail,
    ...(suggestion ? { suggestion } : {}),
  };
}

function normalizeReviewObject(value: unknown): AiQualityReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const summary = clip(row.summary ?? row.conclusion ?? row.result, 1_000);
  if (!summary) return null;
  const warnings = Array.isArray(row.warnings)
    ? row.warnings.slice(0, 20).map(normalizeWarning).filter((warning): warning is NonNullable<typeof warning> => Boolean(warning))
    : [];
  const contextUsed = Array.isArray(row.contextUsed)
    ? row.contextUsed.map((item) => clip(item, 120)).filter(Boolean).slice(0, 30)
    : [];
  const suggestedPrompt = clip(row.suggestedPrompt, 20_000);
  const suggestedNegativePrompt = clip(row.suggestedNegativePrompt, 8_000);
  const parsed = aiQualityReviewSchema.safeParse({
    summary,
    warnings,
    contextUsed,
    ...(suggestedPrompt ? { suggestedPrompt } : {}),
    ...(suggestedNegativePrompt ? { suggestedNegativePrompt } : {}),
  });
  return parsed.success ? parsed.data : null;
}

export function parseAiQualityReview(raw: string): {
  review: AiQualityReview;
  parseMode: AiQualityReviewParseMode;
} {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = extractBalancedJsonObject(fenced ?? raw);
  if (candidate) {
    try {
      const value = JSON.parse(candidate);
      const strict = aiQualityReviewSchema.safeParse(value);
      if (strict.success) return { review: strict.data, parseMode: "strict" };
      const normalized = normalizeReviewObject(value);
      if (normalized) return { review: normalized, parseMode: "repaired" };
    } catch {
      try {
        const normalized = normalizeReviewObject(JSON.parse(repairCommonJson(candidate)));
        if (normalized) return { review: normalized, parseMode: "repaired" };
      } catch {
        // Continue to the text fallback below.
      }
    }
  }

  const excerpt = clip(raw.replace(/```(?:json)?|```/gi, ""), 700);
  return {
    parseMode: "text_fallback",
    review: {
      summary: excerpt || "模型沒有回傳可讀的品質檢查內容。",
      warnings: [{
        code: "REVIEW_TEXT_FALLBACK",
        severity: "warning",
        title: "模型未使用標準結構",
        detail: excerpt
          ? "系統已保留模型的文字結論，沒有再把整份檢查結果丟棄；細項仍建議人工確認。"
          : "模型回覆為空，無法進行可靠檢查。",
        suggestion: "可重新檢查；若持續發生，改用較高品質的檢查模型。",
      }],
      contextUsed: [],
    },
  };
}
