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
