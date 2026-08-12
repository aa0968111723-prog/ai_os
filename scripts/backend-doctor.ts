/**
 * backend:doctor — operator report with no secrets.
 *
 *   npm run backend:doctor
 */
import { loadLocalEnv } from "../server/bootstrap/loadEnv";
import { formatBackendDoctor, probeBackendRuntime } from "../server/services/backendDependencies";
import { runAgentDbIntegrityScan } from "../server/services/agentDbIntegrity";
import { pool } from "../server/db";

loadLocalEnv();

const snapshot = await probeBackendRuntime();
console.log(formatBackendDoctor(snapshot));
if (snapshot.database.connected) {
  const integrity = await runAgentDbIntegrityScan(15);
  console.log(`AGENT_DB ${integrity.ok ? "VERIFIED" : "UNHEALTHY"} critical=${integrity.criticalCount} warnings=${integrity.warningCount}`);
  if (!integrity.ok) process.exitCode = 1;
}
await pool.end().catch(() => undefined);
if (!snapshot.ready) process.exitCode = 1;
