/**
 * Isolate leftover platform / cloud-agent env from the unit suite.
 *
 * The snapshot injects S3/MinIO, Redis, FAL, APP_URL, E2E_MOCK, and sometimes a
 * remote DATABASE_URL / PGHOST=base. Those make persist tests hit
 * minio.zeabur.internal, cache tests hang on Redis DNS, falBilling spend
 * wall-clock on a real key, and un-gated *.pg.test.ts fail DNS.
 * Local/CI unit tests assume disk + memory cache and must never call paid APIs.
 */
import { loadLocalEnv } from "../bootstrap/loadEnv";

function unset(...keys: string[]) {
  for (const key of keys) delete process.env[key];
}

function isLoopbackHost(host: string | undefined): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function databaseUrlLooksLocal(raw: string): boolean {
  try {
    return isLoopbackHost(new URL(raw).hostname);
  } catch {
    return /(?:^|[?\s])host\s*=\s*(localhost|127\.0\.0\.1|::1)\b/i.test(raw);
  }
}

unset(
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
  "MINIO_ENDPOINT",
  "MINIO_BUCKET",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  "REDIS_URL",
  "REDIS_PRIVATE_URL",
  "APP_URL",
  "PUBLIC_DOMAIN",
  "FAL_KEY",
  "FAL_ADMIN_KEY",
  "GEMINI_API_KEY",
  "E2E_MOCK",
  "MOCK_BILLING",
);

const raw = process.env.DATABASE_URL?.trim() ?? "";
if (raw && !databaseUrlLooksLocal(raw)) delete process.env.DATABASE_URL;
if (process.env.PGHOST && !isLoopbackHost(process.env.PGHOST)) delete process.env.PGHOST;

loadLocalEnv();

// .env may put E2E_MOCK / paid keys back. Unit tests must stay offline.
// Keep E2E_MOCK/MOCK_BILLING as "" (present) so later loadEnv() calls in
// individual test files cannot refill "1" from `.env`. isMockMode() is true
// only when E2E_MOCK==="1".
unset(
  "FAL_KEY",
  "FAL_ADMIN_KEY",
  "GEMINI_API_KEY",
  "APP_URL",
  "PUBLIC_DOMAIN",
);
process.env.E2E_MOCK = "";
process.env.MOCK_BILLING = "";
