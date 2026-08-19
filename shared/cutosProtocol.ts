import { z } from "zod";

export const cutosPermissionSchema = z.enum(["read", "write"]);

export const cutosCapabilitySchema = z.object({
  name: z.string().min(1),
  description: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  permission: cutosPermissionSchema,
  params: z.unknown().optional(),
});

export const cutosManifestSchema = z.object({
  protocol: z.string().min(1),
  capabilities: z.array(cutosCapabilitySchema),
});

export const cutosInvokeRequestSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  requestId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

export const cutosInvokeResponseSchema = z.object({
  ok: z.boolean().optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
  runId: z.string().optional(),
  jobId: z.string().optional(),
  projectId: z.string().optional(),
  timelineRevision: z.number().int().nonnegative().optional(),
}).passthrough();

export const cutosHealthSchema = z.object({
  configured: z.boolean().optional(),
  reachable: z.boolean().optional(),
  status: z.number().int().optional(),
  latencyMs: z.number().nonnegative().optional(),
}).passthrough();

export type CutosCapability = z.infer<typeof cutosCapabilitySchema>;
export type CutosManifest = z.infer<typeof cutosManifestSchema>;
export type CutosInvokeRequest = z.infer<typeof cutosInvokeRequestSchema>;
export type CutosInvokeResponse = z.infer<typeof cutosInvokeResponseSchema>;
export type CutosHealth = z.infer<typeof cutosHealthSchema>;
