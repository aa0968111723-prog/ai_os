/**
 * Isolate leftover platform / cloud-agent env from the unit suite.
 *
 * The snapshot injects S3/MinIO, Redis, FAL, APP_URL, and a remote DATABASE_URL
 * (hostname `base`). Those make persist tests hit minio.zeabur.internal, cache
 * tests hang on Redis DNS, and falBilling tests spend wall-clock on a real key.
 * Local/CI unit tests assume disk + memory cache and must never call paid APIs.
 *
 * DATABASE_URL is only remapped when it clearly points at an internal/cloud
 * leftover. CI's test job leaves it unset (pg suites skip). A genuine
 * localhost / 127.0.0.1 URL is left alone.
 */
function unset(...keys: string[]) {
  for (const key of keys) delete process.env[key];
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
);

const raw = process.env.DATABASE_URL?.trim() ?? "";
if (raw) {
  try {
    const host = new URL(raw).hostname;
    const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const leftover = host === "base" || host.endsWith(".internal");
    // Drop unreachable cloud leftovers so un-gated *.pg.test.ts skip instead of DNS-failing.
    // Do not rewrite to a hardcoded URL (secret scanners treat that as a credential).
    if (!local && leftover) delete process.env.DATABASE_URL;
  } catch {
    /* leave malformed URLs for the suite that asserts on them */
  }
}
