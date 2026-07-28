/**
 * Fal Platform APIs：模型發現 + 即時定價
 * GET https://api.fal.ai/v1/models
 * GET https://api.fal.ai/v1/models/pricing?endpoint_id=
 */
import { proxyFetch } from "./http";

const PLATFORM = "https://api.fal.ai/v1";

function authHeaders(): HeadersInit {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY 未設定：無法向 Fal Platform 拉模型／價格");
  return { Authorization: `Key ${key}`, Accept: "application/json" };
}

export type FalPricingUnit = { price: number; unit: string; note?: string };
export type FalModelSummary = {
  endpointId: string;
  title: string;
  category: string | null;
  description: string | null;
  tags: string[];
};

export function normalizePriceUnit(raw: string): string {
  const u = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (u.includes("megapixel") || u === "mp") return "megapixel";
  if (u.includes("second") || u === "sec" || u === "s") return "second";
  if (u.includes("minute") || u === "min") return "minute";
  if (u.includes("image") || u.includes("img")) return "image";
  if (u.includes("video") && !u.includes("second")) return "video";
  if (u.includes("token")) return "token";
  return u || "unit";
}

export function parsePricingPayload(endpointId: string, data: unknown): FalPricingUnit | null {
  if (data == null) return null;
  const tryUnit = (price: unknown, unit: unknown, note?: string): FalPricingUnit | null => {
    const p = typeof price === "number" ? price : Number(price);
    if (!Number.isFinite(p) || p < 0) return null;
    const u = typeof unit === "string" && unit.trim() ? unit : "unit";
    return { price: p, unit: normalizePriceUnit(u), note };
  };
  if (Array.isArray(data)) {
    for (const item of data) {
      const hit = parsePricingPayload(endpointId, item);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (obj[endpointId]) return parsePricingPayload(endpointId, obj[endpointId]);
  if (obj.models) return parsePricingPayload(endpointId, obj.models);
  if (obj.pricing) return parsePricingPayload(endpointId, obj.pricing);
  if (obj.prices) return parsePricingPayload(endpointId, obj.prices);
  if (obj.items) return parsePricingPayload(endpointId, obj.items);
  if ("unit_price" in obj || "unitPrice" in obj || "price" in obj) {
    return tryUnit(
      obj.unit_price ?? obj.unitPrice ?? obj.price,
      obj.unit ?? obj.billing_unit ?? obj.billingUnit ?? "unit",
      typeof obj.note === "string" ? obj.note : undefined,
    );
  }
  if ("price_per_unit" in obj) return tryUnit(obj.price_per_unit, obj.unit ?? "unit");
  return null;
}

export async function fetchFalPricing(endpointIds: string[]): Promise<Map<string, FalPricingUnit>> {
  const out = new Map<string, FalPricingUnit>();
  if (process.env.E2E_MOCK === "1" || !process.env.FAL_KEY) return out;
  const unique = [...new Set(endpointIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 40) {
    const batch = unique.slice(i, i + 40);
    const qs = batch.map((id) => `endpoint_id=${encodeURIComponent(id)}`).join("&");
    try {
      const res = await proxyFetch(`${PLATFORM}/models/pricing?${qs}`, {
        headers: authHeaders(),
        timeoutMs: 45_000,
      });
      if (!res.ok) {
        console.warn(`[falPlatform] pricing ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const root = data as Record<string, unknown>;
        const bag =
          root.models && typeof root.models === "object"
            ? (root.models as Record<string, unknown>)
            : root;
        for (const id of batch) {
          const parsed = parsePricingPayload(id, bag[id] ?? data);
          if (parsed) out.set(id, parsed);
        }
      }
    } catch (err) {
      console.warn("[falPlatform] pricing 失敗：", err instanceof Error ? err.message : err);
    }
  }
  return out;
}

function pickStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export async function fetchFalModels(opts: {
  limit?: number;
  cursor?: string | null;
  q?: string;
} = {}): Promise<{ models: FalModelSummary[]; nextCursor: string | null }> {
  if (process.env.E2E_MOCK === "1" || !process.env.FAL_KEY) return { models: [], nextCursor: null };
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(opts.limit ?? 50, 100)));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.q) params.set("q", opts.q);
  try {
    const res = await proxyFetch(`${PLATFORM}/models?${params}`, { headers: authHeaders(), timeoutMs: 60_000 });
    if (!res.ok) {
      console.warn(`[falPlatform] models ${res.status}`);
      return { models: [], nextCursor: null };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const list = (Array.isArray(data.models)
      ? data.models
      : Array.isArray(data.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : []) as unknown[];
    const models: FalModelSummary[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const m = raw as Record<string, unknown>;
      const endpointId = pickStr(m.endpoint_id, m.endpointId, m.id, m.model_id);
      if (!endpointId) continue;
      const tags = Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === "string") : [];
      models.push({
        endpointId,
        title: pickStr(m.title, m.name, m.label) ?? endpointId,
        category: pickStr(m.category, m.group, m.kind),
        description: pickStr(m.description, m.blurb, m.summary),
        tags,
      });
    }
    const nextCursor = pickStr(data.next_cursor, data.nextCursor) ?? null;
    return { models, nextCursor };
  } catch (err) {
    console.warn("[falPlatform] models 失敗：", err instanceof Error ? err.message : err);
    return { models: [], nextCursor: null };
  }
}
