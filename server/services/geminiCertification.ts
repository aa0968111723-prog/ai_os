/**
 * Gemini live / persist certification.
 * The API key is read only from process.env.GEMINI_API_KEY and never returned.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { geminiApiKeyConfigured, geminiStatus, geminiSubmit, parseStoredGeminiUrl, redactGeminiSecrets } from "./gemini";
import { getModel, isGeminiModel } from "../../shared/models";
import { db, schema } from "../db";
import { submitGenerationCore, advanceGeneration } from "./generationCore";
import { parseStoredResultUrl, STORAGE_ROOT } from "./storage";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isMockMode } from "./fal";

export type GeminiCertVerdict = "PASS" | "FAIL" | "BLOCKED_BY_EXTERNAL_DEPENDENCY";

export interface GeminiCertItem {
  name: string;
  verdict: GeminiCertVerdict;
  detail: string;
}

export interface GeminiCertReport {
  configured: boolean;
  items: GeminiCertItem[];
  summary: { pass: number; blocked: number; fail: number };
}

const IMAGE_MODEL = "google/gemini#gemini-2.5-flash-image";
const EDIT_MODEL = "google/gemini#gemini-2.5-flash-image-edit";
const VIDEO_MODEL = "google/gemini#gemini-omni-flash";

export function containsGeminiSecret(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /AIza[0-9A-Za-z_-]{20,}/.test(text) || /GEMINI_API_KEY\s*[:=]\s*\S+/.test(text);
}

function item(name: string, verdict: GeminiCertVerdict, detail: string): GeminiCertItem {
  return { name, verdict, detail: redactGeminiSecrets(detail) };
}

function summarize(items: GeminiCertItem[]): GeminiCertReport["summary"] {
  return {
    pass: items.filter((row) => row.verdict === "PASS").length,
    blocked: items.filter((row) => row.verdict === "BLOCKED_BY_EXTERNAL_DEPENDENCY").length,
    fail: items.filter((row) => row.verdict === "FAIL").length,
  };
}

function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

async function pollGeminiJob(requestId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let status = geminiStatus(requestId);
  while (status.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    status = geminiStatus(requestId);
  }
  return status;
}

async function runDirectLive(items: GeminiCertItem[]): Promise<void> {
  const imageJob = await geminiSubmit("image", { prompt: "極簡水彩一盞暖燈,單色,認證用" });
  const imageDone = await pollGeminiJob(imageJob.requestId, 180_000);
  if (imageDone.status === "done" && imageDone.resultUrl && parseStoredGeminiUrl(imageDone.resultUrl)) {
    items.push(item("live-image", "PASS", "image persisted to storage handle"));
    items.push(item("storage", "PASS", "saveBuffer wrote image bytes"));
  } else {
    items.push(item("live-image", "FAIL", imageDone.status === "failed" ? imageDone.error ?? "failed" : "no stored result"));
    items.push(item("storage", "FAIL", "image did not land"));
  }

  const sourceUrl = imageDone.status === "done" ? imageDone.resultUrl : undefined;
  if (!sourceUrl) {
    items.push(item("live-edit", "FAIL", "no image to edit"));
  } else {
    const editJob = await geminiSubmit("image", { prompt: "保持構圖,把燈光再暖一點", image_url: sourceUrl });
    const editDone = await pollGeminiJob(editJob.requestId, 180_000);
    items.push(
      editDone.status === "done" && editDone.resultUrl && parseStoredGeminiUrl(editDone.resultUrl)
        ? item("live-edit", "PASS", "reference/edit persisted")
        : item("live-edit", "FAIL", editDone.status === "failed" ? editDone.error ?? "failed" : "no stored result"),
    );
  }

  const videoJob = await geminiSubmit("video", { prompt: "極簡水彩暖燈緩慢亮起,4秒" });
  const videoDone = await pollGeminiJob(videoJob.requestId, 240_000);
  items.push(
    videoDone.status === "done" && videoDone.resultUrl && parseStoredGeminiUrl(videoDone.resultUrl)
      ? item("live-omni", "PASS", "shortest video persisted")
      : item("live-omni", "FAIL", videoDone.status === "failed" ? videoDone.error ?? "failed" : "no stored result"),
  );
}

async function pollGeneration(id: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let row = await advanceGeneration(id);
  while ((row.status === "queued" || row.status === "running") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    row = await advanceGeneration(id);
  }
  return row;
}

export async function runGeminiCertification(opts: {
  live?: boolean;
  persistAttach?: boolean;
} = {}): Promise<GeminiCertReport> {
  const live = opts.live !== false;
  const persistAttach = opts.persistAttach !== false;
  const items: GeminiCertItem[] = [];
  const configured = geminiApiKeyConfigured();

  const image = getModel(IMAGE_MODEL);
  const edit = getModel(EDIT_MODEL);
  const video = getModel(VIDEO_MODEL);
  if (image && edit && video && isGeminiModel(image) && isGeminiModel(edit) && isGeminiModel(video)) {
    items.push(item("catalog", "PASS", "image / edit / omni registered"));
  } else {
    items.push(item("catalog", "FAIL", "native Gemini models missing"));
  }

  const redacted = redactGeminiSecrets("GEMINI_API_KEY=AIzaSyDummyTokenValue0000000000000");
  items.push(
    !redacted.includes("AIza") && redacted.includes("[redacted]")
      ? item("redact", "PASS", "secrets stripped")
      : item("redact", "FAIL", redacted),
  );

  items.push(
    configured
      ? item("configured", "PASS", "GEMINI_API_KEY configured=true")
      : item("configured", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "runtime cannot read Zeabur GEMINI_API_KEY"),
  );

  if (!live || !configured) {
    for (const name of ["live-image", "live-edit", "live-omni"] as const) {
      items.push(item(name, "BLOCKED_BY_EXTERNAL_DEPENDENCY", "skipped — no live credential"));
    }
    for (const name of ["storage", "generation-record", "asset-record", "shot-attach", "reload"] as const) {
      items.push(item(name, "BLOCKED_BY_EXTERNAL_DEPENDENCY", "needs live generate + database"));
    }
    const report = { configured, items, summary: summarize(items) };
    if (containsGeminiSecret(report)) {
      items.push(item("no-secret", "FAIL", "report still contains a secret pattern"));
    } else {
      items.push(item("no-secret", "PASS", "report has no API key"));
    }
    return { configured, items, summary: summarize(items) };
  }

  if (!persistAttach || !databaseConfigured()) {
    await runDirectLive(items);
    items.push(item("generation-record", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "DATABASE_URL missing"));
    items.push(item("asset-record", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "DATABASE_URL missing"));
    items.push(item("shot-attach", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "DATABASE_URL missing"));
    items.push(item("reload", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "DATABASE_URL missing"));
    items.push(item("no-secret", containsGeminiSecret(items) ? "FAIL" : "PASS", "report has no API key"));
    return { configured, items, summary: summarize(items) };
  }

  const fixture = await createGeminiCertFixture();
  try {
    const imageGen = await submitGenerationCore({
      userId: fixture.userId,
      projectId: fixture.projectId,
      modelId: IMAGE_MODEL,
      prompt: "極簡水彩一盞暖燈,單色,認證用",
      sceneId: fixture.imageShotId,
      sceneRole: "visual",
      reasonPrefix: "Gemini 認證",
    });
    const imageDone = await pollGeneration(imageGen.id, 180_000);
    recordProviderResult(items, "live-image", imageDone, "image");

    let editSourceAssetId: string | undefined;
    if (imageDone.status === "done") {
      const [asset] = await db
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(eq(schema.assets.projectId, fixture.projectId));
      editSourceAssetId = asset?.id;
    }

    if (!editSourceAssetId) {
      items.push(item("live-edit", "FAIL", "no image asset to edit"));
    } else {
      const editGen = await submitGenerationCore({
        userId: fixture.userId,
        projectId: fixture.projectId,
        modelId: EDIT_MODEL,
        prompt: "保持構圖,把燈光再暖一點",
        sourceAssetId: editSourceAssetId,
        sceneId: fixture.editShotId,
        sceneRole: "visual",
        reasonPrefix: "Gemini 認證",
      });
      const editDone = await pollGeneration(editGen.id, 180_000);
      recordProviderResult(items, "live-edit", editDone, "image");
    }

    const videoGen = await submitGenerationCore({
      userId: fixture.userId,
      projectId: fixture.projectId,
      modelId: VIDEO_MODEL,
      prompt: "極簡水彩暖燈緩慢亮起,4秒",
      sceneId: fixture.videoShotId,
      sceneRole: "visual",
      reasonPrefix: "Gemini 認證",
    });
    const videoDone = await pollGeneration(videoGen.id, 240_000);
    recordProviderResult(items, "live-omni", videoDone, "video");

    const generations = await db.select().from(schema.generations).where(eq(schema.generations.projectId, fixture.projectId));
    const assets = await db.select().from(schema.assets).where(eq(schema.assets.projectId, fixture.projectId));
    const shots = await db.select().from(schema.scenes).where(eq(schema.scenes.projectId, fixture.projectId));

    const liveBlocked = items.some((row) =>
      (row.name === "live-image" || row.name === "live-omni") && row.verdict === "BLOCKED_BY_EXTERNAL_DEPENDENCY",
    );
    const persistVerdict = liveBlocked ? "BLOCKED_BY_EXTERNAL_DEPENDENCY" : "FAIL";
    const persistReason = liveBlocked ? "live Gemini blocked by external billing" : undefined;

    const landed = assets.filter((row) => row.storagePath && row.landState === "landed" && row.url.startsWith("/api/assets/"));
    items.push(
      landed.length > 0
        ? item("storage", "PASS", `${landed.length} asset(s) landed in existing storage`)
        : item("storage", persistVerdict, persistReason ?? "no landed storagePath"),
    );
    items.push(
      generations.some((row) => row.status === "done")
        ? item("generation-record", "PASS", `${generations.filter((row) => row.status === "done").length} done generation(s)`)
        : item("generation-record", persistVerdict, persistReason ?? (generations.map((row) => `${row.modelId}:${row.status}`).join(",") || "none")),
    );
    items.push(
      assets.length > 0
        ? item("asset-record", "PASS", `${assets.length} asset(s)`)
        : item("asset-record", persistVerdict, persistReason ?? "no assets"),
    );

    const attached = shots.filter((shot) => shot.assetId && assets.some((asset) => asset.id === shot.assetId));
    items.push(
      attached.length > 0
        ? item("shot-attach", "PASS", `${attached.length} shot(s) have assetId`)
        : item("shot-attach", persistVerdict, persistReason ?? "no shot received an asset"),
    );

    const reloadedGens = await db.select().from(schema.generations).where(eq(schema.generations.projectId, fixture.projectId));
    const reloadedShots = await db.select().from(schema.scenes).where(eq(schema.scenes.projectId, fixture.projectId));
    const stillThere =
      reloadedGens.some((row) => row.status === "done") &&
      reloadedShots.some((shot) => shot.assetId);
    items.push(
      stillThere
        ? item("reload", "PASS", "generation and shot attach survive re-read")
        : item("reload", persistVerdict, persistReason ?? "reload lost generation or shot attach"),
    );

    const payload = { generations, assets, shots };
    items.push(
      containsGeminiSecret(payload)
        ? item("no-secret", "FAIL", "DB payload still contains a secret pattern")
        : item("no-secret", "PASS", "generation/asset/shot payloads have no API key"),
    );
  } catch (err) {
    const message = redactGeminiSecrets(err instanceof Error ? err.message : String(err));
    items.push(item("live-path", "FAIL", message));
    if (!items.some((row) => row.name === "no-secret")) {
      items.push(item("no-secret", containsGeminiSecret(message) ? "FAIL" : "PASS", "error path has no API key"));
    }
  } finally {
    await destroyGeminiCertFixture(fixture).catch(() => undefined);
  }

  return { configured, items, summary: summarize(items) };
}

function isExternalBillingBlock(message: string): boolean {
  return /RESOURCE_EXHAUSTED|prepayment credits are depleted|code": 429/i.test(message);
}

function recordProviderResult(
  items: GeminiCertItem[],
  name: string,
  row: { status: string; resultUrl: string | null; error: string | null },
  kind: "image" | "video",
): void {
  if (row.status === "done" && row.resultUrl) {
    const stored = parseStoredResultUrl(row.resultUrl);
    const local = row.resultUrl.startsWith("/api/assets/");
    items.push(item(name, stored || local ? "PASS" : "FAIL", stored ? "stored handle" : row.resultUrl));
    return;
  }
  const message = row.error || `${kind} status=${row.status}`;
  items.push(item(name, isExternalBillingBlock(message) ? "BLOCKED_BY_EXTERNAL_DEPENDENCY" : "FAIL", message));
}

interface GeminiCertFixture {
  userId: string;
  teamId: string;
  groupId: string;
  projectId: string;
  imageShotId: string;
  editShotId: string;
  videoShotId: string;
}

async function createGeminiCertFixture(): Promise<GeminiCertFixture> {
  const userId = randomUUID();
  const teamId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();
  const imageShotId = randomUUID();
  const editShotId = randomUUID();
  const videoShotId = randomUUID();
  const email = `gemini-cert-${userId}@example.test`;
  await db.insert(schema.users).values({
    id: userId, name: "gemini-cert", email, passwordHash: "x",
  });
  await db.insert(schema.teams).values({ id: teamId, name: "gemini-cert-team" });
  await db.insert(schema.groups).values({
    id: groupId, teamId, name: "gemini-cert-group",
    weeklyPointsPerUser: 0, budgetPoints: 0, approvalThresholdPoints: 0,
  });
  await db.insert(schema.groupMembers).values({ groupId, userId, role: "leader", budgetPoints: 0 });
  await db.insert(schema.projects).values({
    id: projectId, groupId, ownerId: userId, title: "Gemini cert fixture",
    kind: "qa", platform: "internal", format: "16:9",
  });
  await db.insert(schema.scenes).values([
    { id: imageShotId, projectId, orderIndex: 0, title: "Gemini image shot" },
    { id: editShotId, projectId, orderIndex: 1, title: "Gemini edit shot" },
    { id: videoShotId, projectId, orderIndex: 2, title: "Gemini omni shot" },
  ]);
  return { userId, teamId, groupId, projectId, imageShotId, editShotId, videoShotId };
}

async function destroyGeminiCertFixture(fixture: GeminiCertFixture): Promise<void> {
  await db.delete(schema.generations).where(eq(schema.generations.projectId, fixture.projectId));
  await db.delete(schema.scenes).where(eq(schema.scenes.projectId, fixture.projectId));
  await db.delete(schema.assets).where(eq(schema.assets.projectId, fixture.projectId));
  await db.delete(schema.projects).where(eq(schema.projects.id, fixture.projectId));
  await db.delete(schema.costLedger).where(and(eq(schema.costLedger.userId, fixture.userId), eq(schema.costLedger.groupId, fixture.groupId)));
  await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, fixture.groupId));
  await db.delete(schema.groups).where(eq(schema.groups.id, fixture.groupId));
  await db.delete(schema.teams).where(eq(schema.teams.id, fixture.teamId));
  await db.delete(schema.users).where(eq(schema.users.id, fixture.userId));
}

export function formatGeminiCertReport(report: GeminiCertReport): string {
  const lines = [
    `GEMINI_API_KEY configured=${report.configured ? "true" : "false"}`,
    ...report.items.map((row) => `${row.verdict} ${row.name} — ${row.detail}`),
    `SUMMARY pass=${report.summary.pass} blocked=${report.summary.blocked} fail=${report.summary.fail}`,
  ];
  return lines.join("\n");
}

export function geminiCertExitCode(report: GeminiCertReport): number {
  if (report.summary.fail > 0) return 1;
  if (report.summary.blocked > 0) return 2;
  return 0;
}

export interface StoredGeminiCert extends GeminiCertReport {
  at: string;
  source: "boot" | "admin" | "cli";
  /** Bump to force one more boot run after an operator top-up. */
  epoch?: number;
}

