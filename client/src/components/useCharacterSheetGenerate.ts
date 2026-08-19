/**
 * Cheap-image 定裝圖（FLUX schnell，不用 Veo）＋完成後 honor 綁回角色卡。
 * 單格 HonorSheet 與 scorecard 人物列共用——角色卡自己另有一份相同流程。
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";

export function useCharacterSheetGenerate(projectId: string) {
  const utils = trpc.useUtils();
  const generateSheet = trpc.characters.generateSheet.useMutation();
  const honorSheet = trpc.characters.honorGeneratedSheet.useMutation({
    onSuccess: () => {
      void utils.characters.list.invalidate({ projectId });
      void utils.creativeContext.workspace.invalidate({ projectId });
    },
  });
  const [pending, setPending] = useState<{ characterId: string; generationId: string } | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const honoring = useRef(false);
  const launching = useRef(false);

  const launch = (characterId: string) => {
    launching.current = true;
    generateSheet.mutate(
      { characterId, clientRequestId: crypto.randomUUID() },
      {
        onSuccess: (row) => {
          launching.current = false;
          setPending({ characterId: row.characterId, generationId: row.generationId });
        },
        onError: () => {
          launching.current = false;
        },
      },
    );
  };

  const startMany = (characterIds: string[]) => {
    const unique = [...new Set(characterIds.filter(Boolean))];
    if (!unique.length) return;
    if (pending || launching.current) {
      setQueue((cur) => {
        const next = [...cur];
        for (const id of unique) {
          if (id !== pending?.characterId && !next.includes(id)) next.push(id);
        }
        return next;
      });
      return;
    }
    const [first, ...rest] = unique;
    if (rest.length) {
      setQueue((cur) => {
        const next = [...cur];
        for (const id of rest) if (!next.includes(id)) next.push(id);
        return next;
      });
    }
    launch(first!);
  };

  const start = (characterId: string) => startMany([characterId]);

  useEffect(() => {
    if (pending || launching.current) return;
    const next = queue[0];
    if (!next) return;
    setQueue((cur) => cur.slice(1));
    launch(next);
  }, [pending]);

  const sheetStatus = trpc.generation.status.useQuery(
    { id: pending?.generationId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(pending), refetchInterval: pending ? 3_000 : false },
  );

  useEffect(() => {
    if (!pending || sheetStatus.data?.status !== "done" || honoring.current) return;
    honoring.current = true;
    honorSheet.mutate(pending, {
      onSettled: () => {
        honoring.current = false;
      },
      onSuccess: () => setPending(null),
    });
  }, [honorSheet, pending, sheetStatus.data?.status]);

  return {
    start,
    startMany,
    pendingCharacterId: pending?.characterId ?? null,
    isPending: Boolean(pending) || generateSheet.isPending || queue.length > 0,
    error: generateSheet.error ?? honorSheet.error,
  };
}
