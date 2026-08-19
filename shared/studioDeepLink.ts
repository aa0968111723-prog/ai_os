/**
 * 動畫創作室 deep-link.
 *
 * Canonical path is `/studio/:projectId`. Live leftovers still open
 * `/studio?project=<id>` (bookmarks, assistant, overnight notes).
 * Both must open that project — the query form is not a picker.
 */

const PROJECT_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function asSearch(search: string): string {
  if (!search) return "";
  return search.startsWith("?") ? search.slice(1) : search;
}

export function studioProjectIdFromLocation(path: string, search = ""): string | null {
  const [pathname, pathQuery] = path.split("?");
  const fromPath = /^\/studio\/([0-9a-fA-F-]{36})(?:\/|$)/.exec(pathname ?? "");
  if (fromPath && PROJECT_UUID.test(fromPath[1]!)) return fromPath[1]!;
  if (pathname !== "/studio") return null;
  const id = new URLSearchParams(asSearch(search) || pathQuery || "").get("project")?.trim() ?? "";
  return PROJECT_UUID.test(id) ? id : null;
}

export function studioCanonicalPath(projectId: string): string {
  return `/studio/${projectId}`;
}
