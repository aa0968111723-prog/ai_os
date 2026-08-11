import { runAgentDbIntegrityScan } from "../server/services/agentDbIntegrity";

const report = await runAgentDbIntegrityScan(Number(process.env.AGENT_STALE_RUN_MINUTES ?? 15));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
