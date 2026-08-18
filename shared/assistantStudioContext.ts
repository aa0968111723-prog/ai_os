/** Compact studio prompt: current shot + bound characters only. Do not dump the whole project. */
export function formatStudioShotContext(input: {
  projectTitle: string;
  kind: string;
  format: string;
  displayNo: number;
  shot: {
    title: string;
    orderIndex: number;
    durationSec: number;
    prompt?: string | null;
    voiceover?: string | null;
    dialogue?: string | null;
    action?: string | null;
  };
  characters: readonly { name: string; appearance: string }[];
  /** Server-persisted story — studio still needs the saved script, not only this shot. */
  storyText?: string | null;
}): string {
  const chars = input.characters.length
    ? input.characters.map((c) => `- ${c.name}｜${c.appearance}`).join("\n")
    : "（這一鏡尚未綁角色）";
  const story = (input.storyText ?? "").trim();
  const storyBlock = story
    ? `故事全文：\n${story.length > 4_000 ? `${story.slice(0, 4_000)}…[truncated]` : story}\n`
    : "";
  return `標題：${input.projectTitle}（${input.kind}，${input.format}）
${storyBlock}目前鏡頭：第 ${input.displayNo} 鏡「${input.shot.title}」（orderIndex=${input.shot.orderIndex}，${input.shot.durationSec} 秒）
畫面提示：${input.shot.prompt || "（未填）"}
旁白/OS：${input.shot.voiceover || "（未填）"}
對白：${input.shot.dialogue || "（未填）"}
動作：${input.shot.action || "（未填）"}
綁定角色：
${chars}
分鏡編號 sceneNo 一律用上面的顯示鏡號（orderIndex 排序後的第 N 鏡），不要用陣列下標。不要呼叫 get_project_context 重倒全專案。需要其他鏡時用 read_scene。不要說看不到「你的故事」——故事全文若在上面就直接用。`;
}
