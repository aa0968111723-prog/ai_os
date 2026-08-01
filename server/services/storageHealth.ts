import { db } from "../db";
import { storageState } from "../db/schema";
import { eq } from "drizzle-orm";
import { assessStoragePersistence, verifyVolumeIdentity } from "./storage";
import { getLastAuditRun } from "./storageAudit";

export type StorageHealth = {
  persistent: boolean;
  reasons: string[];
  volumeId: string | null;
  degraded: boolean;
  degradeReason: string | null;
  lastAudit: Awaited<ReturnType<typeof getLastAuditRun>> | null;
};

let cached: StorageHealth | null = null;
let cachedAt = 0;
const CACHE_MS = 15_000;

export async function getStorageHealth(force = false): Promise<StorageHealth> {
  const now = Date.now();
  if (!force && cached && now - cachedAt < CACHE_MS) return cached;

  const persist = await assessStoragePersistence();
  const identity = await verifyVolumeIdentity();
  const lastAudit = await getLastAuditRun();

  const reasons: string[] = [];
  if (!persist.ok) reasons.push(...persist.reasons);
  if (identity.degraded) reasons.push(identity.reason ?? "volume-changed");

  cached = {
    persistent: persist.ok,
    reasons,
    volumeId: identity.volumeId,
    degraded: identity.degraded || !persist.ok,
    degradeReason: identity.degraded ? identity.reason : (!persist.ok ? persist.reasons[0] : null),
    lastAudit,
  };
  cachedAt = now;
  return cached;
}

export async function acknowledgeVolumeChange(): Promise<void> {
  const identity = await verifyVolumeIdentity({ forceRewrite: true });
  cached = null;
  void identity;
}
