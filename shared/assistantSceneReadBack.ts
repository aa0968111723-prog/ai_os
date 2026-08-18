/**
 * Authoritative scene-row read-back — same contract as
 * agentDatabaseTools (verified + verificationMethod).
 *
 * A write is only verified when SELECT finds the row in the same project,
 * it is not soft-deleted, and every requested field matches.
 */

export const ASSISTANT_SCENE_READ_BACK_METHOD = "authoritative_scene_row_read_back" as const;

export type SceneReadBackRow = {
  projectId: string;
  deletedAt?: Date | string | null;
  [key: string]: unknown;
};

export function sceneFieldMatches(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (expected !== null && typeof expected === "object") {
    return JSON.stringify(actual ?? null) === JSON.stringify(expected);
  }
  return actual === expected || String(actual ?? "") === String(expected);
}

export function verifySceneWrite(input: {
  found: SceneReadBackRow | null | undefined;
  projectId: string;
  expected: Record<string, unknown>;
}): { verified: boolean; unmatched: string[] } {
  const { found, projectId, expected } = input;
  if (!found || found.projectId !== projectId || found.deletedAt) {
    return { verified: false, unmatched: ["row"] };
  }
  const unmatched: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    if (!sceneFieldMatches(found[key], value)) unmatched.push(key);
  }
  return { verified: unmatched.length === 0, unmatched };
}
