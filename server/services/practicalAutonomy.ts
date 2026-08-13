import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { classifyExecutionError, isRetrySafeExecutionError } from "./dbRetryPolicy";

export type ToolAccess = "READ" | "WRITE" | "EXTERNAL";
export type ToolRisk = "low" | "medium" | "high";
export type ConfirmationPolicy = "never" | "paid" | "high_risk" | "always";
export type IdempotencyPolicy = "none" | "keyed" | "effect_receipt";
export type TrustLabel = "SYSTEM" | "USER_EXPLICIT" | "VERIFIED_INTERNAL" | "EXTERNAL_UNTRUSTED" | "GENERATED_UNTRUSTED";
export type VerificationStage = "ACCEPTED" | "QUEUED" | "RUNNING" | "PERSISTED" | "INDEXED" | "VERIFIED" | "COMPLETED";
