export interface DatabaseImportPayload {
  tableId: string;
  content: string;
  format: string;
  headerMap: Record<string, string>;
}

export interface DatabaseImportAttempt {
  signature: string;
  key: string;
  createdAt: number;
}

interface ImportAttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_PREFIX = "ai-os:database-import:";
export const DATABASE_IMPORT_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING_ATTEMPTS_PER_TABLE = 10;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/** Compact, deterministic non-secret fingerprint; raw imported content is never persisted in web storage. */
function compactFingerprint(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const left = (h2 >>> 0).toString(16).padStart(8, "0");
  const right = (h1 >>> 0).toString(16).padStart(8, "0");
  return `${value.length.toString(36)}-${left}${right}`;
}

/** Stable client-side identity used only to decide whether to retain the key. */
export function databaseImportPayloadSignature(payload: DatabaseImportPayload): string {
  return compactFingerprint(JSON.stringify([
    payload.tableId,
    payload.content,
    payload.format,
    Object.entries(payload.headerMap)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  ]));
}

export function createDatabaseImportIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Header-safe fallback for older embedded browsers. Randomness is used for
  // uniqueness, not authentication; the server stores only its SHA-256 hash.
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function browserSessionStorage(): ImportAttemptStorage | null {
  try {
    return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
  } catch {
    // Safari private mode or an embedded browser may deny storage access.
    return null;
  }
}

function storageKey(tableId: string): string {
  return `${STORAGE_PREFIX}${tableId}`;
}

function validStoredAttempts(raw: string | null, now: number): DatabaseImportAttempt[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as
    | { version?: number; attempts?: Partial<DatabaseImportAttempt>[] }
    | Partial<DatabaseImportAttempt>;
  // Accept the original single-attempt shape so an in-progress request is not
  // invalidated by a rolling frontend upgrade.
  const candidates = Array.isArray((parsed as { attempts?: unknown }).attempts)
    ? (parsed as { attempts: Partial<DatabaseImportAttempt>[] }).attempts
    : [parsed as Partial<DatabaseImportAttempt>];
  return candidates.filter((saved): saved is DatabaseImportAttempt =>
    typeof saved.signature === "string"
    && typeof saved.key === "string"
    && SAFE_KEY.test(saved.key)
    && typeof saved.createdAt === "number"
    && now - saved.createdAt >= 0
    && now - saved.createdAt < DATABASE_IMPORT_ATTEMPT_TTL_MS,
  );
}

/**
 * Returns the same key after a response-loss reload when the payload is identical.
 * A changed payload, an invalid record or a record older than the server's 24h TTL
 * gets a fresh key. Storage failure degrades to in-memory caller state, never blocks import.
 */
export function getDatabaseImportAttempt(
  payload: DatabaseImportPayload,
  options: {
    storage?: ImportAttemptStorage | null;
    now?: number;
  } = {},
): DatabaseImportAttempt {
  const signature = databaseImportPayloadSignature(payload);
  const now = options.now ?? Date.now();
  const storage = options.storage === undefined ? browserSessionStorage() : options.storage;
  let retained: DatabaseImportAttempt[] = [];
  if (storage) {
    try {
      retained = validStoredAttempts(storage.getItem(storageKey(payload.tableId)), now);
      const matched = retained.find((saved) => saved.signature === signature);
      if (matched) return matched;
    } catch {
      // Corrupt or inaccessible storage is replaced below.
    }
  }
  const attempt = {
    signature,
    key: createDatabaseImportIdempotencyKey(),
    createdAt: now,
  };
  try {
    storage?.setItem(storageKey(payload.tableId), JSON.stringify({
      version: 1,
      attempts: [...retained, attempt].slice(-MAX_PENDING_ATTEMPTS_PER_TABLE),
    }));
  } catch {
    // The ref held by the caller still protects retries within this page lifetime.
  }
  return attempt;
}

/** Clear only the completed attempt; never delete another tab/action's newer key. */
export function clearDatabaseImportAttempt(
  tableId: string,
  completedKey: string,
  storage: ImportAttemptStorage | null = browserSessionStorage(),
): void {
  if (!storage) return;
  try {
    const attempts = validStoredAttempts(storage.getItem(storageKey(tableId)), Date.now())
      .filter((saved) => saved.key !== completedKey);
    if (attempts.length) {
      storage.setItem(storageKey(tableId), JSON.stringify({ version: 1, attempts }));
    } else {
      storage.removeItem(storageKey(tableId));
    }
  } catch {
    // Best-effort cleanup; TTL bounds any damaged/stale record.
  }
}
