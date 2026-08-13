/**
 * 模型契約／健康狀態（變動對應的單一機器可讀真相）。
 *
 * 用途：
 * - scripts/sync-model-contracts.ts 產出 docs/model-audit/contracts/*
 * - MCP find_model / get_model_contract
 * - generationCore 送出前軟警告（broken / openapi404）
 * - 模型指南 gen-model-docs 摘要欄
 *
 * 原則：
 * - 指紋只含「契約面」欄位（id/endpoint/points/needs/verified/category…），不含成品 URL
 * - 不自動 verified:true；live 狀態只反映審計／歷史結果
 * - 零成本預設（OpenAPI／指紋 diff）；live 需另跑 verify-models --yes
 */
import {
  MODELS,
  endpointOf,
  supportsNegativePrompt,
  supportsSeed,
  injectsWorldview,
  supportsCardAnchors,
  type ModelEntry,
  type ModelCategory,
  type SourceKind,
  type OutputKind,
  type ModelTier,
} from "./models";
import { textEncoderProfileFor, type TextEncoderProfile } from "./textEncoders";

/** 契約健康（給生成／MCP 決策） */
export type ModelHealthStatus =
  | "live_ok"
  | "live_timeout"
  | "live_fail"
  | "openapi_404"
  | "needs_source"
  | "nim_no_key"
  | "gemini_no_key"
  | "never_probed"
  | "unknown";

export interface ModelContractCapabilities {
  injectsWorldview: boolean;
  supportsCardAnchors: boolean;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  /** 文字塔 profile key */
  textEncoderKey: string;
  textEncoderLabel: string;
  /** 公開窗口 token；未公開則 null */
  textEncoderLimit: number | null;
  tokenizer: TextEncoderProfile["tokenizer"];
  /** 站內是否能量測 token（clip-bpe / t5） */
  tokenMeasurable: boolean;
}

/** 單一模型契約列（指南／MCP／生成共用） */
export interface ModelContractRow {
  id: string;
  endpoint: string;
  label: string;
  category: ModelCategory;
  tier: ModelTier;
  kind: OutputKind;
  needs: SourceKind | null;
  secondaryNeeds: SourceKind | null;
  points: number;
  verified: boolean;
  recommended: boolean;
  cost: string;
  strengths: string;
  bestFor: string;
  capabilities: ModelContractCapabilities;
  /** 契約指紋（變了＝站內契約有動） */
  fingerprint: string;
  health: ModelHealthStatus;
  healthNote: string;
  /** 最近 live 狀態字串（來自 budget entries，可空） */
  lastLiveStatus: string | null;
  openapiStatus: "ok" | "http_404" | "error" | "unchecked" | null;
  openapiRequired: string[] | null;
}

export interface ModelContractSnapshot {
  version: 1;
  generatedAt: string;
  modelCount: number;
  softStopNote: string;
  counts: Record<string, number>;
  models: ModelContractRow[];
}

export interface ModelContractChange {
  id: string;
  kind: "added" | "removed" | "fingerprint" | "health" | "points" | "endpoint" | "needs" | "verified";
  before?: string | number | boolean | null;
  after?: string | number | boolean | null;
}

export interface ModelContractDiff {
  generatedAt: string;
  previousGeneratedAt: string | null;
  changes: ModelContractChange[];
  summary: string;
}

/** 契約指紋：只含會影響生成／選型的欄位 */
export function modelContractFingerprint(m: ModelEntry): string {
  const payload = {
    id: m.id,
    endpoint: endpointOf(m),
    category: m.category,
    tier: m.tier,
    kind: m.kind,
    needs: m.needs ?? null,
    secondaryNeeds: m.secondaryNeeds ?? null,
    points: m.points,
    verified: m.verified,
    recommended: !!m.recommended,
    cost: m.cost,
    // input 源碼形狀無法穩定序列化；用 needs+category+kind 近似契約面
  };
  return simpleHash(JSON.stringify(payload));
}

