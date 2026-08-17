/**
 * Full media lineage — server IO 層（closure master plan §7–§8）。
 *
 * 只讀既有 records（scenes 指標／assets.meta.generationId／generations meta／
 * asset_revisions／shot_continuity_states／packet heads／canon pins）組出
 * lineage 與 derived staleness，不建任何新表——不存在第二套 lineage 真相。
 *
 * 批次紀律（#755 邊界）：整個專案掃描固定 6 個批次查詢，無 per-shot N+1。
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { splitGenerationSourceMeta } from "../../shared/generationSourceMeta";
import { sceneSpeechLines } from "../../shared/sceneSpeech";
import { routeSpeechVoice, type VoiceIdentity } from "../../shared/voiceRouting";
import {
  deriveAmbienceFinding,
  deriveNarrationFinding,
  deriveVisualFinding,
  type ArtifactFinding,
  type ShotLineage,
} from "../../shared/mediaLineage";
import { loadCreativeContextProject } from "./storyEntityBinding";
import { resolveProjectCanonDefaults } from "./teamCanon";

interface ShotRowLite {
  id: string;
  assetId: string | null;
  narrationAssetId: string | null;
  ambienceAssetId: string | null;
  musicAssetId: string | null;
  voiceover: string | null;
  dialogue: string | null;
}

/** 整個專案的 artifact findings＋（可選）逐鏡 lineage。一次掃描，六個批次查詢。 */
export async function projectMediaLineage(input: {
  auth: AuthState;
  projectId: string;
  /** 只回這些 shot 的完整 lineage（findings 仍是全專案）；不帶＝只回 findings */
  lineageShotIds?: string[];
}): Promise<{ findings: ArtifactFinding[]; lineages: ShotLineage[]; lineageGapShotIds: string[] }> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);

  // 批次 1：全部分鏡（指標＋語音文字）
  const shots: ShotRowLite[] = await db.select({
    id: schema.scenes.id,
    assetId: schema.scenes.assetId,
    narrationAssetId: schema.scenes.narrationAssetId,
    ambienceAssetId: schema.scenes.ambienceAssetId,
    musicAssetId: schema.scenes.musicAssetId,
    voiceover: schema.scenes.voiceover,
    dialogue: schema.scenes.dialogue,
  }).from(schema.scenes).where(and(
    eq(schema.scenes.projectId, project.id),
    isNull(schema.scenes.deletedAt),
  ));

  const assetIds = [...new Set(shots.flatMap((shot) =>
    [shot.assetId, shot.narrationAssetId, shot.ambienceAssetId, shot.musicAssetId].filter((id): id is string => Boolean(id)),
  ))];

  // 批次 2：指標素材（kind＋meta.generationId）
  const assets = assetIds.length
    ? await db.select({ id: schema.assets.id, kind: schema.assets.kind, meta: schema.assets.meta })
      .from(schema.assets).where(inArray(schema.assets.id, assetIds))
    : [];
  const assetById = new Map(assets.map((row) => [row.id, row]));
  const generationIds = [...new Set(assets
    .map((row) => (row.meta as Record<string, unknown> | null)?.generationId)
    .filter((id): id is string => typeof id === "string"))];

  // 批次 3：這些素材的生成列（meta 依賴）
  const generations = generationIds.length
    ? await db.select({ id: schema.generations.id, modelId: schema.generations.modelId, params: schema.generations.params })
      .from(schema.generations).where(inArray(schema.generations.id, generationIds))
    : [];
  const generationById = new Map(generations.map((row) => [row.id, row]));

  // 批次 4：影片 parent（asset_revisions child→parent）
  const revisions = assetIds.length
    ? await db.select({ assetId: schema.assetRevisions.assetId, sourceAssetId: schema.assetRevisions.sourceAssetId })
      .from(schema.assetRevisions).where(inArray(schema.assetRevisions.assetId, assetIds))
    : [];
  const parentByAsset = new Map(revisions.map((row) => [row.assetId, row.sourceAssetId]));

  // 批次 5：最後 Adopt 狀態（video_parent_superseded 的比較基準）
  const states = await db.select({
    shotId: schema.shotContinuityStates.shotId,
    sourceAssetId: schema.shotContinuityStates.sourceAssetId,
  }).from(schema.shotContinuityStates).where(eq(schema.shotContinuityStates.projectId, project.id));
  const adoptedByShot = new Map(states.map((row) => [row.shotId, row.sourceAssetId]));

  // 批次 6：packet heads（lineage 展示用）＋canon 現況（voice 路由＝與生成同一份真相）
  const heads = await db.select().from(schema.shotContextPacketHeads)
    .where(eq(schema.shotContextPacketHeads.projectId, project.id)).catch(() => []);
  const headByShot = new Map(heads.map((row) => [row.shotId, row]));
  const canonDefaults = await resolveProjectCanonDefaults(project.id);
  const characters = canonDefaults.characterVoices.size
    ? await db.select({ id: schema.characters.id, name: schema.characters.name })
      .from(schema.characters).where(eq(schema.characters.projectId, project.id))
    : [];
  const voiceByName = new Map<string, VoiceIdentity>();
  for (const row of characters) {
    const voice = canonDefaults.characterVoices.get(row.id);
    if (voice) voiceByName.set(row.name, voice);
  }

  const findings: ArtifactFinding[] = [];
  const lineages: ShotLineage[] = [];
  const lineageGapShotIds: string[] = [];
  const wantLineage = new Set(input.lineageShotIds ?? []);

  for (const shot of shots) {
    const metaOf = (assetId: string | null) => {
      if (!assetId) return { generationId: null as string | null, modelId: null as string | null, meta: null as ReturnType<typeof splitGenerationSourceMeta>["meta"] | null };
      const asset = assetById.get(assetId);
      const generationId = (asset?.meta as Record<string, unknown> | null)?.generationId;
      const generation = typeof generationId === "string" ? generationById.get(generationId) : undefined;
      return {
        generationId: generation?.id ?? null,
        modelId: generation?.modelId ?? null,
        meta: generation ? splitGenerationSourceMeta(generation.params).meta : null,
      };
    };

    const visualAsset = shot.assetId ? assetById.get(shot.assetId) ?? null : null;
    const narration = metaOf(shot.narrationAssetId);
    const ambience = metaOf(shot.ambienceAssetId);

    // 此刻該用的聲線＝與 generateVoiceover 同一個路由真相（speaker → canon pin）
    const speech = sceneSpeechLines({ voiceover: shot.voiceover, dialogue: shot.dialogue });
    const speakerNames = [...new Set(speech.filter((line) => line.speaker && line.speaker !== "旁白").map((line) => line.speaker))];
    const expectedVoice = routeSpeechVoice({
      speakers: speakerNames,
      characterVoiceByName: voiceByName,
      narrationVoice: canonDefaults.narrationVoice,
    }).voice;

    const visualFinding = deriveVisualFinding({
      shotId: shot.id,
      currentAsset: visualAsset ? { id: visualAsset.id, kind: visualAsset.kind } : null,
      videoParentAssetId: visualAsset ? parentByAsset.get(visualAsset.id) ?? null : null,
      lastAdoptedAssetId: adoptedByShot.get(shot.id) ?? null,
    });
    const narrationFinding = deriveNarrationFinding({
      shotId: shot.id,
      narrationAssetId: shot.narrationAssetId,
      // applied=false＝當時模型不支援指定聲線（實際是預設聲音）——視同未綁聲線（誠實）
      usedVoice: narration.meta?.voice?.applied
        ? { canonId: narration.meta.voice.canonId, versionId: narration.meta.voice.versionId }
        : null,
      expectedVoice: expectedVoice ? { canonId: expectedVoice.canonId, versionId: expectedVoice.versionId } : null,
    });
    const ambienceFinding = deriveAmbienceFinding({
      shotId: shot.id,
      ambienceAssetId: shot.ambienceAssetId,
      usedSoundWorld: ambience.meta?.soundWorld ?? null,
      expectedSoundWorld: canonDefaults.soundWorld
        ? { canonId: canonDefaults.soundWorld.canonId, versionId: canonDefaults.soundWorld.versionId }
        : null,
    });
    for (const finding of [visualFinding, narrationFinding, ambienceFinding]) {
      if (finding) findings.push(finding);
    }
    // §7 lineage gap：現用影片「本來該有」parent 卻查不到血緣列——
    // 只有生成時真的帶了來源（i2v）才算 gap；t2v 本來就沒有 parent，不是缺陷（稽核修正）
    if (visualAsset?.kind === "video" && !parentByAsset.has(visualAsset.id)) {
      const visualMeta = metaOf(shot.assetId).meta;
      if (visualMeta?.sourceAssetId) lineageGapShotIds.push(shot.id);
    }

    if (wantLineage.has(shot.id)) {
      const head = headByShot.get(shot.id);
      const visual = metaOf(shot.assetId);
      const music = metaOf(shot.musicAssetId);
      lineages.push({
        shotId: shot.id,
        packet: head
          ? { packetId: head.packetId, fingerprint: head.fingerprint, stale: head.stale, staleReason: head.staleReason }
          : null,
        scenePackage: null, // packet payload 內已有 scenePackage 參照；此欄由呼叫端要 packet 時自取
        tracks: [
          {
            track: "visual",
            assetId: shot.assetId,
            generationId: visual.generationId,
            modelId: visual.modelId,
            parentAssetId: shot.assetId ? parentByAsset.get(shot.assetId) ?? null : null,
            canonDeps: [],
          },
          {
            track: "narration",
            assetId: shot.narrationAssetId,
            generationId: narration.generationId,
            modelId: narration.modelId,
            parentAssetId: null,
            canonDeps: narration.meta?.voice ? [{ canonId: narration.meta.voice.canonId, versionId: narration.meta.voice.versionId }] : [],
          },
          {
            track: "ambience",
            assetId: shot.ambienceAssetId,
            generationId: ambience.generationId,
            modelId: ambience.modelId,
            parentAssetId: null,
            canonDeps: ambience.meta?.soundWorld ? [ambience.meta.soundWorld] : [],
          },
          {
            track: "music",
            assetId: shot.musicAssetId,
            generationId: music.generationId,
            modelId: music.modelId,
            parentAssetId: null,
            canonDeps: music.meta?.soundWorld ? [music.meta.soundWorld] : [],
          },
        ],
        findings: [visualFinding, narrationFinding, ambienceFinding].filter((row): row is ArtifactFinding => Boolean(row)),
      });
    }
  }

  return { findings, lineages, lineageGapShotIds };
}