/** Increment when prepaid credits were topped up and boot must retry once. */
export const GEMINI_CERT_EPOCH = 3;

export type GeminiCertPublicStatus = "NONE" | "RUNNING" | "PASS" | "BLOCKED" | "FAIL";

export interface GeminiCertPublicSnapshot {
  status: GeminiCertPublicStatus;
  configured: boolean;
  at: string | null;
  source: StoredGeminiCert["source"] | null;
  summary: GeminiCertReport["summary"] | null;
  items: GeminiCertItem[];
}

let inFlight: Promise<StoredGeminiCert> | null = null;
let lastMemory: StoredGeminiCert | "running" | null = null;

export function resetGeminiCertMemoryForTests(): void {
  inFlight = null;
  lastMemory = null;
}

function evidencePath(): string {
  return path.join(STORAGE_ROOT, "qa", "gemini-cert-last.json");
}

function liveImagePassed(report: GeminiCertReport): boolean {
  return report.items.some((row) => row.name === "live-image" && row.verdict === "PASS");
}

export function loadLastGeminiCert(): StoredGeminiCert | null {
  if (lastMemory && lastMemory !== "running") return lastMemory;
  try {
    const raw = readFileSync(evidencePath(), "utf8");
    const parsed = JSON.parse(raw) as StoredGeminiCert;
    if (!parsed || !Array.isArray(parsed.items) || containsGeminiSecret(parsed)) return null;
    lastMemory = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLastGeminiCert(report: StoredGeminiCert): void {
  if (containsGeminiSecret(report)) {
    throw new Error("refusing to persist a certification report that still contains a secret");
  }
  const dir = path.dirname(evidencePath());
  mkdirSync(dir, { recursive: true });
  writeFileSync(evidencePath(), `${JSON.stringify(report, null, 2)}\n`);
  lastMemory = report;
}

export function publicGeminiCertSnapshot(): GeminiCertPublicSnapshot {
  if (lastMemory === "running" || inFlight) {
    const last = lastMemory !== "running" ? lastMemory : loadLastGeminiCert();
    return {
      status: "RUNNING",
      configured: geminiApiKeyConfigured(),
      at: last?.at ?? null,
      source: last?.source ?? null,
      summary: last?.summary ?? null,
      items: last?.items ?? [],
    };
  }
  const last = loadLastGeminiCert();
  if (!last) {
    return {
      status: "NONE",
      configured: geminiApiKeyConfigured(),
      at: null,
      source: null,
      summary: null,
      items: [],
    };
  }
  const status: GeminiCertPublicStatus =
    last.summary.fail > 0 ? "FAIL" : last.summary.blocked > 0 ? "BLOCKED" : "PASS";
  return {
    status,
    configured: last.configured,
    at: last.at,
    source: last.source,
    summary: last.summary,
    items: last.items,
  };
}

export function shouldAutoCert(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.GEMINI_LIVE_CERT_ON_BOOT === "0") return false;
  if (env.E2E_MOCK === "1" || isMockMode()) return false;
  if (!geminiApiKeyConfigured(env)) return false;
  const last = loadLastGeminiCert();
  if (last && last.summary.fail === 0 && liveImagePassed(last)) return false;
  if (
    last &&
    (last.epoch ?? 0) >= GEMINI_CERT_EPOCH &&
    last.items.some((row) => isExternalBillingBlock(row.detail))
  ) {
    return false;
  }
  return true;
}

export async function runAndStoreGeminiCertification(
  source: StoredGeminiCert["source"],
  opts: { live?: boolean; persistAttach?: boolean } = {},
): Promise<StoredGeminiCert> {
  if (inFlight) return inFlight;
  lastMemory = "running";
  inFlight = (async () => {
    const report = await runGeminiCertification(opts);
    const stored: StoredGeminiCert = {
      ...report,
      at: new Date().toISOString(),
      source,
      epoch: GEMINI_CERT_EPOCH,
    };
    saveLastGeminiCert(stored);
    return stored;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export function scheduleGeminiLiveCertification(): void {
  if (!shouldAutoCert()) {
    const snap = publicGeminiCertSnapshot();
    console.log(`[gemini-cert] skip auto status=${snap.status} configured=${snap.configured}`);
    return;
  }
  const timer = setTimeout(() => {
    console.log("[gemini-cert] starting Zeabur live certification (key stays in process.env)");
    void runAndStoreGeminiCertification("boot").then((report) => {
      console.log(`[gemini-cert] ${formatGeminiCertReport(report).split("\n").pop()}`);
    }).catch((err) => {
      console.warn("[gemini-cert] auto run failed：", redactGeminiSecrets(err instanceof Error ? err.message : String(err)));
    });
  }, 8_000);
  timer.unref?.();
}

