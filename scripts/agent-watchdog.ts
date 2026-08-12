import { loadLocalEnv } from "../server/bootstrap/loadEnv";
import { runAgentWatchdog } from "../server/services/agentWatchdog";
import { pool } from "../server/db";

loadLocalEnv();
const report = await runAgentWatchdog(Number(process.env.AGENT_STALE_RUN_MINUTES ?? 15));
console.log(JSON.stringify(report));
await pool.end().catch(() => undefined);
