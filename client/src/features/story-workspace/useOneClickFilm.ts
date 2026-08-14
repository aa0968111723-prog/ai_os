import { useState } from "react";
import { trpc } from "../../api";
import {
  ONE_CLICK_BATCH_MODEL,
  requestStoryFlush,
  runOneClickFilm,
  type OneClickFilmResult,
} from "./oneClickFilm";

export function useOneClickFilm(projectId: string) {
  const utils = trpc.useUtils();
  const parse = trpc.story.parse.useMutation();
  const board = trpc.story.generateStoryboard.useMutation();
  const batch = trpc.scenes.batchGenerate.useMutation();
  const [result, setResult] = useState<OneClickFilmResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = parse.isPending || board.isPending || batch.isPending;

  const run = async () => {
    setError(null);
    try {
      const next = await runOneClickFilm({
        flushStory: requestStoryFlush,
        parse: async () => {
          await parse.mutateAsync({ projectId });
        },
        generateStoryboard: async () => {
          await board.mutateAsync({ projectId });
        },
        batchGenerate: async () => {
          const r = await batch.mutateAsync({ projectId, modelId: ONE_CLICK_BATCH_MODEL });
          return { runId: r.runId, shots: r.shots, estPoints: r.estPoints ?? 0 };
        },
      });
      setResult(next);
      utils.scenes.listByProject.invalidate({ projectId });
      utils.story.get.invalidate({ projectId });
      utils.story.scenesList.invalidate({ projectId });
      utils.agents.listByProject.invalidate({ projectId });
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成失敗";
      setError(message);
      throw err;
    }
  };

  return { run, pending, error, result };
}
