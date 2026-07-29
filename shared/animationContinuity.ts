/**
 * ANIM-02 角色／風格聖經版本化（純函式 foundation）。
 *
 * 鎖定 reference lineage、過期偵測、生成時 continuity 快照；
 * **無 DB migration、無 router／UI**。版本表落地為後續 PR。
 *
 * 對應：
 * - docs/architecture/ai-animation-production-remediation-plan.md §3.3–3.4、ANIM-02
 * - docs/architecture/anim-02-continuity.md
 * - docs/architecture/anim-01-adapter.md（Shot.characterRefs）
 */

// ─── 正式領域型別（對齊 remediation plan §3.3／§3.4） ─────────────────────

/** 鏡頭上綁定的角色與參考版本（生成前即可驗證） */
export interface ShotCharacterRef {
  characterId: string;
  characterBibleVersionId: string;
}

/**
 * 角色聖經版本：角色外觀／服裝等定裝的不可變快照。
 * 每次改裝應升 version；生成記錄綁定當時 version id，避免事後改卡無法重現。
 */
export interface CharacterBibleVersion {
  id: string;
  characterId: string;
  version: number;
  appearance: Record<string, unknown>;
  costume: Record<string, unknown>;
  personality?: string;
  voiceProfileId?: string;
  referenceAssetIds: string[];
  /** ISO 時間字串；未核准則省略 */
  approvedAt?: string;
  /**
   * draft＝由現況角色卡投影、尚未有版本表；
   * approved／superseded 留給後續 lifecycle。
   */
  status?: "draft" | "approved" | "superseded";
}

/**
 * 風格聖經版本：整片視覺語言／色板／光線規則快照。
 * productionId 在無獨立 Production 表時可等於 projectId（ANIM-01 1:1 策略）。
 */
export interface StyleBibleVersion {
  id: string;
  productionId: string;
  version: number;
  visualLanguage: Record<string, unknown>;
  colorScript?: Record<string, unknown>;
  lightingRules?: string[];
  cameraRules?: string[];
  negativeRules?: string[];
  referenceAssetIds: string[];
  status?: "draft" | "approved" | "superseded";
}

// ─── 生成時 continuity 快照（寫入 AssetVersion／generation 用） ───────────

/**
 * 一次生成實際鎖定的 bible 版本集合。
 * characterBibleVersionIds 為穩定排序後的去重 id 列表（與 plan §3.5 對齊）。
 */
export interface GenerationContinuitySnapshot {
  characterRefs: ShotCharacterRef[];
  characterBibleVersionIds: string[];
  styleBibleVersionId?: string;
}

// ─── 過期／可解析結果 ───────────────────────────────────────────────────

export type StaleContinuityKind = "character" | "style";

/** 單一過期引用：鏡頭鎖定版本 ≠ 目前最新版本 */
export interface StaleContinuityRef {
  kind: StaleContinuityKind;
  /** kind=character 時有值 */
  characterId?: string;
  lockedVersionId: string;
  currentVersionId: string;
}

export type CharacterRefResolveErrorCode =
  | "version_not_found"
  | "character_mismatch"
  | "duplicate_character";

export interface CharacterRefResolveError {
  code: CharacterRefResolveErrorCode;
  characterId: string;
  characterBibleVersionId: string;
  message: string;
}

export type CharacterRefsResolvableResult =
  | { ok: true }
  | { ok: false; errors: CharacterRefResolveError[] };

// ─── 來源列（現況 characters 表最小投影；不綁 drizzle） ─────────────────

/**
 * 角色定裝卡最小投影（對齊 `characters` 表：name／appearance／notes／referenceAssetId）。
 */
export interface CharacterRowLike {
  id: string;
  name: string;
  /** 外觀錨點文字（臉／髮／服裝等；現行注入生成用） */
  appearance: string;
  /** 個性・語氣；可進 personality，不注入視覺 */
  notes?: string | null;
  referenceAssetId?: string | null;
  /** 可選：專案 id，僅供 adapter 上下文，不寫入 bible */
  projectId?: string | null;
}

/**
 * 風格草案來源（世界觀 styles／tones 或 scene preset 粗投影；可選）。
 * 正式 StyleBible 表落地前用此組 draft。
 */
