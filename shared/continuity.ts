import { z } from "zod";

const nullableText = z.string().nullable();

export const continuityCharacterSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  appearance: z.string(),
  notes: nullableText,
  referenceAssetId: z.string().uuid().nullable(),
  /**
   * 這一鏡選用的造型（Story-first §14 Identity/Look 分層；舊快照沒有這兩欄，維持可解析）。
   * 為什麼凍進快照：造型是「本鏡限定」的外觀，重試時 Look 卡被改名或刪掉，
   * 這一批鏡頭的錨點仍要是當初那句——與 prop 的 ownerName 同一個理由。
   */
  lookName: z.string().nullable().optional(),
  lookCostume: z.string().nullable().optional(),
  /** 這一鏡鎖的是哪一張造型卡——過時偵測要比對「同一張卡」，不能拿專案裡隨便一套造型來比 */
  lookId: z.string().uuid().nullable().optional(),
});

export const continuitySceneSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  palette: z.string(),
  lighting: nullableText,
  referenceAssetId: z.string().uuid().nullable(),
});

export const continuityPropSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  appearance: z.string(),
  notes: nullableText,
  referenceAssetId: z.string().uuid().nullable(),
  /** 歸屬（v1 之後才有；舊快照沒有這兩欄，維持可解析） */
  ownerKind: z.enum(["character", "scene"]).nullable().optional(),
  /** 凍結當下的主人名字——重試時主人被改名／刪掉，錨點仍是當初那句 */
  ownerName: z.string().nullable().optional(),
});

/**
 * 這一鏡自己的鏡頭語言／表演／走位，凍結在生成當下。
 *
 * 為什麼要凍：卡片漂移（換臉、換色）v1 已經抓得到，但**鏡頭語言改了畫面同樣過時**——
 * 使用者把「中景」改成「特寫」之後，那張中景的圖就不再是這一鏡要的東西了，
 * 而 v1 完全看不到這件事（快照裡只有卡片）。
 *
 * 也正是這一層讓「相依感知」講得出區別：camera／lighting／action／performance 進快照 ⇒
 * 改它們會讓畫面過時；voiceover／ambience／music／dialogue **刻意不進** ⇒
 * 改配音不會讓圖被誤標成過時。
 *
 * 全欄 optional：舊快照沒有這一段，照樣 parse 得過（version 維持 1，不需要 migration）。
 */
export const continuityShotDirectionSchema = z.object({
  camera: z.record(z.string()).nullable().optional(),
  performance: z.record(z.string()).nullable().optional(),
  action: z.string().nullable().optional(),
});
export type ContinuityShotDirection = z.infer<typeof continuityShotDirectionSchema>;

/**
 * 生成當下的版本化一致性快照。重試必須沿用這份資料，避免卡片後續修改
 * 讓同一批鏡頭悄悄換臉、換色或換材質。
 */
