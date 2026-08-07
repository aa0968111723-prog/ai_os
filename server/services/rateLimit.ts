/**
 * PostgreSQL-backed rate limiting.
 *
 * Security invariants:
 * - Raw subjects (email, IP, user id) never leave this process.
 * - Production keys are HMAC-SHA-256(scope + subject) with RATE_LIMIT_SECRET.
 * - Every read/decide/write cycle is serialized across replicas with a
 *   transaction-scoped PostgreSQL advisory lock, then persisted by UPSERT.
 * - Database/configuration failure throws and therefore fails closed. There is
 *   deliberately no process-memory fallback.
 */
import { createHash, createHmac } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";

const KEY_VERSION = "v1";
const MIN_PRODUCTION_SECRET_LENGTH = 32;
const MAX_BUCKET_HITS = 1_000;
export const RATE_LIMIT_MAX_WINDOW_MS = 24 * 60 * 60_000;
// 清理門檻必須長於允許的最長視窗／封鎖，否則低流量長視窗桶會被提前刪除而繞限。
export const RATE_LIMIT_STALE_BUCKET_MS = 25 * 60 * 60_000;
const PRUNE_BATCH = 64;

export const RATE_LIMIT_POLICIES = {
  authEmail: { limit: 5, windowMs: 15 * 60_000 },
  authIp: { limit: 30, windowMs: 15 * 60_000 },
  mcpFailures: { limit: 10, windowMs: 60_000, blockMs: 5 * 60_000 },
  projectAssistant: { limit: 6, windowMs: 60_000 },
  teamAssistant: { limit: 6, windowMs: 60_000 },
  /** 全站助手問答：與組助手同價（6/分/人）。自成一桶——它與 teamAssistant 是不同入口，
   *  共用桶會讓一邊把另一邊餓死（同 groupCampaignPlan 不與 agentPlan 共桶的理由）。 */
  globalAssistant: { limit: 6, windowMs: 60_000 },
  agentPlan: { limit: 4, windowMs: 60_000 },
  /**
   * 組代理調度計畫的規劃：自成一桶，不與 agentPlan 共用。
   *
   * 共用的話兩種動作會互相餓死——組代理連續派幾件工（每件都走 planAgentCore）就會把桶用完，
   * 接著使用者想排一份調度計畫會拿到「規劃太頻繁」，而他自己根本沒排過任何計畫；
   * 反過來也一樣。兩者都是昂貴的 LLM 規劃，各自限流才擋得住濫用又不會互相誤傷。
   */
  groupCampaignPlan: { limit: 4, windowMs: 60_000 },
  messageAssistant: { limit: 6, windowMs: 60_000 },
  dmAssistant: { limit: 6, windowMs: 60_000 },
  director: { limit: 6, windowMs: 60_000 },
  /** 故事自動解析：與拆分鏡同級距的 LLM 呼叫，自成一桶（不與 director 互相餓死） */
  storyParse: { limit: 6, windowMs: 60_000 },
  imageDescription: { limit: 6, windowMs: 60_000 },
  apiFetch: { limit: 20, windowMs: 60_000 },
  driveList: { limit: 30, windowMs: 60_000 },
  notionList: { limit: 30, windowMs: 60_000 },
  adobeJob: { limit: 12, windowMs: 60_000 },
  /** 陌生裝置驗證碼提交：碼是 6 位數，靠「10 分嘗試上限 5 次」＋本限流把線上猜中壓到可忽略 */
  deviceVerify: { limit: 10, windowMs: 15 * 60_000 },
  /**
   * 觸發陌生裝置挑戰的次數上限。防「攻擊者已握有正確密碼，狂送登入把受害者信箱灌爆」
   * ——郵件轟炸本身就是攻擊，而且會讓受害者對驗證信麻痺。
   */
  deviceChallenge: { limit: 5, windowMs: 60 * 60_000 },
  /**
   * 專案分享連結的公開檢視：全庫唯一免登入就讀得到專案內容的入口，限流是它唯一的節流閥。
   * 額度給得比登入寬（一份連結會被同一批人反覆開、頁面本身也會定期重抓換簽名網址），
   * 但足以讓「拿 64 字 hex 猜 token」在實務上毫無意義。
   */
  shareView: { limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy | FailureRateLimitPolicy>;

export const RATE_LIMIT_SCOPES = {
  authEmail: "auth:email",
  authIp: "auth:ip",
  mcpIp: "mcp:ip",
  projectAssistant: "assistant:project",
  teamAssistant: "assistant:team",
  globalAssistant: "assistant:global",
  agentPlan: "assistant:agent-plan",
  groupCampaignPlan: "assistant:group-campaign-plan",
  messageAssistant: "assistant:message",
  dmAssistant: "assistant:dm",
  director: "assistant:director",
  storyParse: "story:parse",
  imageDescription: "knowledge:image-description",
  apiFetch: "integrations:api-fetch",
  driveList: "integrations:drive-list",
  notionList: "integrations:notion-list",
  adobeJob: "integrations:adobe-job",
  deviceVerify: "auth:device-verify",
  deviceChallenge: "auth:device-challenge",
  shareViewIp: "share:view-ip",
} as const;

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface FailureRateLimitPolicy extends RateLimitPolicy {
  blockMs: number;
}

export interface RateLimitState extends Record<string, unknown> {
  hits: number[];
  blockedUntil?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  hitCount: number;
  retryAfterMs: number;
}

export interface FailureRateLimitDecision {
  blocked: boolean;
  hitCount: number;
  retryAfterMs: number;
}

export interface RateLimitIdentity {
  keyHash: string;
  scope: string;
}

export class RateLimitConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitConfigurationError";
  }
}