export function modelCapabilities(m: ModelEntry): ModelContractCapabilities {
  const enc = textEncoderProfileFor(m.id);
  return {
    injectsWorldview: injectsWorldview(m.category),
    supportsCardAnchors: supportsCardAnchors(m.category),
    supportsNegativePrompt: supportsNegativePrompt(m),
    supportsSeed: supportsSeed(m),
    textEncoderKey: enc.key,
    textEncoderLabel: enc.label,
    textEncoderLimit: enc.limitTokens ?? null,
    tokenizer: enc.tokenizer,
    tokenMeasurable: enc.tokenizer === "clip-bpe" || enc.tokenizer === "t5",
  };
}

export type LiveHint = {
  status: string;
  note?: string;
};

export type OpenApiHint = {
  status: "ok" | "http_404" | "error" | "unchecked";
  required?: string[];
};

/**
 * 由靜態目錄 + 可選 live/openapi 提示組一列契約。
 * liveHints / openapiHints 以 model id 或 endpoint 為鍵。
 */
export function buildModelContractRow(
  m: ModelEntry,
  live?: LiveHint | null,
  openapi?: OpenApiHint | null,
): ModelContractRow {
  const ep = endpointOf(m);
  let health: ModelHealthStatus = "never_probed";
  let healthNote = "尚未 live 探測";

  if (m.id.startsWith("nvidia-nim") || ep === "nvidia-nim") {
    health = "nim_no_key";
    healthNote = "NVIDIA NIM：無 KEY 時本站不 live；生成走 nim 分流";
  } else if (m.id.startsWith("google/gemini") || ep === "google/gemini") {
    health = "gemini_no_key";
    healthNote = "Google Gemini 原生：金鑰只讀 GEMINI_API_KEY；不走 fal 佇列";
  } else if (m.needs) {
    // needs 優先於歷史 live_fail（空 live 本來就不該做）
    health = "needs_source";
    healthNote = `需要來源素材 needs=${m.needs}${m.secondaryNeeds ? `+${m.secondaryNeeds}` : ""}；禁止空 live`;
  }

  if (openapi?.status === "http_404" && health !== "nim_no_key" && health !== "gemini_no_key") {
    health = "openapi_404";
    healthNote = "OpenAPI queue 404：端點可能下架或 slug 錯誤";
  }

  // live 結果只覆蓋「可空探測」路徑；needs / openapi_404 / nim 不被舊 fail 蓋掉
  const locked = health === "needs_source" || health === "openapi_404" || health === "nim_no_key" || health === "gemini_no_key";

  if (live?.status && !locked) {
    const st = live.status;
    if (st === "success") {
      health = "live_ok";
      healthNote = live.note || "live 探測成功（取回成品）";
    } else if (st.includes("timeout")) {
      health = "live_timeout";
      healthNote = live.note || "live 已送出但輪詢逾時（可能已計點，勿重跑）";
    } else if (st.startsWith("fail") || st.includes("404") || st.includes("422") || st.startsWith("exit_")) {
      health = "live_fail";
      healthNote = live.note || `live 失敗：${st}`;
    } else if (st === "aborted_softstop") {
      health = "never_probed";
      healthNote = "因 softStop 中止，未完成 live";
    }
  } else if (live?.status && health === "needs_source" && live.status !== "success") {
    healthNote += `（歷史 empty live：${live.status}）`;
  }

  if (health === "never_probed" && !m.needs && !m.id.startsWith("nvidia-nim") && !m.id.startsWith("google/gemini") && openapi?.status === "ok") {
    healthNote = "OpenAPI 可連；尚未合法生成 live（pts 或 softStop 限制）";
  }

  return {
    id: m.id,
    endpoint: ep,
    label: m.label,
    category: m.category,
    tier: m.tier,
    kind: m.kind,
    needs: m.needs ?? null,
    secondaryNeeds: m.secondaryNeeds ?? null,
    points: m.points,
    verified: m.verified,
    recommended: !!m.recommended,
    cost: m.cost,
    strengths: m.strengths,
    bestFor: m.bestFor,
    capabilities: modelCapabilities(m),
    fingerprint: modelContractFingerprint(m),
    health,
    healthNote,
    lastLiveStatus: live?.status ?? null,
    openapiStatus: openapi?.status ?? null,
    openapiRequired: openapi?.required ?? null,
  };
}

