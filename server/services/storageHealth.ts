import { assessStoragePersistence, getDegradeState, STORAGE_ROOT } from "./storage";
import { lastAuditRun, getLastBackupAgeHours } from "./storageAudit";

export async function getStorageHealthSummary() {
  const persistence = await assessStoragePersistence();
  const degrade = getDegradeState();
  const lastAudit = await lastAuditRun();
  const backupAgeHours = await getLastBackupAgeHours();
  return {
    persistence,
    degrade,
    lastAudit,
    backupAgeHours,
    storageRoot: STORAGE_ROOT,
  };
}

export { assessStoragePersistence };
