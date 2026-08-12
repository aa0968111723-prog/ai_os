/**
 * CLI: scan agent DB integrity and print a readable report.
 *
 * Usage:
 *   npx tsx scripts/scan-agent-integrity.ts
 *   npx tsx scripts/scan-agent-integrity.ts --stale-minutes 45
 *
 * Exit code 2 when any P0 finding is present.
 */
import { formatIntegrityReport, scanAgentIntegrity } from "../server/services/agentIntegrityScanner";

async function main(): Promise<void> {
  const staleArg = process.argv.find((arg) => arg.startsWith("--stale-minutes="));
  const staleRunningMinutes = staleArg ? Number(staleArg.split("=")[1]) : 30;
  const report = await scanAgentIntegrity({ staleRunningMinutes });
  console.log(formatIntegrityReport(report));
  if (!report.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