export interface StyleDraftSourceLike {
  productionId: string;
  /** 視覺風格 chips（如 worldview.styles） */
  styles?: readonly string[] | null;
  /** 調性 chips */
  tones?: readonly string[] | null;
  /** 禁忌／負向規則 */
  taboos?: readonly string[] | null;
  /** 色板文字（scene preset palette） */
  palette?: string | null;
  /** 光線文字 */
  lighting?: string | null;
  referenceAssetIds?: readonly string[] | null;
}

// ─── 確定性 draft version id ────────────────────────────────────────────

/** 角色 draft bible version id：`{characterId}:bible:v{version}` */
export function draftCharacterBibleVersionId(
  characterId: string,
  version: number = 1,
): string {
  const v = Number.isFinite(version) && version > 0 ? Math.floor(version) : 1;
  return `${characterId}:bible:v${v}`;
}

/** 風格 draft bible version id：`{productionId}:style-bible:v{version}` */
export function draftStyleBibleVersionId(
  productionId: string,
  version: number = 1,
): string {
  const v = Number.isFinite(version) && version > 0 ? Math.floor(version) : 1;
  return `${productionId}:style-bible:v${v}`;
}

// ─── Adapter：現況 Character → draft CharacterBibleVersion ───────────────

export type CharacterToDraftBibleOptions = {
  /** 覆寫 version 序號；預設 1 */
  version?: number;
  /** 覆寫 id；預設 draftCharacterBibleVersionId(character.id, version) */
  versionId?: string;
  /** 標為已核准的時間（ISO）；預設不設＝draft */
  approvedAt?: string;
};

/**
 * 將現況角色卡投影為 **draft** CharacterBibleVersion（無 DB 寫入）。
 * - appearance 字串 → appearance.summary + appearance.name
 * - notes → personality
 * - referenceAssetId → referenceAssetIds（0 或 1 筆）
 * - costume 預設 {}（結構尚未拆欄）
 */
export function characterToDraftBibleVersion(
  character: CharacterRowLike,
  opts: CharacterToDraftBibleOptions = {},
): CharacterBibleVersion {
  const version =
    opts.version != null && Number.isFinite(opts.version) && opts.version > 0
      ? Math.floor(opts.version)
      : 1;
  const id = opts.versionId ?? draftCharacterBibleVersionId(character.id, version);
  const referenceAssetIds =
    character.referenceAssetId != null && character.referenceAssetId !== ""
      ? [character.referenceAssetId]
      : [];

  const bible: CharacterBibleVersion = {
    id,
    characterId: character.id,
    version,
    appearance: {
      name: character.name,
      summary: character.appearance,
    },
    costume: {},
    referenceAssetIds,
    status: opts.approvedAt ? "approved" : "draft",
  };

  if (character.notes != null && character.notes !== "") {
    bible.personality = character.notes;
  }
  if (opts.approvedAt != null && opts.approvedAt !== "") {
    bible.approvedAt = opts.approvedAt;
  }

  return bible;
}

/** 批次：角色卡列表 → draft bible 版本列表（順序保留） */
export function charactersToDraftBibleVersions(
  characters: readonly CharacterRowLike[],
  opts: CharacterToDraftBibleOptions = {},
): CharacterBibleVersion[] {
  return characters.map((c) => characterToDraftBibleVersion(c, opts));
}

/**
 * 由 draft 來源組 **draft** StyleBibleVersion。
 * visualLanguage 收 styles／tones；negativeRules 收 taboos；colorScript／lighting 有則寫入。
 */
export function styleDraftToBibleVersion(
  source: StyleDraftSourceLike,
  opts: { version?: number; versionId?: string } = {},
): StyleBibleVersion {
  const version =
    opts.version != null && Number.isFinite(opts.version) && opts.version > 0
      ? Math.floor(opts.version)
      : 1;
  const id = opts.versionId ?? draftStyleBibleVersionId(source.productionId, version);

  const visualLanguage: Record<string, unknown> = {};
  if (source.styles != null && source.styles.length > 0) {
    visualLanguage.styles = [...source.styles];
  }
  if (source.tones != null && source.tones.length > 0) {
    visualLanguage.tones = [...source.tones];
  }

  const bible: StyleBibleVersion = {
    id,
    productionId: source.productionId,
    version,
    visualLanguage,
    referenceAssetIds: source.referenceAssetIds ? [...source.referenceAssetIds] : [],
    status: "draft",
  };

  if (source.palette != null && source.palette !== "") {
    bible.colorScript = { palette: source.palette };
  }
  if (source.lighting != null && source.lighting !== "") {
    bible.lightingRules = [source.lighting];
  }
  if (source.taboos != null && source.taboos.length > 0) {
    bible.negativeRules = [...source.taboos];
  }

  return bible;
}

