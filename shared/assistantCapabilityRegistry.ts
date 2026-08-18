import type { AssistantIntent } from "./assistantExecution";
import type { AssistantWirePageContext } from "./assistantPageContext";
import { MCP_TOOLS, type McpToolInfo } from "./mcpCatalog";

export interface AssistantCapabilitySelection {
  intent: AssistantIntent;
  pageContext?: AssistantWirePageContext;
  allowWrite: boolean;
  maxTools?: number;
}

const PAGE_TERMS: Partial<Record<AssistantWirePageContext["pageType"], string[]>> = {
  project: ["project", "status", "knowledge", "decision", "note", "task", "character"],
  story: ["knowledge", "worldview", "scene", "character"],
  storyboard: ["scene", "asset", "generation", "character", "prop"],
  production: ["generation", "asset", "scene", "model"],
  final: ["generation", "asset", "project"],
  assets: ["asset", "generation", "upload", "adobe"],
  tasks: ["task", "agent", "approval"],
  notes: ["note", "knowledge", "decision"],
  schedule: ["schedule"],
  database: ["database", "file"],
  agent_run: ["agent", "approval", "task"],
  collab: ["agent", "task", "message", "dm", "approval"],
  chat: ["message", "dm"],
  /** Animation Studio shares the project assistant (pageType=studio, entityType=shot). Include shot; omit prop (not the studio main path). */
  studio: ["scene", "shot", "character", "generation", "asset"],
};

/** Studio already injects story + current shot; this tool just re-dumps the project. */
const STUDIO_EXCLUDED_TOOLS = new Set(["get_project_context"]);

function isRelevant(tool: McpToolInfo, terms: string[]): boolean {
  const haystack = `${tool.name} ${tool.title} ${tool.blurb}`.toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

/**
 * Project the existing MCP single source of truth into a bounded model-facing catalog.
 * Permissions only remove capabilities here; every eventual call still re-checks ACL.
 */
export function selectAssistantCapabilities(input: AssistantCapabilitySelection): McpToolInfo[] {
  const maxTools = Math.min(Math.max(input.maxTools ?? 18, 1), 30);
  const pageTerms = input.pageContext ? PAGE_TERMS[input.pageContext.pageType] ?? [] : [];
  const intentTerms: string[] = input.intent === "PLAN"
    ? ["agent", "project", "status", "task", "scene", "generation", "knowledge"]
    : input.intent === "AGENT"
      ? ["agent", "project", "scene", "generation", "knowledge"]
    : input.intent === "WATCH"
      ? ["status", "agent", "generation", "task", "schedule", "approval"]
      : [];
  const terms = [...new Set([...pageTerms, ...intentTerms])];
  const visible = MCP_TOOLS.filter((tool) => input.allowWrite || tool.access === "read");
  const relevant = terms.length ? visible.filter((tool) => isRelevant(tool, terms)) : visible.filter((tool) => [
    "get_project_context", "get_project_status", "list_knowledge", "list_notes", "list_tasks",
  ].includes(tool.name));
  const scoped = input.pageContext?.pageType === "studio"
    ? relevant.filter((tool) => !STUDIO_EXCLUDED_TOOLS.has(tool.name))
    : relevant;
  const pinAddCharacter = input.allowWrite && pageTerms.includes("character");
  const readFirst = scoped.sort((a, b) => Number(a.access === "write") - Number(b.access === "write"));
  const pinned = pinAddCharacter ? readFirst.filter((tool) => tool.name === "add_character") : [];
  const rest = readFirst.filter((tool) => tool.name !== "add_character");
  const room = Math.max(0, maxTools - pinned.length);
  return [...rest.slice(0, room), ...pinned].slice(0, maxTools);
}
