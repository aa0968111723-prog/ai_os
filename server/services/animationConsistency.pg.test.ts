import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { extractEndFrame } from "./derivedFrames";
import { saveBuffer } from "./storage";
import { evaluateGenerationConsistency } from "./animationEvaluator";
import { animationProductionBoard } from "./animationBoard";
import { storeGenerationSourceMeta } from "../../shared/generationSourceMeta";
import type { ShotContextPacketPayload } from "../../shared/shotContextPacket";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const execFileAsync = promisify(execFile);

describe.skipIf(!RUN_PG).sequential("Animation temporal/visual consistency (real PostgreSQL)", () => {
  const groupId = randomUUID();
  const teamId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const auth: AuthState = {
    user: { id: userId, name: "動畫組長", email: "animation-pg@example.test", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "動畫組", teamId, teamName: "總會小編團隊", role: "leader" }],
    adminTeamIds: [],
  };
  let currentImageId = "";
  let evaluationShotId = "";
  let evaluationGenerationId = "";
  let packetId = "";

  afterAll(async () => {
    await db.delete(schema.generationConsistencyEvaluations).where(eq(schema.generationConsistencyEvaluations.projectId, projectId));
    await db.delete(schema.assetRevisions).where(eq(schema.assetRevisions.projectId, projectId));
    await db.delete(schema.shotContinuityStates).where(eq(schema.shotContinuityStates.projectId, projectId));
    await db.delete(schema.shotContextPacketHeads).where(eq(schema.shotContextPacketHeads.projectId, projectId));
    await db.delete(schema.shotContextPackets).where(eq(schema.shotContextPackets.projectId, projectId));
    await db.delete(schema.generations).where(eq(schema.generations.projectId, projectId));
    await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
    await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  });

  it("seeds one project and 300 shots", async () => {
    await db.insert(schema.projects).values({
      id: projectId,
      groupId,
      ownerId: userId,
      title: "300 鏡動畫壓力專案",
      kind: "animation",
      platform: "test",
      format: "16:9",
      worldview: { styles: ["手繪"], taboos: [] },
    });
    await db.insert(schema.groupMembers).values({ groupId, userId, role: "leader" });
    const [image] = await db.insert(schema.assets).values({
      projectId,
      groupId,
      kind: "image",
      title: "已採用關鍵影格",
      url: "https://example.test/current.png",
      isAiGenerated: true,
    }).returning({ id: schema.assets.id });
    currentImageId = image.id;
    const rows: Array<typeof schema.scenes.$inferInsert> = Array.from({ length: 300 }, (_, index) => ({
      projectId,
      title: `鏡 ${index + 1}`,
      orderIndex: index,
      durationSec: 4,
      prompt: `角色往右走 ${index + 1}`,
      assetId: currentImageId,
      reviewStatus: "approved",
    }));
    await db.insert(schema.scenes).values(rows);
    const [first] = await db.select({ id: schema.scenes.id }).from(schema.scenes)
      .where(eq(schema.scenes.projectId, projectId));
    evaluationShotId = first.id;
  });

  it("20/100/300-shot board query count stays bounded", async () => {
    for (const size of [20, 100, 300]) {
      const ids = (await db.select({ id: schema.scenes.id }).from(schema.scenes)
        .where(eq(schema.scenes.projectId, projectId)))
        .slice(size)
        .map((row) => row.id);
      // Temporarily soft-delete outside the fixture window; board uses the real deletedAt filter.
      if (ids.length) await db.update(schema.scenes).set({ deletedAt: new Date() }).where(inArray(schema.scenes.id, ids));
      const labels: string[] = [];
      const started = performance.now();
      const board = await animationProductionBoard({
        auth,
        projectId,
        onQuery: (label) => labels.push(label),
      });
      const durationMs = Math.round(performance.now() - started);
      expect(board.rows).toHaveLength(size);
      expect(new Set(labels).size).toBeLessThanOrEqual(6);
      expect(labels).toEqual(expect.arrayContaining([
        "shots", "current_assets", "latest_generations",
        "latest_evaluations", "packet_heads",
      ]));
      console.log(`[animation-board] shots=${size} queries=${labels.length} durationMs=${durationMs}`);
      if (ids.length) await db.update(schema.scenes).set({ deletedAt: null }).where(inArray(schema.scenes.id, ids));
    }
  });

  it("structural evaluation is immutable/idempotent and stays visually not-checked", async () => {
    const packet: ShotContextPacketPayload = {
      schemaVersion: "shot-context-packet.v1",
      projectId,
      storyId: null,
      storyRev: null,
      storySceneId: null,
      storySceneRev: null,
      shotId: evaluationShotId,
      shotRev: 1,
      characters: [],
      looks: [],
      presets: [],
      props: [],
      assets: [],
      knowledge: [],
      dataRows: [],
      environment: null,
      visual: {
        title: "鏡 1", prompt: "角色往右走", action: "walk",
        camera: null, performance: null, durationSec: 4,
        dialogue: null, voiceover: null, ambience: null, music: null,
      },
      continuity: { previousShotId: null, nextShotId: null },
      locks: [],
      negativeConstraints: [],
      worldStyle: ["手繪"],
      provider: { modelId: "fal-ai/fast-lightning-sdxl", policyVersion: "v1" },
      why: [],
    };
    const [packetRow] = await db.insert(schema.shotContextPackets).values({
      projectId,
      groupId,
      shotId: evaluationShotId,
      schemaVersion: packet.schemaVersion,
      fingerprint: "packet-fingerprint",
      packet,
      createdBy: userId,
    }).returning({ id: schema.shotContextPackets.id });
    packetId = packetRow.id;
    const generationId = randomUUID();
    evaluationGenerationId = generationId;
    await db.insert(schema.generations).values({
      id: generationId,
      projectId,
      groupId,
      userId,
      modelId: "fal-ai/fast-lightning-sdxl",
      kind: "image",
      status: "done",
      prompt: "角色往右走",
      resultUrl: "https://example.test/candidate.png",
      sceneId: evaluationShotId,
      params: storeGenerationSourceMeta({}, { shotContextPacketId: packetId }),
    });
    await db.insert(schema.assets).values({
      projectId,
      groupId,
      kind: "image",
      title: "候選影格",
      url: "https://example.test/candidate.png",
      isAiGenerated: true,
      meta: { generationId },
    });
    const first = await evaluateGenerationConsistency({
      auth,
      generationId,
      runVisualCheck: false,
    });
    const second = await evaluateGenerationConsistency({
      auth,
      generationId,
      runVisualCheck: false,
    });
    expect(first.evaluation.visualCheckStatus).toBe("not_checked");
    expect(first.providerAvailable).toBe(false);
    expect(second.reused).toBe(true);
    const rows = await db.select().from(schema.generationConsistencyEvaluations)
      .where(eq(schema.generationConsistencyEvaluations.generationId, generationId));
    expect(rows).toHaveLength(1);
  });

  it("real ffmpeg extraction writes one idempotent derived frame with parent lineage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aios-pg-video-"));
    const videoPath = join(dir, "source.mp4");
    try {
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=0.4",
        "-pix_fmt", "yuv420p", videoPath,
      ], { timeout: 30_000 });
      const stored = await saveBuffer(await readFile(videoPath), "video/mp4");
      const [video] = await db.insert(schema.assets).values({
        projectId,
        groupId,
        kind: "video",
        title: "真實測試短片",
        url: "pending",
        storagePath: stored.storagePath,
        mime: "video/mp4",
        sizeBytes: stored.sizeBytes,
        uploadedBy: userId,
      }).returning({ id: schema.assets.id });
      const first = await extractEndFrame({ auth, videoAssetId: video.id });
      const second = await extractEndFrame({ auth, videoAssetId: video.id });
      expect(first.assetId).toBe(second.assetId);
      expect(second.reused).toBe(true);
      const [revision] = await db.select().from(schema.assetRevisions)
        .where(eq(schema.assetRevisions.assetId, first.assetId));
      expect(revision.sourceAssetId).toBe(video.id);
      const [frame] = await db.select().from(schema.assets).where(eq(schema.assets.id, first.assetId));
      expect(frame.kind).toBe("image");
      expect((frame.meta as { derivedFrame?: { kind?: string } }).derivedFrame?.kind).toBe("end_frame");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

