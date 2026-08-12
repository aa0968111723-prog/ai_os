/**
 * backend:doctor — operator report with no secrets.
 *
 *   npm run backend:doctor
 */
import { loadLocalEnv } from "../server/bootstrap/loadEnv";
import { formatBackendDoctor, probeBackendRuntime } from "../server/services/backendDependencies";
import { pool } from "../server/db";

loadLocalEnv();

const snapshot = await probeBackendRuntime();
console.log(formatBackendDoctor(snapshot));
await pool.end().catch(() => undefined);
if (!snapshot.ready) process.exitCode = 1;
