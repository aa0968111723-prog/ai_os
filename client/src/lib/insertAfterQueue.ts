/**
 * Click-order queue for「在這之後插入」.
 *
 * scenes.insertAfter always places the new row immediately after the given
 * sceneId. Ten clicks on the same row therefore send the same id and, once
 * the advisory lock serializes them, later inserts push earlier ones down
 * (LIFO). This queue waits for each create and uses the new id as the next
 * target so the board is origin → click1 → click2 → … in that order.
 *
 * Duplicate stays unchained: insertAfter copies FROM sceneId, so chaining
 * would copy the copy (「複本 複本」).
 */
export type InsertAfterInput = { sceneId: string; duplicate?: boolean };
export type InsertAfterCreated = { id: string };

export function createInsertAfterQueue(
  mutate: (input: InsertAfterInput) => Promise<InsertAfterCreated>,
) {
  let tail: string | null = null;
  let running = false;
  const q: Array<{ originId: string; duplicate?: boolean }> = [];

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (q.length) {
        const job = q.shift()!;
        const after = job.duplicate ? job.originId : (tail ?? job.originId);
        try {
          const created = await mutate({ sceneId: after, duplicate: job.duplicate });
          if (!job.duplicate) tail = created.id;
        } catch {
          /* keep tail; remaining clicks still chain from the last success */
        }
      }
    } finally {
      running = false;
      if (q.length) await drain();
    }
  }

  return {
    enqueue(originId: string, job: { duplicate?: boolean } = {}) {
      q.push({ originId, duplicate: job.duplicate });
      void drain();
    },
    reset() {
      tail = null;
    },
  };
}
