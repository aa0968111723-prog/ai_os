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
  kind: "character" | "scene" | "prop";
  id: string;
  /** 快照當時的名字（卡片可能已改名，用當時的名字才對得上那張圖） */
  name: string;
  /** 哪些欄位變了：appearance / look / palette / lighting */
  fields: string[];
}

/** 現在的卡片內容（只取會影響畫面的欄位；呼叫端從 DB 撈） */
export interface CurrentCards {
  characters: Map<string, { appearance: string }>;
  scenes: Map<string, { palette: string; lighting: string | null }>;
  props: Map<string, { appearance: string }>;
  /** 造型卡（以 lookId 為鍵）：只跟快照凍的那一張比 */
  looks: Map<string, { name: string; costume: string | null }>;
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

  return out;
}

/** 欄位 → 中文（提示句用；單一真相，client/server 共用） */
export const DRIFT_FIELD_LABEL: Record<string, string> = {
  appearance: "外觀",
  look: "造型",
  palette: "色板",
  lighting: "光線",
};

/** 一句話說明這張圖為什麼過時（回空字串＝沒有過時） */
export function describeDrift(drifts: ContinuityDrift[]): string {
  if (!drifts.length) return "";
  return drifts
    .map((d) => `${d.name}的${d.fields.map((f) => DRIFT_FIELD_LABEL[f] ?? f).join("、")}`)
    .join("；");
}