export class RateLimitUnavailableError extends Error {
  override cause: unknown;

  constructor(cause: unknown) {
    super("安全限流服務暫時無法使用，請稍後再試");
    this.name = "RateLimitUnavailableError";
    this.cause = cause;
  }
}

export function assertRateLimitConfiguration(
  env: { NODE_ENV?: string; RATE_LIMIT_SECRET?: string } = process.env,
): void {
  if (env.NODE_ENV !== "production") return;
  const secret = env.RATE_LIMIT_SECRET?.trim() ?? "";
  if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new RateLimitConfigurationError(
      `production 必須設定至少 ${MIN_PRODUCTION_SECRET_LENGTH} 字元的 RATE_LIMIT_SECRET`,
    );
  }
}

function validateScopeAndSubject(scope: string, subject: string): void {
  if (!scope || scope.length > 80 || !/^[a-z0-9:_-]+$/i.test(scope)) {
    throw new RateLimitConfigurationError("rate-limit scope 無效");
  }
  if (!subject || subject.length > 2_000) {
    throw new RateLimitConfigurationError("rate-limit subject 無效");
  }
}

/**
 * Pure key derivation, exported for regression tests. Production deliberately
 * refuses a missing/weak secret: plain SHA-256 is safe only as a local/test
 * fallback because email/IP spaces can otherwise be enumerated offline.
 */
export function deriveRateLimitIdentity(
  scope: string,
  subject: string,
  env: { NODE_ENV?: string; RATE_LIMIT_SECRET?: string } = process.env,
): RateLimitIdentity {
  validateScopeAndSubject(scope, subject);
  const payload = `ai-director-os:${KEY_VERSION}\0${scope}\0${subject}`;
  const secret = env.RATE_LIMIT_SECRET?.trim() ?? "";
  assertRateLimitConfiguration(env);
  const digest = secret.length >= MIN_PRODUCTION_SECRET_LENGTH
    ? createHmac("sha256", secret).update(payload).digest("hex")
    : createHash("sha256").update(`non-production-only\0${payload}`).digest("hex");
  return { keyHash: `${KEY_VERSION}:${digest}`, scope };
}

