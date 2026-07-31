/**
 * 方案 B：敏感操作信箱 step-up（一般登入仍為 email+密碼，不強制每次 OTP）。
 * 信箱未設定時：不阻擋敏感操作（與邀請信優雅降級一致），僅 log。
 * 信箱已設定時：必須 request → 信箱收 6 碼 → 敏感 API 帶 challengeId+code。
 */
import { createHash, randomInt } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { sendEmail, isEmailConfigured } from "./email";

export const STEP_UP_PURPOSES = ["change_password", "invite_member"] as const;
export type StepUpPurpose = (typeof STEP_UP_PURPOSES)[number];

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return createHash("sha256").update(`aios-stepup:${code}`).digest("hex");
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const u = user.length <= 2 ? "*".repeat(user.length) : `${user[0]}***${user[user.length - 1]}`;
  return `${u}@${domain}`;
}

function purposeLabel(purpose: StepUpPurpose): string {
  return purpose === "change_password" ? "變更密碼" : "邀請成員";
}

/** 是否要求 step-up（信箱機制就緒才要求） */
export function stepUpRequired(): boolean {
  return isEmailConfigured();
}

export async function requestEmailStepUp(input: {
  userId: string;
  email: string;
  purpose: StepUpPurpose;
}): Promise<{ challengeId: string; expiresInSec: number; emailMasked: string; skipped: boolean; detail?: string }> {
  if (!isEmailConfigured()) {
    return {
      challengeId: "",
      expiresInSec: 0,
      emailMasked: maskEmail(input.email),
      skipped: true,
      detail: "信箱機制未設定，此操作不需信箱驗證碼",
    };
  }

  const code = String(randomInt(100000, 999999));
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  const [row] = await db
    .insert(schema.emailStepUpChallenges)
    .values({
      userId: input.userId,
      purpose: input.purpose,
      codeHash,
      expiresAt,
    })
    .returning({ id: schema.emailStepUpChallenges.id });

  const label = purposeLabel(input.purpose);
  const result = await sendEmail({
    to: input.email,
    subject: `AI Director OS 驗證碼：${label}`,
    text: [
      `你正在進行「${label}」，需要信箱驗證。`,
      "",
      `驗證碼：${code}`,
      "",
      "10 分鐘內有效，請勿轉寄他人。",
      "若不是你本人操作，請忽略本信並聯絡管理員。",
    ].join("\n"),
  });

  if (result.status === "failed") {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: result.detail || "驗證碼寄送失敗，請稍後再試",
    });
  }

  return {
    challengeId: row.id,
    expiresInSec: Math.floor(CODE_TTL_MS / 1000),
    emailMasked: maskEmail(input.email),
    skipped: false,
  };
}

/**
 * 驗證 challenge + code；成功則標記 consumed。
 * 信箱未設定：直接通過（與 request 的 skipped 對齊）。
 */
export async function consumeEmailStepUp(input: {
  userId: string;
  purpose: StepUpPurpose;
  challengeId?: string | null;
  code?: string | null;
}): Promise<void> {
  if (!isEmailConfigured()) return;

  const challengeId = input.challengeId?.trim();
  const code = input.code?.trim();
  if (!challengeId || !code || !/^\d{6}$/.test(code)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "此操作需要信箱驗證碼——請先取得驗證碼再重試",
    });
  }

  const [row] = await db
    .select()
    .from(schema.emailStepUpChallenges)
    .where(
      and(
        eq(schema.emailStepUpChallenges.id, challengeId),
        eq(schema.emailStepUpChallenges.userId, input.userId),
        eq(schema.emailStepUpChallenges.purpose, input.purpose),
        isNull(schema.emailStepUpChallenges.consumedAt),
      ),
    );

  if (!row) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "驗證碼無效或已使用，請重新取得" });
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "驗證碼已過期，請重新取得" });
  }
  if (row.attemptCount >= MAX_ATTEMPTS) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "驗證次數過多，請重新取得驗證碼" });
  }

  if (row.codeHash !== hashCode(code)) {
    await db
      .update(schema.emailStepUpChallenges)
      .set({ attemptCount: row.attemptCount + 1 })
      .where(eq(schema.emailStepUpChallenges.id, row.id));
    throw new TRPCError({ code: "BAD_REQUEST", message: "驗證碼不正確" });
  }

  await db
    .update(schema.emailStepUpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(schema.emailStepUpChallenges.id, row.id));
}
