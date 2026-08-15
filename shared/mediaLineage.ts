/**
 * Full media lineage 的純推導層（closure master plan §7–§8）。
 *
 * 核心原則：downstream artifact 的 stale 是「推導出來的比較結果」，不是另存的旗標——
 * 生成當下的依賴（meta.voice／meta.soundWorld／asset_revisions parent）對比
 * 「此刻的 current／pinned 版本」，不一致＝stale。沒有第二套真相可以漂移。
 *
 * current 舊成果永遠保留；stale 只是修復訊號，新結果照走 Candidate → explicit Adopt。
 */

export type ArtifactTrack = "visual" | "narration" | "ambience" | "music";

export interface ArtifactFinding {
  shotId: string;
  track: ArtifactTrack;
  code:
    | "video_parent_superseded"
    | "voice_version_drift"
    | "voice_identity_missing"
    | "sound_world_drift";
  message: string;
  /** 受影響的 current 資產（修復＝重生成→Candidate→Adopt，不動舊 current） */
  assetId: string;
}

/** 單鏡的 current 視覺軌：影片 parent 是否已被新採用的畫面取代（§8 的 i2v 例） */
export function deriveVisualFinding(input: {
  shotId: string;
  currentAsset: { id: string; kind: string } | null;
  /** current 影片的 parent 畫面（asset_revisions child→parent；null＝無血緣紀錄） */
  videoParentAssetId: string | null;
  /** 最後一次明確 Adopt 落下的素材（shot_continuity_states.sourceAssetId；null＝沒 Adopt 過） */
  lastAdoptedAssetId: string | null;
}): ArtifactFinding | null {
  if (!input.currentAsset || input.currentAsset.kind !== "video") return null;
  if (!input.videoParentAssetId || !input.lastAdoptedAssetId) return null; // 血緣不明＝不猜
  if (input.lastAdoptedAssetId === input.currentAsset.id) return null;     // Adopt 的就是這支影片
  if (input.videoParentAssetId === input.lastAdoptedAssetId) return null;  // parent 仍是現採畫面
  return {
    shotId: input.shotId,
    track: "visual",
    code: "video_parent_superseded",
    message: "這支影片是用舊畫面生成的——畫面已改採新版本，影片需要重新生成",
    assetId: input.currentAsset.id,
  };
}

/** 旁白軌：生成當下用的聲線版本 vs 此刻該用的聲線版本 */
export function deriveNarrationFinding(input: {
  shotId: string;
  narrationAssetId: string | null;
  /** 生成當下 meta.voice（null＝沒綁聲線就生成，或素材非生成而來） */
  usedVoice: { canonId: string; versionId: string } | null;
  /** 此刻路由出的聲線（同一個 routeSpeechVoice 真相；null＝專案沒綁聲線） */
  expectedVoice: { canonId: string; versionId: string } | null;
}): ArtifactFinding | null {
  if (!input.narrationAssetId) return null;
  if (!input.expectedVoice) return null; // 專案沒綁聲線＝沒有 drift 可言
  if (!input.usedVoice) {
    return {
      shotId: input.shotId,
      track: "narration",
      code: "voice_identity_missing",
      message: "這段旁白生成時還沒綁定聲線——現在已有固定聲線，建議重新生成",
      assetId: input.narrationAssetId,
    };
  }
  if (input.usedVoice.canonId === input.expectedVoice.canonId
    && input.usedVoice.versionId === input.expectedVoice.versionId) return null;
  return {
    shotId: input.shotId,
    track: "narration",
    code: "voice_version_drift",
    message: "聲線已更新——這段旁白仍是舊聲線版本，需要重新生成才一致",
    assetId: input.narrationAssetId,
  };
}

/** 環境音軌：生成當下的 sound world 版本 vs 此刻 pinned 版本 */
export function deriveAmbienceFinding(input: {
  shotId: string;
  ambienceAssetId: string | null;
  usedSoundWorld: { canonId: string; versionId: string } | null;
  expectedSoundWorld: { canonId: string; versionId: string } | null;
}): ArtifactFinding | null {
  if (!input.ambienceAssetId) return null;
  if (!input.expectedSoundWorld) return null;
  if (!input.usedSoundWorld) return null; // canon pin 之前生成的舊環境音：不強迫（音軌無「缺聲音世界」硬約束）
  if (input.usedSoundWorld.canonId === input.expectedSoundWorld.canonId
    && input.usedSoundWorld.versionId === input.expectedSoundWorld.versionId) return null;
  return {
    shotId: input.shotId,
    track: "ambience",
    code: "sound_world_drift",
    message: "聲音世界已更新——這段環境音仍是舊版本，需要重新生成才一致",
    assetId: input.ambienceAssetId,
  };
}

/** 一鏡的完整血緣鏈節點（server 端 IO 組好後回給 UI／測試的 shape） */
export interface ShotLineage {
  shotId: string;
  packet: { packetId: string; fingerprint: string; stale: boolean; staleReason: string | null } | null;
  scenePackage: { packageId: string; fingerprint: string } | null;
  tracks: Array<{
    track: ArtifactTrack;
    assetId: string | null;
    generationId: string | null;
    modelId: string | null;
    /** i2v／i2i parent（asset_revisions） */
    parentAssetId: string | null;
    /** 生成當下依賴的 canon 版本（voice／sound world；visual 走 packet） */
    canonDeps: Array<{ canonId: string; versionId: string }>;
  }>;
  findings: ArtifactFinding[];
}