/** 從完整 MODELS 建快照（純函式；I/O 在腳本層） */
export function buildModelContractSnapshot(
  liveById: Record<string, LiveHint> = {},
  openapiByEndpoint: Record<string, OpenApiHint> = {},
  opts?: { generatedAt?: string; softStopNote?: string },
): ModelContractSnapshot {
  const models = MODELS.map((m) => {
    const ep = endpointOf(m);
    const live = liveById[m.id] ?? liveById[ep] ?? null;
    const openapi = openapiByEndpoint[ep] ?? openapiByEndpoint[m.id] ?? null;
    return buildModelContractRow(m, live, openapi);
  });
  const counts: Record<string, number> = {};
  for (const row of models) {
    counts[row.health] = (counts[row.health] ?? 0) + 1;
  }
  return {
    version: 1,
    generatedAt: opts?.generatedAt ?? new Date().toISOString(),
    modelCount: models.length,
    softStopNote: opts?.softStopNote ?? "live 另受 budget softStop 約束；本契約預設零成本更新",
    counts,
    models,
  };
}

export function diffModelContractSnapshots(
  prev: ModelContractSnapshot | null,
  next: ModelContractSnapshot,
): ModelContractDiff {
  const changes: ModelContractChange[] = [];
  if (!prev) {
    return {
      generatedAt: next.generatedAt,
      previousGeneratedAt: null,
      changes: [{ id: "*", kind: "added", after: next.modelCount }],
      summary: `初版快照 ${next.modelCount} 模型`,
    };
  }
  const prevMap = new Map(prev.models.map((m) => [m.id, m]));
  const nextMap = new Map(next.models.map((m) => [m.id, m]));
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) changes.push({ id, kind: "removed", before: id });
  }
  for (const [id, n] of nextMap) {
    const p = prevMap.get(id);
    if (!p) {
      changes.push({ id, kind: "added", after: id });
      continue;
    }
    if (p.fingerprint !== n.fingerprint) {
      changes.push({ id, kind: "fingerprint", before: p.fingerprint, after: n.fingerprint });
    }
    if (p.health !== n.health) {
      changes.push({ id, kind: "health", before: p.health, after: n.health });
    }
    if (p.points !== n.points) {
      changes.push({ id, kind: "points", before: p.points, after: n.points });
    }
    if (p.endpoint !== n.endpoint) {
      changes.push({ id, kind: "endpoint", before: p.endpoint, after: n.endpoint });
    }
    if (p.needs !== n.needs) {
      changes.push({ id, kind: "needs", before: p.needs, after: n.needs });
    }
    if (p.verified !== n.verified) {
      changes.push({ id, kind: "verified", before: p.verified, after: n.verified });
    }
  }
  const byKind: Record<string, number> = {};
  for (const c of changes) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  const summary =
    changes.length === 0
      ? "無契約變動"
      : Object.entries(byKind)
          .map(([k, v]) => `${k}×${v}`)
          .join("、");
  return {
    generatedAt: next.generatedAt,
    previousGeneratedAt: prev.generatedAt,
    changes,
    summary,
  };
}

/** 查單列（執行期用，需已載入 snapshot.models） */
export function findContractRow(
  snapshot: ModelContractSnapshot | null | undefined,
  modelId: string,
): ModelContractRow | null {
  if (!snapshot) return null;
  return snapshot.models.find((m) => m.id === modelId || m.endpoint === modelId) ?? null;
}

/** 生成前是否應阻擋（硬）——目前只擋 openapi 404 可選；預設軟警告 */
export function contractHardBlock(row: ModelContractRow | null): string | null {
  if (!row) return null;
  if (row.health === "openapi_404") {
    return `模型端點 OpenAPI 404（${row.endpoint}）：${row.healthNote}`;
  }
  return null;
}

export function contractSoftWarning(row: ModelContractRow | null): string | null {
  if (!row) return null;
  if (row.health === "live_fail") return `此模型最近 live 失敗：${row.healthNote}`;
  if (row.health === "live_timeout") return `此模型最近 live 逾時：${row.healthNote}`;
  if (row.health === "openapi_404") return row.healthNote;
  return null;
}

function simpleHash(s: string): string {
  // FNV-1a 32-bit → hex（穩定、無 crypto 相依，適合指紋）
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
