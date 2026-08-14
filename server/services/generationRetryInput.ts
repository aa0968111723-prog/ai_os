/**
 * 「用同一份設定重試一筆失敗的生成」——**單一真相**。
 *
 * 存在的理由（#725 P1-4）：這件事原本有兩份實作。`generation.retry` 是完整版，
 * MCP 的 `retry_generation` 是後來另外寫的退化版，只帶 projectId/modelId/prompt/
 * sourceUrl/sceneId。於是同一個動作走不同入口會得到不同結果：
 *
 *  - 掉了 `preserveScenePointer` ⇒ 重試一個**失敗的變體**，會變成「會移動指標」的生成，
 *    完成時直接蓋掉這一鏡的現用畫面（使用者從未採用任何一版）。
 *  - 掉了 `sceneRole` ⇒ 重試一個**失敗的旁白**，完成時落進 `else` 分支，
 *    把音訊素材寫進 `scenes.assetId`（正是 scenes.ts 註解警告的破圖情形）。
 *  - 掉了 characterIds/scenePresetIds/propIds 與 continuitySnapshot ⇒ 錨點全失，
 *    重試出來的圖跨鏡走樣。
 *  - 掉了 `creative` ⇒ 重試出來的版本脫離原批次，變成孤兒版本 ＋ 一批永遠缺一個。
 *
 * 兩個呼叫端從此共用這一支。要再加欄位，加在這裡就兩邊都有——不會再漂移。
 */
import { continuitySnapshotSchema } from "../../shared/continuity";
import { splitGenerationSourceMeta } from "../../shared/generationSourceMeta";
import type { schema } from "../db";
import type { ExecuteGenerationInput } from "./generationCommand";

/**
 * 從素材網址取回 assetId。
 *
 * 嚴格 UUID 形（8-4-4-4-12）：外部網址可能剛好含 `/api/assets/<36字>/file`，
 * 寬鬆比對抓到非 UUID 會讓 pg 的 uuid cast 直接 500——非 UUID 一律回 undefined，
 * 由呼叫端走 sourceUrl 原樣透傳。
 *
 * 放在 service 層而不是 router：兩個重試入口（web router 與 MCP service）都要用它，
 * 而 `server/services/**` 不得 import `server/routers/**`（check:boundaries 規則 3）。
 */
export function signedAssetId(url: string | null | undefined): string | undefined {
  return url?.match(/\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/file/i)?.[1];
}

export type SignedAssetIdFn = typeof signedAssetId;

/**
 * 把一筆失敗的 generation 列還原成「可以重送一次」的輸入。
 *
 * 回傳的是 `ExecuteGenerationInput` 去掉 auth/source/reasonPrefix 的部分——
 * 那三個由呼叫端決定（web vs mcp 的來源與帳本理由不同）。
 */
export function buildRetryGenerationInput(
  gen: typeof schema.generations.$inferSelect,
): Omit<ExecuteGenerationInput, "auth" | "source" | "reasonPrefix"> {
  const assetId = signedAssetId(gen.sourceUrl);
  const { meta } = splitGenerationSourceMeta(gen.params);
  const secondaryAssetId = signedAssetId(meta.secondarySourceUrl);
  const parsedSnapshot = continuitySnapshotSchema.safeParse(gen.continuitySnapshot);
  const lockedSnapshot = parsedSnapshot.success && parsedSnapshot.data.locked ? parsedSnapshot.data : undefined;

  return {
    projectId: gen.projectId,
    modelId: gen.modelId,
    prompt: gen.prompt,
    sourceAssetId: assetId,
    sourceUrl: assetId ? undefined : gen.sourceUrl ?? undefined,
    secondarySourceAssetId: secondaryAssetId,
    secondarySourceUrl: secondaryAssetId ? undefined : meta.secondarySourceUrl,
    characterIds: (gen.characterIds as string[] | null) ?? undefined,
    scenePresetIds: (gen.scenePresetIds as string[] | null) ?? undefined,
    propIds: (gen.propIds as string[] | null) ?? undefined,
    continuityMode: parsedSnapshot.success ? parsedSnapshot.data.locked : undefined,
    continuitySnapshot: lockedSnapshot,
    sceneId: gen.sceneId ?? undefined,
    /*
     * `generations` 沒有 lookIds 欄位，唯一的副本在 continuitySnapshot.characters[].lookId。
     * 快照沒鎖（locked=false）時不會整份沿用，此時若不另外把造型帶出來，
     * 重試就會以「重試當下」重建錨點而丟掉原本的造型——同一鏡重試一次就換了衣服。
     */
    lookIds: parsedSnapshot.success
      ? parsedSnapshot.data.characters
          .map((row) => row.lookId)
          .filter((id): id is string => !!id)
      : undefined,
    // 少了這個，重試失敗的旁白會把音訊寫進主畫面槽
    sceneRole: gen.sceneRole ?? undefined,
    // 少了這個，重試失敗的變體會變成會移動指標的生成
    preserveScenePointer: meta.preserveScenePointer,
    // 少了這個，重試出來的版本會脫離它原本的批次
    creative: meta.creative,
    // 少了這個，重試出來的圖會立刻被連戲檢查判成過時，採用時也還原不出當初那個方向
    shotDirection: parsedSnapshot.success ? parsedSnapshot.data.shotDirection ?? undefined : undefined,
    // 保留出處：工作流/代理步驟失敗後的重試仍能回溯原本那條 run
    workflowRunId: gen.workflowRunId ?? undefined,
    agentRunId: gen.agentRunId ?? undefined,
  };
}
