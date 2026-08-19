/**
 * Dashboard date chip must follow the user's calendar, not UTC leftover.
 * Live painted 8月18日星期二 after midnight Asia/Taipei (already 8月19).
 *
 * UTC / Etc/UTC is a VM leftover — treat Asia/Taipei as the product user TZ.
 * A real browser TZ (America/Los_Angeles, Asia/Tokyo, …) is kept.
 */

export const PRODUCT_USER_TIME_ZONE = "Asia/Taipei";

export function resolveUserTimeZone(resolved?: string | null): string {
  const tz = (
    resolved
    ?? (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "")
    ?? ""
  ).trim();
  if (!tz || tz === "UTC" || tz === "Etc/UTC" || tz === "Etc/GMT") return PRODUCT_USER_TIME_ZONE;
  return tz;
}

export function formatDashboardDateChip(
  now: Date = new Date(),
  timeZone: string = resolveUserTimeZone(),
): string {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone,
  }).format(now).replace(/\s+/g, "");
}