function finiteEpoch(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export function normalizeRateLimitState(raw: unknown): RateLimitState {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const hits = Array.isArray(value.hits)
    ? value.hits.map(finiteEpoch).filter((v): v is number => v != null).slice(-MAX_BUCKET_HITS)
    : [];
  const blockedUntil = finiteEpoch(value.blockedUntil);
  return {
    hits,
    ...(blockedUntil == null ? {} : { blockedUntil }),
  };
}

function validatePolicy(policy: RateLimitPolicy): void {
  if (!Number.isSafeInteger(policy.limit) || policy.limit < 1 || policy.limit > MAX_BUCKET_HITS) {
    throw new RateLimitConfigurationError(`rate-limit limit 必須是 1..${MAX_BUCKET_HITS} 的整數`);
  }
  if (!Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1_000 || policy.windowMs > RATE_LIMIT_MAX_WINDOW_MS) {
    throw new RateLimitConfigurationError("rate-limit windowMs 必須介於 1 秒與 24 小時");
  }
}

function validateFailurePolicy(policy: FailureRateLimitPolicy): void {
  validatePolicy(policy);
  if (!Number.isSafeInteger(policy.blockMs) || policy.blockMs < 1_000 || policy.blockMs > RATE_LIMIT_MAX_WINDOW_MS) {
    throw new RateLimitConfigurationError("rate-limit blockMs 必須介於 1 秒與 24 小時");
  }
}

function activeHits(state: RateLimitState, now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return state.hits.filter((hit) => hit > cutoff && hit <= now);
}

/** Pure sliding-window decision: denied calls do not extend the window. */
export function decideSlidingWindow(
  previous: unknown,
  now: number,
  policy: RateLimitPolicy,
): { state: RateLimitState; decision: RateLimitDecision } {
  validatePolicy(policy);
  const state = normalizeRateLimitState(previous);
  const hits = activeHits(state, now, policy.windowMs);
  if (state.blockedUntil != null && state.blockedUntil > now) {
    return {
      state: { ...state, hits },
      decision: {
        allowed: false,
        hitCount: hits.length,
        retryAfterMs: Math.max(1, state.blockedUntil - now),
      },
    };
  }
  if (hits.length >= policy.limit) {
    const retryAt = hits[0] + policy.windowMs;
    return {
      state: { hits },
      decision: {
        allowed: false,
        hitCount: hits.length,
        retryAfterMs: Math.max(1, retryAt - now),
      },
    };
  }
  const nextHits = [...hits, now];
  return {
    state: { hits: nextHits },
    decision: { allowed: true, hitCount: nextHits.length, retryAfterMs: 0 },
  };
}

/** Pure MCP-style failure recorder: the Nth failure starts a fixed block. */
export function decideFailureWindow(
  previous: unknown,
  now: number,
  policy: FailureRateLimitPolicy,
): { state: RateLimitState; decision: FailureRateLimitDecision } {
  validateFailurePolicy(policy);
  const state = normalizeRateLimitState(previous);
  const hits = activeHits(state, now, policy.windowMs);
  if (state.blockedUntil != null && state.blockedUntil > now) {
    return {
      state: { hits, blockedUntil: state.blockedUntil },
      decision: {
        blocked: true,
        hitCount: hits.length,
        retryAfterMs: Math.max(1, state.blockedUntil - now),
      },
    };
  }
  const nextHits = [...hits, now];
  if (nextHits.length >= policy.limit) {
    const blockedUntil = now + policy.blockMs;
    return {
      state: { hits: nextHits.slice(-policy.limit), blockedUntil },
      decision: { blocked: true, hitCount: nextHits.length, retryAfterMs: policy.blockMs },
    };
  }
  return {
    state: { hits: nextHits },
    decision: { blocked: false, hitCount: nextHits.length, retryAfterMs: 0 },
  };
}

export function inspectFailureBlock(previous: unknown, now: number, windowMs: number): FailureRateLimitDecision {
  const state = normalizeRateLimitState(previous);
  const hits = activeHits(state, now, windowMs);
  const retryAfterMs = state.blockedUntil != null && state.blockedUntil > now
    ? state.blockedUntil - now
    : 0;
  return {
    blocked: retryAfterMs > 0,
    hitCount: hits.length,
    retryAfterMs,
  };
}

type RateLimitTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface LockedContext {
  tx: RateLimitTransaction;
  now: number;
  states: Map<string, RateLimitState>;
}

async function saveState(
  tx: RateLimitTransaction,
  identity: RateLimitIdentity,
  state: RateLimitState,
  now: number,
): Promise<void> {
  await tx
    .insert(schema.rateLimitBuckets)
    .values({
      keyHash: identity.keyHash,
      scope: identity.scope,
      state,
      updatedAt: new Date(now),
    })
    .onConflictDoUpdate({
      target: schema.rateLimitBuckets.keyHash,
      set: { scope: identity.scope, state, updatedAt: new Date(now) },
    });
}

async function runLocked<T>(
  identities: RateLimitIdentity[],
  operation: (context: LockedContext) => Promise<T>,
): Promise<T> {
  const unique = [...new Map(identities.map((identity) => [identity.keyHash, identity])).values()]
    .sort((a, b) => a.keyHash.localeCompare(b.keyHash));
  if (unique.length === 0) throw new RateLimitConfigurationError("rate-limit 至少需要一個 key");
  try {
    // Cleanup uses its own short transaction before current-key locks. Keeping
    // it inside the hot transaction can deadlock when two replicas revive two
    // different stale rows and each cleanup tries to delete the other's row.
    await db.execute(sql`
      delete from ${schema.rateLimitBuckets}
      where key_hash in (
        select key_hash
        from ${schema.rateLimitBuckets}
        where updated_at < clock_timestamp() - (${RATE_LIMIT_STALE_BUCKET_MS} * interval '1 millisecond')
        order by updated_at
        limit ${PRUNE_BATCH}
      )
    `);
    return await db.transaction(async (tx) => {
      // Deterministic order prevents deadlocks when one operation owns multiple
      // identities (for example auth email + IP). hashtextextended supplies a
      // stable 64-bit lock key.
      for (const identity of unique) {
        await tx.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${identity.keyHash}, 0))
        `);
      }
      const clock = await tx.execute(sql`
        select floor(extract(epoch from clock_timestamp()) * 1000)::text as now_ms
      `);
      const now = Number((clock as { rows?: Array<{ now_ms?: string }> }).rows?.[0]?.now_ms);
      if (!Number.isSafeInteger(now)) throw new Error("PostgreSQL clock_timestamp 無法解析");

      const rows = await tx
        .select({
          keyHash: schema.rateLimitBuckets.keyHash,
          state: schema.rateLimitBuckets.state,
        })
        .from(schema.rateLimitBuckets)
        .where(inArray(schema.rateLimitBuckets.keyHash, unique.map((identity) => identity.keyHash)));
      const states = new Map(rows.map((row) => [row.keyHash, normalizeRateLimitState(row.state)]));
      return operation({ tx, now, states });
    });
  } catch (error) {
    if (error instanceof RateLimitConfigurationError || error instanceof RateLimitUnavailableError) throw error;
    throw new RateLimitUnavailableError(error);
  }
}

export async function consumeRateLimit(
  scope: string,
  subject: string,
  policy: RateLimitPolicy,
): Promise<RateLimitDecision> {
  const identity = deriveRateLimitIdentity(scope, subject);
  return runLocked([identity], async ({ tx, now, states }) => {
    const result = decideSlidingWindow(states.get(identity.keyHash), now, policy);
    await saveState(tx, identity, result.state, now);
    return result.decision;
  });
}

export async function consumeRateLimits(
  requests: Array<{ scope: string; subject: string; policy: RateLimitPolicy }>,
): Promise<RateLimitDecision[]> {
  const entries = requests.map((request) => ({
    ...request,
    identity: deriveRateLimitIdentity(request.scope, request.subject),
  }));
  return runLocked(entries.map((entry) => entry.identity), async ({ tx, now, states }) => {
    const decisions: RateLimitDecision[] = [];
    for (const entry of entries) {
      const result = decideSlidingWindow(states.get(entry.identity.keyHash), now, entry.policy);
      states.set(entry.identity.keyHash, result.state);
      await saveState(tx, entry.identity, result.state, now);
      decisions.push(result.decision);
    }
    return decisions;
  });
}

export async function inspectFailureRateLimit(
  scope: string,
  subject: string,
  policy: FailureRateLimitPolicy,
): Promise<FailureRateLimitDecision> {
  validateFailurePolicy(policy);
  const identity = deriveRateLimitIdentity(scope, subject);
  return runLocked([identity], async ({ now, states }) =>
    inspectFailureBlock(states.get(identity.keyHash), now, policy.windowMs));
}

export async function recordRateLimitFailure(
  scope: string,
  subject: string,
  policy: FailureRateLimitPolicy,
): Promise<FailureRateLimitDecision> {
  const identity = deriveRateLimitIdentity(scope, subject);
  return runLocked([identity], async ({ tx, now, states }) => {
    const result = decideFailureWindow(states.get(identity.keyHash), now, policy);
    await saveState(tx, identity, result.state, now);
    return result.decision;
  });
}

export async function clearRateLimit(scope: string, subject: string): Promise<void> {
  const identity = deriveRateLimitIdentity(scope, subject);
  await runLocked([identity], async ({ tx }) => {
    await tx.delete(schema.rateLimitBuckets).where(eq(schema.rateLimitBuckets.keyHash, identity.keyHash));
  });
}

export async function settleRateLimits(
  operations: Array<{ scope: string; subject: string; action: "clear" | "release-latest" }>,
): Promise<void> {
  const entries = operations.map((operation) => ({
    ...operation,
    identity: deriveRateLimitIdentity(operation.scope, operation.subject),
  }));
  await runLocked(entries.map((entry) => entry.identity), async ({ tx, now, states }) => {
    for (const entry of entries) {
      if (entry.action === "clear") {
        await tx.delete(schema.rateLimitBuckets).where(eq(schema.rateLimitBuckets.keyHash, entry.identity.keyHash));
        states.delete(entry.identity.keyHash);
        continue;
      }
      const state = normalizeRateLimitState(states.get(entry.identity.keyHash));
      const hits = state.hits.slice(0, -1);
      if (hits.length === 0 && (state.blockedUntil == null || state.blockedUntil <= now)) {
        await tx.delete(schema.rateLimitBuckets).where(eq(schema.rateLimitBuckets.keyHash, entry.identity.keyHash));
        states.delete(entry.identity.keyHash);
      } else {
        const next = { ...state, hits };
        states.set(entry.identity.keyHash, next);
        await saveState(tx, entry.identity, next, now);
      }
    }
  });
}

/**
 * Project assistant uses the same 6/min user bucket from SSE and tRPC.
 *
 * dedupeKey remains in the signature for wire compatibility but deliberately
 * grants no free request. Without a persisted result/in-flight lease, treating
 * the second same-nonce request as "fallback" lets a hostile client run SSE and
 * tRPC concurrently and double paid LLM throughput. A genuine result cache can
 * reintroduce dedupe later; until then every external invocation consumes one.
 */
export async function consumeProjectAssistantRate(
  userId: string,
  _dedupeKey?: string,
): Promise<RateLimitDecision & { deduplicated: boolean }> {
  const decision = await consumeRateLimit(
    RATE_LIMIT_SCOPES.projectAssistant,
    userId,
    RATE_LIMIT_POLICIES.projectAssistant,
  );
  return { ...decision, deduplicated: false };
}