// ─── 現用版本索引（characterId → 最新 bible version id） ─────────────────

export type CharacterCurrentVersionMap =
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string>>;

function lookupCurrent(
  map: CharacterCurrentVersionMap,
  characterId: string,
): string | undefined {
  if (typeof (map as ReadonlyMap<string, string>).get === "function") {
    return (map as ReadonlyMap<string, string>).get(characterId);
  }
  return (map as Readonly<Record<string, string>>)[characterId];
}

/** 由 bible 版本列表建「每角色最高 version 的 id」索引（同 version 取後者） */
export function buildCharacterCurrentVersionMap(
  versions: ReadonlyArray<Pick<CharacterBibleVersion, "id" | "characterId" | "version">>,
): Map<string, string> {
  const best = new Map<string, { version: number; id: string }>();
  for (const v of versions) {
    const prev = best.get(v.characterId);
    if (!prev || v.version >= prev.version) {
      best.set(v.characterId, { version: v.version, id: v.id });
    }
  }
  const out = new Map<string, string>();
  for (const [characterId, row] of best) {
    out.set(characterId, row.id);
  }
  return out;
}

// ─── 過期偵測 ───────────────────────────────────────────────────────────

export type ShotContinuityRefs = {
  characterRefs: readonly ShotCharacterRef[];
  styleBibleVersionId?: string | null;
};

export type CurrentContinuityVersionIds = {
  /** characterId → 目前最新 characterBibleVersionId */
  characters: CharacterCurrentVersionMap;
  /** 目前最新 style bible version id；未提供則不檢查 style */
  styleBibleVersionId?: string | null;
};

/**
 * 比對鏡頭鎖定的 bible 版本與「目前最新」：回傳過期引用列表（空＝未過期）。
 * - 角色：有 current 且 ≠ locked → stale
 * - 角色：無 current 條目 → 不標 stale（可能已刪卡；另用 assertCharacterRefsResolvable）
 * - 風格：shot 與 current 皆有值且不同 → stale
 */
export function isBibleVersionStale(
  shotRefs: ShotContinuityRefs,
  currentVersionIds: CurrentContinuityVersionIds,
): StaleContinuityRef[] {
  const stale: StaleContinuityRef[] = [];

  for (const ref of shotRefs.characterRefs) {
    const current = lookupCurrent(currentVersionIds.characters, ref.characterId);
    if (current == null || current === "") continue;
    if (current !== ref.characterBibleVersionId) {
      stale.push({
        kind: "character",
        characterId: ref.characterId,
        lockedVersionId: ref.characterBibleVersionId,
        currentVersionId: current,
      });
    }
  }

  const lockedStyle = shotRefs.styleBibleVersionId;
  const currentStyle = currentVersionIds.styleBibleVersionId;
  if (
    lockedStyle != null &&
    lockedStyle !== "" &&
    currentStyle != null &&
    currentStyle !== "" &&
    lockedStyle !== currentStyle
  ) {
    stale.push({
      kind: "style",
      lockedVersionId: lockedStyle,
      currentVersionId: currentStyle,
    });
  }

  return stale;
}

/** 是否有任何過期引用 */
export function hasStaleContinuity(
  shotRefs: ShotContinuityRefs,
  currentVersionIds: CurrentContinuityVersionIds,
): boolean {
  return isBibleVersionStale(shotRefs, currentVersionIds).length > 0;
}

// ─── 引用可解析性（生成前驗證） ─────────────────────────────────────────

/**
 * 驗證 characterRefs 皆可對應到 availableVersions，且 characterId 一致、同鏡不重複角色。
 * 純函式：不 throw；回傳 { ok } 或 { ok:false, errors }。
 */
