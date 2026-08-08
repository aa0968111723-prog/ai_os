/**
 * #274：只接受同源站內路徑的共用防線。
 * 條件：`/` 開頭、非 `//`（協議相對 URL，`//evil.example`）、不含反斜線（瀏覽器在部分
 * URL 解析情境會把 `\` 當 `/`）、不含控制字元。
 * 與 desktopBridge.normalizeAiosInternalPath 同級，供 AppShell（SW aios:navigate）／
 * SessionGate（returnTo next）共用，避免各處只擋 `startsWith("/")` 留下 open-redirect 差異。
 */

/** 是否含控制字元（C0 0x00–0x1F 與 0x7F DEL）。用 charCodeAt 判斷，避免 regex 逸位字元在原始碼中造成困擾。 */
export function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function safeInternalPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (hasControlChar(raw)) return null;

  // Validate the decoded form as well. Browsers and intermediaries may decode a
  // redirect target after this guard, so `/%2f%2fevil.example` must be treated
  // exactly like `//evil.example`. Repeat a small, fixed number of times to
  // cover nested encoding without turning malformed escapes into exceptions.
  let decoded = raw;
  for (let pass = 0; pass < 3; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || hasControlChar(next)) {
      return null;
    }
    if (next === decoded) break;
    decoded = next;
  }
  return raw;
}
