/**
 * Fill missing process.env keys from a local .env file.
 *
 * Production/platform env is the source of truth and is never overwritten.
 * Values are never logged. Only used so local `tsx` / vitest inherit the
 * same DATABASE_URL the operator already put in `.env`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadLocalEnv(cwd = process.cwd()): { loaded: boolean; filledKeys: number } {
  if (process.env.NODE_ENV === "production") return { loaded: false, filledKeys: 0 };
  const file = resolve(cwd, ".env");
  if (!existsSync(file)) return { loaded: false, filledKeys: 0 };
  try {
    const parsed = parseDotEnv(readFileSync(file, "utf8"));
    let filled = 0;
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
        filled += 1;
      }
    }
    return { loaded: true, filledKeys: filled };
  } catch {
    return { loaded: false, filledKeys: 0 };
  }
}