export const continuitySnapshotSchema = z.object({
  version: z.literal(1),
  locked: z.boolean(),
  capturedAt: z.string().datetime(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  characters: z.array(continuityCharacterSchema),
  scenes: z.array(continuitySceneSchema),
  props: z.array(continuityPropSchema),
  referenceAssetIds: z.array(z.string().uuid()),
  /**
   * 這一鏡的鏡頭語言（v4 起）。**刻意不進 fingerprint**——fingerprint 的用途是
   * 「這批卡片參考是不是同一組」，把逐鏡的鏡頭語言算進去會讓同一組卡片的指紋
   * 在每次調鏡頭時都變掉，破壞既有的重試／沿用判斷。
   */
  shotDirection: continuityShotDirectionSchema.nullable().optional(),
});

export type ContinuitySnapshot = z.infer<typeof continuitySnapshotSchema>;

/* ── 過時偵測（PE 計畫 §23 雙向影響 / P3 Continuity Checker） ─────────────────
 *
 * 為什麼比對快照而不是看卡片的 updatedAt：
 *  1. characters/props/scene_presets 沒有 updatedAt 欄位，加欄位要 migration；
 *  2. 更重要的是——「有人碰過這張卡」不等於「畫面過時了」。改個備註不影響畫面，
 *     改外觀才影響。快照凍的正是「這張圖是照什麼畫的」，逐欄比對才問得準。
 *
 * 只比「會進錨點、真的影響畫面」的欄位（見 cardAnchors 的 format*Anchor）：
 * 角色＝外觀＋造型、場景＝色板＋光線、道具＝外觀。備註（notes）不進畫面，不算數。 */

/** 一項過時原因（給人看的句子由呼叫端組，這裡只回事實） */
export interface ContinuityDrift {
  kind: "character" | "scene" | "prop" | "direction" | "binding";
  id: string;
  /** 快照當時的名字（卡片可能已改名，用當時的名字才對得上那張圖） */
  name: string;
  /** 哪些欄位變了：appearance / look / palette / lighting／或鏡頭語言欄位名 */
  fields: string[];
}

/**
 * 這一鏡**現在**綁了哪些卡片（#725 P1-7）。
 *
 * v1 的漂移偵測只比「快照凍住的那幾張卡，內容有沒有被改過」——完全看不到
 * 「這一鏡換了一張卡」。換 Look、加減角色、換場景（也就是 #722/#723 面板的全部意義）
 * 都不會被標成畫面過時。快照裡本來就有當時綁了哪些 id，比對 id 集合即可，
 * 不需要新欄位、不需要 migration。
 */
export interface CurrentShotBindings {
  characterIds?: string[] | null;
  lookIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
}

/** 現在的卡片內容（只取會影響畫面的欄位；呼叫端從 DB 撈） */
export interface CurrentCards {
  characters: Map<string, { appearance: string }>;
  scenes: Map<string, { palette: string; lighting: string | null }>;
  props: Map<string, { appearance: string }>;
  /**
   * 造型卡（以 lookId 為鍵）：只跟快照凍的那一張比。
   * `characterId`＝這套造型屬於誰。綁定漂移要用它濾掉**孤兒造型**
   *（掛在鏡上但它的角色沒被綁）——那種造型生成時本來就進不了錨點，
   * 不是「改過」。沒帶 characterId 的呼叫端＝無從判斷，那一段就不比。
   */
  looks: Map<string, { name: string; costume: string | null; characterId?: string }>;
}

function norm(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 這張圖是不是已經跟卡片對不上了。
 *
 * 卡片**被刪掉**不算過時：圖仍忠實反映當初的設定，而且刪卡本身已經有回收桶與
 * 「參考圖已在回收桶」的既有提示；把它也標成過時只會讓提示變吵而沒有新資訊。
 */
export function detectContinuityDrift(
  snapshot: ContinuitySnapshot | null | undefined,
  current: CurrentCards,
  /**
   * 這一鏡**現在**的鏡頭語言。不傳＝呼叫端沒有這份資料，那一段就不比
   * （與「卡片被刪不算過時」同一條原則：無從判斷就別猜）。
   */
  currentShot?: ContinuityShotDirection | null,
  /**
   * 這一鏡現在綁了哪些卡片（#725 P1-7）。不傳＝呼叫端沒有這份資料，那一段不比
   * （與「卡片被刪不算過時」同一條原則：無從判斷就別猜）。
   */
  currentBindings?: CurrentShotBindings | null,
): ContinuityDrift[] {
  if (!snapshot) return [];
  const out: ContinuityDrift[] = [];

  for (const frozen of snapshot.characters) {
    const now = current.characters.get(frozen.id);
    if (!now) continue;
    const fields: string[] = [];
    if (norm(now.appearance) !== norm(frozen.appearance)) fields.push("appearance");
    /*
     * 造型只比「這一鏡當時鎖的那一張卡」：
     *  - 沒有 lookId＝這一鏡當時沒鎖造型（或是舊快照），造型根本不在這張圖的錨點裡 → 不比；
     *    否則專案後來新增任何一套造型，都會讓所有舊圖被誤判成過時。
     *  - 卡被刪掉 → 與「卡片被刪不算過時」同一條規則，不比。
     */
    if (frozen.lookId) {
      const nowLook = current.looks.get(frozen.lookId);
      if (nowLook) {
        // 取值順序與 formatCharacterAnchor 一致：costume 優先、退回 name
        const frozenText = norm(frozen.lookCostume) || norm(frozen.lookName);
        const nowText = norm(nowLook.costume) || norm(nowLook.name);
        if (frozenText !== nowText) fields.push("look");
      }
    }
    if (fields.length) out.push({ kind: "character", id: frozen.id, name: frozen.name, fields });
  }

  for (const frozen of snapshot.scenes) {
    const now = current.scenes.get(frozen.id);
    if (!now) continue;
    const fields: string[] = [];
    if (norm(now.palette) !== norm(frozen.palette)) fields.push("palette");
    if (norm(now.lighting) !== norm(frozen.lighting)) fields.push("lighting");
    if (fields.length) out.push({ kind: "scene", id: frozen.id, name: frozen.name, fields });
  }

  for (const frozen of snapshot.props) {
    const now = current.props.get(frozen.id);
    if (!now) continue;
    if (norm(now.appearance) !== norm(frozen.appearance)) {
      out.push({ kind: "prop", id: frozen.id, name: frozen.name, fields: ["appearance"] });
    }
  }

  /*
   * 綁定漂移（#725 P1-7）：這一鏡**換了卡片**同樣讓畫面過時。
   *
   * 比的是 id 集合：快照凍住的那批 vs 這一鏡現在綁的那批。
   * Look 從快照的 characters[].lookId 取（那是「這一鏡當時鎖的那一張造型卡」）。
   * 排序後比對——順序不是創作差異。
   */
  if (currentBindings) {
    const chars = [...new Set(currentBindings.characterIds ?? [])];
    const looks = [...new Set(currentBindings.lookIds ?? [])];
    const scenes = [...new Set(currentBindings.scenePresetIds ?? [])];
    const props = [...new Set(currentBindings.propIds ?? [])];

    /*
     * 這一鏡完全沒有自己的卡片綁定時**不比對**。
     *
     * `resolveSceneCards` 的規則是「沒綁定就沿用生成台當下的勾選」，
     * 所以快照裡會有這一鏡本身沒有的卡片。那是 fallback，不是漂移——
     * 硬比會讓每一張這樣產生的圖一出生就被標成過時。
     */
    const hasOwnBinding = chars.length > 0 || scenes.length > 0 || props.length > 0;
    if (hasOwnBinding) {
      const sameSet = (a: readonly string[], b: readonly string[]) => {
        const x = [...new Set(a)].sort();
        const y = [...new Set(b)].sort();
        return x.length === y.length && x.every((v, i) => v === y[i]);
      };
      /** 現在綁著、但當初沒進快照 ⇒ 一定是生成之後才加／換上去的（安全訊號） */
      const addedSince = (nowIds: readonly string[], frozenIds: readonly string[]) => {
        const frozen = new Set(frozenIds);
        return nowIds.some((id) => !frozen.has(id));
      };

      const frozenChars = snapshot.characters.map((r) => r.id);
      const frozenScenes = snapshot.scenes.map((r) => r.id);
      const frozenProps = snapshot.props.map((r) => r.id);
      const frozenLooks = snapshot.characters.map((r) => r.lookId).filter((id): id is string => !!id);
      /*
       * 只看「屬於目前綁定角色」的造型。
       *
       * 孤兒造型（造型掛在鏡上、它的角色卻沒被綁）生成時根本進不了錨點層，
       * 快照裡自然沒有它——拿它當「生成後新增的」會讓每一張這種鏡的圖一出生就過時。
       * （e2e「卡片沒動時不誤報過時」正是被這個抓到：該鏡有 lookIds 但 characterIds 是 null。）
       * 查不到 characterId 的造型同樣不比——無從判斷就別猜。
       */
      const boundChars = new Set(chars);
      const looksOfBoundCharacters = looks.filter((lookId) => {
        const owner = current.looks.get(lookId)?.characterId;
        return !!owner && boundChars.has(owner);
      });

      const bindingFields: string[] = [];
      // 角色與場景沒有「自動帶入」機制 ⇒ 快照與綁定應該逐一相等，可以雙向比
      if (!sameSet(frozenChars, chars)) bindingFields.push("characters");
      if (!sameSet(frozenScenes, scenes)) bindingFields.push("scenes");
      /*
       * 造型與道具只比「多出來的」，不比「少掉的」。
       *
       * 快照這兩類**合法地會比綁定多**：
       *  - 道具：`mergePropIdsWithCarried` 會把「掛在所選角色／場景底下的道具」自動帶進生成，
       *    但 `scenes.propIds` 欄位不會跟著變 ⇒ 快照 ⊇ 綁定。
       *  - 造型：快照的 lookId 是「配對到快照內角色的那一張」，綁定裡可能有配不到角色的造型。
       * 雙向比會把這兩種正常情況誤報成過時（e2e「卡片沒動時不誤報過時」正是被這個抓到）。
       * 「多出來的」則毫無歧義：生成當時沒有它，現在有了。
       * 代價：純粹的「移除造型／道具」不會被標過時——寧可漏報也不要每張圖一出生就過時。
       */
      if (addedSince(looksOfBoundCharacters, frozenLooks)) bindingFields.push("looks");
      if (addedSince(props, frozenProps)) bindingFields.push("props");
      if (bindingFields.length) {
        out.push({ kind: "binding", id: "shot", name: "這一鏡", fields: bindingFields.sort() });
      }
    }
  }

  /*
   * 鏡頭語言漂移（v4）：逐欄比對，只在快照真的凍過這一段時才比。
   * 舊資料沒有 shotDirection ⇒ 不比，不會讓歷史畫面一夜之間全被標成過時。
   */
  if (snapshot.shotDirection && currentShot) {
    const fields: string[] = [];
    const frozenDirection = { ...(snapshot.shotDirection.camera ?? {}), ...(snapshot.shotDirection.performance ?? {}) };
    const nowDirection = { ...(currentShot.camera ?? {}), ...(currentShot.performance ?? {}) };
    for (const key of new Set([...Object.keys(frozenDirection), ...Object.keys(nowDirection)])) {
      if (norm(frozenDirection[key]) !== norm(nowDirection[key])) fields.push(key);
    }
    if (norm(snapshot.shotDirection.action) !== norm(currentShot.action)) fields.push("action");
    if (fields.length) out.push({ kind: "direction", id: "shot", name: "這一鏡", fields: fields.sort() });
  }

  return out;
}

/** 欄位 → 中文（提示句用；單一真相，client/server 共用） */
export const DRIFT_FIELD_LABEL: Record<string, string> = {
  appearance: "外觀",
  look: "造型",
  palette: "色板",
  lighting: "光線",
  // 鏡頭語言（與 SHOT_DIRECTION_FIELD_LABEL 同一批欄位名；這裡重列是為了讓
  // shared/continuity 不必依賴 shared/story，兩份標籤由 continuity.test.ts 鎖住一致）
  shotSize: "鏡別",
  angle: "機位",
  movement: "運鏡",
  focalLength: "焦段",
  composition: "構圖",
  emotion: "情緒",
  gaze: "視線",
  action: "動作",
  // 綁定漂移（換了卡片，不是卡片內容被改）
  characters: "角色綁定",
  looks: "造型綁定",
  scenes: "場景綁定",
  props: "道具綁定",
};

/** 一句話說明這張圖為什麼過時（回空字串＝沒有過時） */
export function describeDrift(drifts: ContinuityDrift[]): string {
  if (!drifts.length) return "";
  return drifts
    .map((d) => `${d.name}的${d.fields.map((f) => DRIFT_FIELD_LABEL[f] ?? f).join("、")}`)
    .join("；");
}
