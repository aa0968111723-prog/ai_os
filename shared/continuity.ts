import { z } from "zod";

const nullableText = z.string().nullable();

export const continuityCharacterSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  appearance: z.string(),
  notes: nullableText,
  referenceAssetId: z.string().uuid().nullable(),
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
