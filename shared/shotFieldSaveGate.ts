/**
 * Shot Inspector field-save gate.
 *
 * Each blur/save sends expectedRev. If title save is still in flight and
 * prompt save reuses the same shot.rev, the second write is a self-conflict
 * after the first ACK bumps rev.
 *
 * One in-flight write; later patches queue and flush with the ACK'd rev.
 */

export type ShotFieldSaveRequest = {
  patch: Record<string, unknown>;
  expectedRev: number | undefined;
  baseline: Record<string, unknown>;
};

export function createShotFieldSaveGate(opts: {
  send: (req: ShotFieldSaveRequest) => void;
  getRev: () => number | undefined;
}) {
  let inFlight = false;
  let queued: { patch: Record<string, unknown>; baseline: Record<string, unknown> } | null = null;
  let localRev: number | null = null;

  function rev(): number | undefined {
    return localRev ?? opts.getRev();
  }

  function dispatch(patch: Record<string, unknown>, baseline: Record<string, unknown>): "dispatched" | "queued" {
    if (inFlight) {
      queued = {
        patch: { ...(queued?.patch ?? {}), ...patch },
        baseline: { ...(queued?.baseline ?? {}), ...baseline },
      };
      return "queued";
    }
    inFlight = true;
    opts.send({ patch, expectedRev: rev(), baseline });
    return "dispatched";
  }

  return {
    save(patch: Record<string, unknown>, baseline: Record<string, unknown>) {
      return dispatch(patch, baseline);
    },
    onAck(newRev: number | undefined) {
      if (typeof newRev === "number") localRev = newRev;
      inFlight = false;
      if (!queued) return;
      const next = queued;
      queued = null;
      dispatch(next.patch, next.baseline);
    },
    reset() {
      inFlight = false;
      queued = null;
      localRev = null;
    },
  };
}
