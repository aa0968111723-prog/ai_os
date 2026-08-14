/**
 * Scene Package（master plan §6）：一場戲的完整脈絡凍結，
 * 讓每個 Shot 不用從零重新理解整個場景。
 *
 * 真相仍在既有 records（story_scenes／scene_presets／characters／props／worldview）；
 * package 是 insert-only 的凍結投影＋指紋，同 shot packet 的模式：
 * 歷史 package 不可變，head 指標帶 stale 旗標。
 */

export const SCENE_PACKAGE_SCHEMA_VERSION = "scene-package.v1";

export interface ScenePackageEntityRef {
  kind: string;
  id: string;
  rev: number | null;
  name?: string;
}

export interface ScenePackagePayload {
  schemaVersion: typeof SCENE_PACKAGE_SCHEMA_VERSION;
  projectId: string;
  storySceneId: string;
  storySceneRev: number | null;
  /** 場景地點卡（scene_presets）＋（若已 pin）對應的 Scene Canon 版本 */
  location: ScenePackageEntityRef | null;
  sceneCanon: { canonId: string; versionId: string } | null;
  /** EnvironmentState（時間／天氣／氛圍）——Shot 生成時繼承 */
  environment: Record<string, unknown> | null;
  /** 這場戲會出現的角色／造型／道具（由場下所有 Shot 綁定聯集而來） */
  activeCharacters: ScenePackageEntityRef[];
  activeLooks: ScenePackageEntityRef[];
  props: Array<ScenePackageEntityRef & { ownerKind?: string | null; ownerId?: string | null }>;
  /** 專案風格與聲音世界（worldview styles／場景 ambience 預設） */
  style: string[];
  soundWorld: { ambience: string | null };
  /** 鏡頭語言彙總（這場戲各 Shot 的 camera 欄位聯集摘要；provider-independent） */
  cameraLanguage: string[];
  /** 敘事目標（storyScene summary／excerpt） */
  narrativeGoal: string | null;
  /** 入場連戲（上一場最後一鏡的 end-state）；null＝第一場或未知 */
  entryContinuity: Record<string, unknown> | null;
  /** 出場約束（本場最後一鏡結束時要成立的狀態；由腳本明確要求時填） */
  exitConstraints: string[];
}

function refKey(ref: ScenePackageEntityRef): string {
  return `${ref.kind}:${ref.id}@${ref.rev ?? "none"}`;
}

/** 指紋素材：集合欄位先排序，同內容永遠同字串（hash 在 server 端） */
export function canonicalScenePackageMaterial(payload: ScenePackagePayload): string {
  return JSON.stringify({
    schemaVersion: payload.schemaVersion,
    projectId: payload.projectId,
    storySceneId: payload.storySceneId,
    storySceneRev: payload.storySceneRev,
    location: payload.location ? refKey(payload.location) : null,
    sceneCanon: payload.sceneCanon,
    environment: payload.environment,
    activeCharacters: payload.activeCharacters.map(refKey).sort(),
    activeLooks: payload.activeLooks.map(refKey).sort(),
    props: payload.props
      .map((prop) => `${refKey(prop)}|${prop.ownerKind ?? ""}:${prop.ownerId ?? ""}`)
      .sort(),
    style: [...payload.style].sort(),
    soundWorld: payload.soundWorld,
    cameraLanguage: [...payload.cameraLanguage].sort(),
    narrativeGoal: payload.narrativeGoal,
    entryContinuity: payload.entryContinuity,
    exitConstraints: [...payload.exitConstraints].sort(),
  });
}

/** package 的依賴鍵（供 targeted stale：某卡改了，只有引用它的場景 package 過期） */
export function scenePackageDependencies(payload: ScenePackagePayload): {
  storySceneId: string;
  entityKeys: string[];
} {
  const refs = [
    ...(payload.location ? [payload.location] : []),
    ...payload.activeCharacters,
    ...payload.activeLooks,
    ...payload.props,
  ];
  return {
    storySceneId: payload.storySceneId,
    entityKeys: [...new Set(refs.map((ref) => `${ref.kind}:${ref.id}`))].sort(),
  };
}
