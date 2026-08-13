/**
 * Gemini runtime verification.
 *
 *   npm run verify:gemini
 *
 * Contract checks always run and never need a live key.
 * Live image / edit / Omni / storage / generation / shot attach / reload
 * only run when process.env.GEMINI_API_KEY is set (Zeabur).
 * Missing key or database → BLOCKED_BY_EXTERNAL_DEPENDENCY.
 * Never prints the key. Never fakes PASS.
 */
import { loadLocalEnv } from "../server/bootstrap/loadEnv";
import {
  formatGeminiCertReport,
  geminiCertExitCode,
  runGeminiCertification,
} from "../server/services/geminiCertification";

loadLocalEnv();

const report = await runGeminiCertification({ live: true, persistAttach: true });
console.log(formatGeminiCertReport(report));
process.exitCode = geminiCertExitCode(report);
