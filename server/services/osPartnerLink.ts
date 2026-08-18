/**
 * 深度／CUTOS／Aios_b 連結的執行層。
 *
 * 契約在 shared/osPartnerLink.ts；這裡只做兩件事：讀環境、讀最近一份 Sentinel 報告。
 * 報告檔讀不到或形狀不對＝沒有報告，不是「檢測通過」。
 */
import { readFile } from "node:fs/promises";
import {
  OS_PARTNER_ENV,
  buildOsPartnerSnapshot,
  publicOsPartnerHandshake,
  readyPartnersNote,
  summarizeSentinelReport,
  type OsPartnerSnapshot,
  type SentinelReportSummary,
} from "../../shared/osPartnerLink";

export async function readSentinelReportFile(path: string): Promise<SentinelReportSummary | null> {
  const trimmed = path.trim();
  if (!trimmed) return null;
  try {
    const raw = await readFile(trimmed, "utf8");
    return summarizeSentinelReport(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function loadOsPartnerSnapshot(
  env: NodeJS.Dict<string> = process.env,
): Promise<OsPartnerSnapshot> {
  const reportPath = env[OS_PARTNER_ENV.sentinelReport];
  const report = reportPath ? await readSentinelReportFile(reportPath) : null;
  return buildOsPartnerSnapshot(env, report);
}

export async function osPartnerReadyNote(env: NodeJS.Dict<string> = process.env) {
  const snapshot = await loadOsPartnerSnapshot(env);
  return readyPartnersNote(snapshot);
}

export async function osPartnerHandshake(env: NodeJS.Dict<string> = process.env) {
  return publicOsPartnerHandshake(await loadOsPartnerSnapshot(env));
}

export async function osPartnerAdminView(env: NodeJS.Dict<string> = process.env) {
  const snapshot = await loadOsPartnerSnapshot(env);
  return {
    ...snapshot,
    ready: readyPartnersNote(snapshot),
  };
}
