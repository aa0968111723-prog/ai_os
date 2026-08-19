/**
 * Shot Context Builder（PE 計畫 §11）：把「這一鏡獨有」的上下文疊到畫面描述上。
 * 組裝順序＝繼承順序：Scene State（所屬場的天氣/時間/氛圍）→ 鏡頭語言 → 表演 → 造型鎖定。
 * Project 風格（worldview）與角色/場景/道具錨點不在這裡——generationCore 既有機制會注入，
 * 這裡重複加只會把提示詞灌爆（Cost Control guardrail）。
 *
 * generateInto / generateVariants / batchGenerate 早已走這支。MCP generate_into_scene
 * 與 animationPipeline 曾退回 raw `scene.prompt ?? title` / `shot.prompt`，鏡頭語言
 * 與場景狀態就從那兩條入口掉了。抽出來讓三條入口共用，不另寫一份 prompt 格式。
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { sceneVisualPrompt } from "../../shared/sceneVersions";
import { formatEnvironmentState, formatShotDirection } from "../../shared/story";

export type ShotContextScene = Pick<
  typeof schema.scenes.$inferSelect,
  "prompt" | "action" | "storySceneId" | "camera" | "performance"
>;

export async function buildShotContextPrompt(
  scene: ShotContextScene,
  model: Parameters<typeof sceneVisualPrompt>[1],
): Promise<string> {
  const base = sceneVisualPrompt(scene, model);
  if (!base.trim()) return base;
  const parts: string[] = [base];

  if (scene.storySceneId) {
    const [storyScene] = await db.select().from(schema.storyScenes).where(eq(schema.storyScenes.id, scene.storySceneId));
    const envText = storyScene ? formatEnvironmentState(storyScene.environment) : "";
    if (envText) parts.push(`[場景狀態] ${envText}`);
  }

  const direction = formatShotDirection(scene.camera, scene.performance);
  if (direction) parts.push(`[鏡頭語言] ${direction}`);

  // 造型（Look）不在這裡注入：它已經提到 generationCore 的錨點層，
  // 與角色身份併成同一句「外觀鎖定 安倢：…，造型鎖定：米白外套」（見 cardAnchors.formatCharacterAnchor）。
  // 在這裡再寫一次會變成同一件衣服講兩遍，對擴散模型是雜訊不是加強。

  return parts.join("\n\n");
}
