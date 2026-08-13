/**
 * Gemini runtime verification.
 *
 *   npm run verify:gemini
 *
 * Contract checks always run and never need a live key.
 * Live image / edit / Omni video only run when process.env.GEMINI_API_KEY is set
 * (Zeabur production/staging). Missing key → BLOCKED_BY_EXTERNAL_DEPENDENCY.
 * Never prints the key. Never fakes PASS.
 */
import { loadLocalEnv } from "../server/bootstrap/loadEnv";
import {
  geminiApiKeyConfigured,
  geminiStatus,
  geminiSubmit,
  parseStoredGeminiUrl,
  redactGeminiSecrets,
} from "../server/services/gemini";
import { getModel, isGeminiModel } from "../shared/models";

loadLocalEnv();

type Verdict = "PASS" | "FAIL" | "BLOCKED_BY_EXTERNAL_DEPENDENCY";

const results: Array<{ name: string; verdict: Verdict; detail: string }> = [];

function record(name: string, verdict: Verdict, detail: string): void {
  results.push({ name, verdict, detail: redactGeminiSecrets(detail) });
  console.log(`${verdict} ${name}${detail ? ` — ${detail}` : ""}`);
}

function configuredLine(): string {
  return `GEMINI_API_KEY configured=${geminiApiKeyConfigured() ? "true" : "false"}`;
}

async function poll(requestId: string, timeoutMs: number): Promise<ReturnType<typeof geminiStatus>> {
  const deadline = Date.now() + timeoutMs;
  let status = geminiStatus(requestId);
  while (status.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    status = geminiStatus(requestId);
  }
  return status;
}

function assertNoSecret(label: string, value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/AIza[0-9A-Za-z_-]{20,}/.test(text) || /GEMINI_API_KEY\s*[:=]\s*\S+/.test(text)) {
    record(label, "FAIL", "payload still contains a secret pattern");
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  console.log(configuredLine());

  const image = getModel("google/gemini#gemini-2.5-flash-image");
  const edit = getModel("google/gemini#gemini-2.5-flash-image-edit");
  const video = getModel("google/gemini#gemini-omni-flash");
  if (image && edit && video && isGeminiModel(image) && isGeminiModel(edit) && isGeminiModel(video)) {
    record("catalog", "PASS", "image / edit / omni registered");
  } else {
    record("catalog", "FAIL", "native Gemini models missing");
  }

  const redacted = redactGeminiSecrets("GEMINI_API_KEY=AIzaSyDummyTokenValue0000000000000");
  if (!redacted.includes("AIza") && redacted.includes("[redacted]")) {
    record("redact", "PASS", "secrets stripped");
  } else {
    record("redact", "FAIL", redacted);
  }

  if (!geminiApiKeyConfigured()) {
    record("configured", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "local/runtime cannot read Zeabur GEMINI_API_KEY");
    record("live-image", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "skipped — no live credential");
    record("live-edit", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "skipped — no live credential");
    record("live-omni", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "skipped — no live credential");
    record("storage-attach-reload", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "needs Zeabur deploy + live generate");
    finish();
    return;
  }

  record("configured", "PASS", "backend sees GEMINI_API_KEY configured=true");

  const imageJob = await geminiSubmit("image", { prompt: "極簡水彩一盞暖燈,單色,測試用" });
  const imageDone = await poll(imageJob.requestId, 120_000);
  if (imageDone.status === "done" && imageDone.resultUrl && parseStoredGeminiUrl(imageDone.resultUrl)) {
    record("live-image", "PASS", "image persisted to storage handle");
    assertNoSecret("live-image-payload", imageDone);
  } else {
    record("live-image", "FAIL", imageDone.status === "failed" ? imageDone.error ?? "failed" : "no stored result");
  }

  const sourceUrl = imageDone.status === "done" ? imageDone.resultUrl : undefined;
  if (!sourceUrl) {
    record("live-edit", "FAIL", "no image to edit");
  } else {
    const editJob = await geminiSubmit("image", {
      prompt: "保持構圖,把燈光再暖一點",
      image_url: sourceUrl,
    });
    const editDone = await poll(editJob.requestId, 120_000);
    if (editDone.status === "done" && editDone.resultUrl && parseStoredGeminiUrl(editDone.resultUrl)) {
      record("live-edit", "PASS", "reference/edit persisted");
      assertNoSecret("live-edit-payload", editDone);
    } else {
      record("live-edit", "FAIL", editDone.status === "failed" ? editDone.error ?? "failed" : "no stored result");
    }
  }

  const videoJob = await geminiSubmit("video", { prompt: "極簡水彩暖燈緩慢亮起,4秒" });
  const videoDone = await poll(videoJob.requestId, 200_000);
  if (videoDone.status === "done" && videoDone.resultUrl && parseStoredGeminiUrl(videoDone.resultUrl)) {
    record("live-omni", "PASS", "shortest video persisted");
    assertNoSecret("live-omni-payload", videoDone);
  } else {
    record("live-omni", "FAIL", videoDone.status === "failed" ? videoDone.error ?? "failed" : "no stored result");
  }

  record(
    "storage-attach-reload",
    "BLOCKED_BY_EXTERNAL_DEPENDENCY",
    "this CLI does not open a Shot; attach/reload must be certified on the Zeabur app after deploy",
  );
  finish();
}

function finish(): void {
  const failed = results.filter((row) => row.verdict === "FAIL").length;
  const blocked = results.filter((row) => row.verdict === "BLOCKED_BY_EXTERNAL_DEPENDENCY").length;
  const passed = results.filter((row) => row.verdict === "PASS").length;
  console.log(`SUMMARY pass=${passed} blocked=${blocked} fail=${failed}`);
  if (failed > 0) process.exitCode = 1;
  else if (blocked > 0) process.exitCode = 2;
}

await main();
