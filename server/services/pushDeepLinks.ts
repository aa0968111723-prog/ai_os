/** Shared deep-link builders for Web Push notification click targets. */
export function projectFocusUrl(projectId: string, focus: string): string {
  return `/p/${projectId}?focus=${encodeURIComponent(focus)}`;
}

export function projectUrl(projectId: string): string {
  return `/p/${projectId}`;
}