export function assertCharacterRefsResolvable(
  refs: readonly ShotCharacterRef[],
  availableVersions: ReadonlyArray<
    Pick<CharacterBibleVersion, "id" | "characterId">
  >,
): CharacterRefsResolvableResult {
  const byId = new Map(availableVersions.map((v) => [v.id, v]));
  const seenCharacters = new Set<string>();
  const errors: CharacterRefResolveError[] = [];

  for (const ref of refs) {
    if (seenCharacters.has(ref.characterId)) {
      errors.push({
        code: "duplicate_character",
        characterId: ref.characterId,
        characterBibleVersionId: ref.characterBibleVersionId,
        message: `鏡頭角色引用重複: characterId=${ref.characterId}`,
      });
      continue;
    }
    seenCharacters.add(ref.characterId);

    const ver = byId.get(ref.characterBibleVersionId);
    if (!ver) {
      errors.push({
        code: "version_not_found",
        characterId: ref.characterId,
        characterBibleVersionId: ref.characterBibleVersionId,
        message: `找不到角色聖經版本: ${ref.characterBibleVersionId}`,
      });
      continue;
    }
    if (ver.characterId !== ref.characterId) {
      errors.push({
        code: "character_mismatch",
        characterId: ref.characterId,
        characterBibleVersionId: ref.characterBibleVersionId,
        message: `版本所屬角色不符: ref.characterId=${ref.characterId} version.characterId=${ver.characterId}`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

// ─── 生成 continuity 快照 ───────────────────────────────────────────────

/**
 * 記錄生成當下使用的 bible 版本（穩定、可重放）。
 * - characterRefs 依 characterId 升序複製
 * - characterBibleVersionIds = 去重後排序的 version id（對齊 AssetVersion 欄位）
 * - style 有值才寫入
 */
export function buildGenerationContinuitySnapshot(input: {
  characterRefs: readonly ShotCharacterRef[];
  styleBibleVersionId?: string | null;
}): GenerationContinuitySnapshot {
  const characterRefs = input.characterRefs
    .map((r) => ({
      characterId: r.characterId,
      characterBibleVersionId: r.characterBibleVersionId,
    }))
    .sort((a, b) => {
      if (a.characterId < b.characterId) return -1;
      if (a.characterId > b.characterId) return 1;
      if (a.characterBibleVersionId < b.characterBibleVersionId) return -1;
      if (a.characterBibleVersionId > b.characterBibleVersionId) return 1;
      return 0;
    });

  const characterBibleVersionIds = [
    ...new Set(characterRefs.map((r) => r.characterBibleVersionId)),
  ].sort();

  const snap: GenerationContinuitySnapshot = {
    characterRefs,
    characterBibleVersionIds,
  };

  if (input.styleBibleVersionId != null && input.styleBibleVersionId !== "") {
    snap.styleBibleVersionId = input.styleBibleVersionId;
  }

  return snap;
}

/**
 * 由角色卡 + 可選風格 id 快速組「生成用 refs + snapshot」。
 * 每張卡用 draft bible id（version 1）；供尚無版本表時的 adapter 路徑。
 */
export function buildShotCharacterRefsFromCharacters(
  characters: readonly CharacterRowLike[],
  opts: { version?: number } = {},
): ShotCharacterRef[] {
  const version = opts.version ?? 1;
  return characters.map((c) => ({
    characterId: c.id,
    characterBibleVersionId: draftCharacterBibleVersionId(c.id, version),
  }));
}

// ─── 使用者可見提示（中文） ─────────────────────────────────────────────

/**
 * 將過期引用格式化為中文提示（UI／審核留言用）。
 * 空列表回傳空字串。
 */
export function formatStaleContinuityHint(
  stale: readonly StaleContinuityRef[],
): string {
  if (stale.length === 0) return "";

  const parts: string[] = [];
  for (const s of stale) {
    if (s.kind === "character") {
      parts.push(
        `角色（${s.characterId ?? "?"}）聖經已更新：鏡頭鎖定 ${shortId(s.lockedVersionId)}，目前為 ${shortId(s.currentVersionId)}`,
      );
    } else {
      parts.push(
        `風格聖經已更新：鏡頭鎖定 ${shortId(s.lockedVersionId)}，目前為 ${shortId(s.currentVersionId)}`,
      );
    }
  }

  const head =
    stale.length === 1
      ? "連續性參考已過期，建議重新生成以套用最新定裝／風格。"
      : `連續性參考有 ${stale.length} 處已過期，建議重新生成以套用最新定裝／風格。`;

  return `${head} ${parts.join("；")}。`;
}

/** 過長 id 截斷顯示（保留可辨識前後） */
function shortId(id: string, keep = 12): string {
  if (id.length <= keep * 2 + 1) return id;
  return `${id.slice(0, keep)}…${id.slice(-6)}`;
}
