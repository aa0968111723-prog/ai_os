/**
 * Worldview writes share one JSONB column. Chip clicks and blur saves must
 * serialize: the second send waits for the ACK'd rev, otherwise rapid chips
 * self-conflict and chip-then-blur last-write-wins.
 */

export type WorldviewSaveRequest = {
  worldview: Record<string, unknown>;
  expectedRev: number | undefined;
};

export function createWorldviewSaveGate(opts: {
  send: (req: WorldviewSaveRequest) => void;
  getRev: () => number | undefined;
}) {
  let inFlight = false;
  let queued: Record<string, unknown> | null = null;
  let localRev: number | null = null;

  function rev(): number | undefined {
    return localRev ?? opts.getRev();
  }

  function dispatch(worldview: Record<string, unknown>): "dispatched" | "queued" {
    if (inFlight) {
      queued = { ...(queued ?? {}), ...worldview };
      return "queued";
    }
    inFlight = true;
    opts.send({ worldview, expectedRev: rev() });
    return "dispatched";
  }

  return {
    save(worldview: Record<string, unknown>) {
      return dispatch(worldview);
    },
    onAck(newRev: number | undefined) {
      if (typeof newRev === "number") localRev = newRev;
      inFlight = false;
      if (!queued) return;
      const next = queued;
      queued = null;
      dispatch(next);
    },
    reset() {
      inFlight = false;
      queued = null;
      localRev = null;
    },
  };
}
