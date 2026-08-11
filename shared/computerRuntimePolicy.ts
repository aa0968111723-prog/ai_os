/**
 * Network / destination policy for Computer Runtime (PR-6A).
 * Fail-closed: private network, metadata, and unsafe schemes are blocked.
 */

import type { ComputerFailureCode } from "./computerRuntime";

const PRIVATE_HOST_EXACT = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

/** IPv4 private / link-local / metadata ranges (simplified CIDR checks). */
function ipv4Blocked(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + AWS metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isIpv6Local(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
}

export interface UrlPolicyResult {
  ok: boolean;
  code?: ComputerFailureCode;
  message?: string;
  sanitizedUrl?: string;
}

/**
 * Validate navigation destination. https only by default.
 * Blocks private IPs, metadata endpoints, non-http(s) schemes.
 */
export function validateComputerNavigationUrl(
  raw: string,
  opts?: { allowHttp?: boolean; domainAllowlist?: string[] },
): UrlPolicyResult {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2_000) {
    return { ok: false, code: "COMPUTER_UNSAFE_DESTINATION", message: "網址無效或過長" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, code: "COMPUTER_UNSAFE_DESTINATION", message: "網址格式不正確" };
  }

  const scheme = url.protocol.toLowerCase();
  if (scheme !== "https:" && !(opts?.allowHttp && scheme === "http:")) {
    return { ok: false, code: "COMPUTER_UNSAFE_DESTINATION", message: "只允許 https 網址" };
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    return { ok: false, code: "COMPUTER_UNSAFE_DESTINATION", message: "缺少主機名稱" };
  }
  if (PRIVATE_HOST_EXACT.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, code: "COMPUTER_NAVIGATION_BLOCKED", message: "禁止存取本機或內網主機" };
  }
  if (ipv4Blocked(host) || isIpv6Local(host)) {
    return { ok: false, code: "COMPUTER_NAVIGATION_BLOCKED", message: "禁止存取私有網路或雲端 metadata" };
  }
  // Block userinfo (https://user:pass@host) — credential leak risk
  if (url.username || url.password) {
    return { ok: false, code: "COMPUTER_UNSAFE_DESTINATION", message: "網址不得內嵌帳密" };
  }

  if (opts?.domainAllowlist?.length) {
    const allowed = opts.domainAllowlist.some((d) => {
      const dom = d.toLowerCase().replace(/^\./, "");
      return host === dom || host.endsWith(`.${dom}`);
    });
    if (!allowed) {
      return { ok: false, code: "COMPUTER_NAVIGATION_BLOCKED", message: "此網域不在允許清單" };
    }
  }

  // Sanitize: drop hash (often tokens), keep search for real pages
  url.hash = "";
  return { ok: true, sanitizedUrl: url.toString() };
}

/** Redact sensitive typed text from action logs. */
export function redactSensitiveActionText(
  text: string,
  sensitive?: boolean,
): { safeTarget: string; redacted: boolean } {
  if (sensitive) {
    return { safeTarget: "[redacted:sensitive_input]", redacted: true };
  }
  // Heuristic: long random-looking secrets
  if (/password|passwd|otp|token|secret|bearer/i.test(text) && text.length > 0) {
    return { safeTarget: "[redacted:possible_secret_field]", redacted: true };
  }
  if (text.length > 200) {
    return { safeTarget: `${text.slice(0, 80)}…[truncated]`, redacted: false };
  }
  return { safeTarget: text, redacted: false };
}

export function mapProviderErrorToCode(message: string): ComputerFailureCode {
  const m = message.toLowerCase();
  if (/timeout|timed out/.test(m)) return "COMPUTER_ACTION_TIMEOUT";
  if (/not found|no element|selector/.test(m)) return "COMPUTER_ELEMENT_NOT_FOUND";
  if (/rate|429|quota/.test(m)) return "COMPUTER_PROVIDER_RATE_LIMIT";
  if (/disconnect|closed|target closed/.test(m)) return "COMPUTER_SESSION_DISCONNECTED";
  if (/captcha|challenge/.test(m)) return "COMPUTER_CHALLENGE_REQUIRED";
  if (/login|sign in|auth/.test(m)) return "COMPUTER_LOGIN_REQUIRED";
  return "COMPUTER_PROVISION_FAILED";
}
