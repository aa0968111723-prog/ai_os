/**
 * SceneList / listByProject: a finished generateInto stays Candidate-only
 * until Adopt. Show the CTA when the latest done visual gen is not current.
 */
export function pendingAdoptGenerationId(input: {
  latestDoneVisualGenId?: string | null;
  generationId?: string | null;
}): string | null {
  const latest = input.latestDoneVisualGenId?.trim() || "";
  if (!latest) return null;
  const current = input.generationId?.trim() || "";
  if (current && current === latest) return null;
  return latest;
}
