/**
 * Late ACK gate for scene writes.
 *
 * insertAfter / move / field-save can still resolve after the user left the
 * origin shot or project. A shared tRPC mutationKey may also deliver that ACK
 * to the newly mounted board. Only apply list invalidation, selection follow,
 * or field-gate ACK when the write still belongs to what is on screen.
 *
 * Do not use this to justify removing /p/:id or /studio/:id remount keys.
 */

export function shouldApplySceneWriteAck(input: {
  mountedProjectId: string;
  writeProjectId?: string | null;
  mountedShotId?: string | null;
  originShotId?: string | null;
  writeShotId?: string | null;
  followSelection?: boolean;
}): { applyInvalidate: boolean; followCreated: boolean; applyFieldAck: boolean } {
  const sameProject = Boolean(input.writeProjectId) && input.writeProjectId === input.mountedProjectId;
  const stillOnOrigin = !input.originShotId || input.mountedShotId === input.originShotId;
  const sameShot = !input.writeShotId || input.writeShotId === input.mountedShotId;
  return {
    applyInvalidate: sameProject,
    followCreated: Boolean(input.followSelection && sameProject && stillOnOrigin),
    applyFieldAck: sameProject && sameShot,
  };
}
