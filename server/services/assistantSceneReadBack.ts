/**
 * Scene-row SELECT used after assistant / agent writes.
 * Services must not import routers. Comparison lives in shared/.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import {
  ASSISTANT_SCENE_READ_BACK_METHOD,
  verifySceneWrite,
  type SceneReadBackRow,
} from "../../shared/assistantSceneReadBack";
import type { AssistantWriteVerification } from "../../shared/assistantHonestCompletion";

export { ASSISTANT_SCENE_READ_BACK_METHOD };

export async function readBackScene(projectId: string, sceneId: string) {
  const [fresh] = await db
    .select()
    .from(schema.scenes)
    .where(and(
      eq(schema.scenes.id, sceneId),
      eq(schema.scenes.projectId, projectId),
      isNull(schema.scenes.deletedAt),
    ));
  return fresh ?? null;
}

export async function verifySceneWriteReadBack(input: {
  projectId: string;
  sceneId: string;
  expected: Record<string, unknown>;
  verifiedMessage?: string;
}): Promise<{
  verified: boolean;
  unmatched: string[];
  found: SceneReadBackRow | null;
  verification: AssistantWriteVerification;
  verificationMethod: typeof ASSISTANT_SCENE_READ_BACK_METHOD;
}> {
  const found = await readBackScene(input.projectId, input.sceneId);
  const { verified, unmatched } = verifySceneWrite({
    found,
    projectId: input.projectId,
    expected: input.expected,
  });
  return {
    verified,
    unmatched,
    found,
    verification: verified
      ? { status: "verified", message: input.verifiedMessage ?? "已重新讀取並確認寫入" }
      : { status: "unverified", message: "操作已送出，但驗證未通過" },
    verificationMethod: ASSISTANT_SCENE_READ_BACK_METHOD,
  };
}
