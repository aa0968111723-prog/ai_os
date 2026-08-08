/** Bounded conversation context shared by project, group and global assistants. */
export type AssistantChatTurn = { role: "user" | "assistant"; text: string };

export function buildAssistantHistoryBlock(history: AssistantChatTurn[] | undefined): string {
  if (!history?.length) return "";
  const lines = history
    .slice(-6)
    .map((turn) => ({
      who: turn.role === "user" ? "使用者" : "助手",
      text: turn.text.trim().replace(/\s+/g, " ").slice(0, 400),
    }))
    .filter((turn) => turn.text.length > 0)
    .map((turn) => `${turn.who}：${turn.text}`);
  return lines.length ? `<先前對話>\n${lines.join("\n")}\n</先前對話>\n` : "";
}
