import { useState } from "react";
import { trpc } from "../../api";
import { refreshStudioShotList } from "../../lib/studioShotList";
import {
  ONE_CLICK_BATCH_MODEL,
  ONE_CLICK_NEED_SHOTS,
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

  const regenShots = async (sceneIds: string[]) => {
    setError(null);
    try {
      const r = await batch.mutateAsync({
        projectId,
        modelId: ONE_CLICK_BATCH_MODEL,
        sceneIds,
      });
      const next = { runId: r.runId, shots: r.shots, estPoints: r.estPoints ?? 0 };
      setResult(next);
      utils.agents.listByProject.invalidate({ projectId });
      utils.scenes.listByProject.invalidate({ projectId });
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成失敗";
      setError(message);
      throw err;
    }
  };

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
          void utils.scenes.listByProject.invalidate({ projectId });
          await refreshStudioShotList(utils, projectId);
        },
        batchGenerate: async () => {
          const shots = await utils.scenes.listByProject.fetch({ projectId });
          if (!shots?.length) {
            throw new Error(ONE_CLICK_NEED_SHOTS);
          }
          const r = await batch.mutateAsync({ projectId, modelId: ONE_CLICK_BATCH_MODEL });
          return { runId: r.runId, shots: r.shots, estPoints: r.estPoints ?? 0 };
        },
      });
      setResult(next);
      await refreshStudioShotList(utils, projectId);
      utils.story.get.invalidate({ projectId });
      utils.agents.listByProject.invalidate({ projectId });
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成失敗";
      setError(message);
      throw err;
    }
  };

  return { run, regenShots, pending, error, result };
}
