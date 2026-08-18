/**
 * 從本倉呼叫隔壁的 Aios_b（Aios Sentinel）。
 *
 * 沒找到倉就結束碼 3——跟 Sentinel 自己「什麼都沒測到」同一號，
 * 避免 CI 把「沒裝姊妹倉」講成「檢測通過」。
 *
 *   npm run sentinel
 *   npm run sentinel -- scan --fail-on medium
 */
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AIOS_B_REPO,
  OS_PARTNER_ENV,
  OS_PARTNER_UA_TOKEN,
  parsePartnerTargetUrl,
  sentinelEnvOverrides,
} from "../shared/osPartnerLink";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function resolveAiosBRepo(): Promise<string | null> {
  const fromEnv = process.env[OS_PARTNER_ENV.sentinelRepo]?.trim();
  const candidates = [
    fromEnv,
    path.resolve(ROOT, "..", "Aios_b"),
    path.resolve(ROOT, "Aios_b"),
  ].filter((item): item is string => Boolean(item));
  for (const dir of candidates) {
    if (await exists(path.join(dir, "package.json"))) return dir;
  }
  return null;
}

function printContract(): void {
  process.stdout.write(
    [
      `Aios → ${AIOS_B_REPO.name}（${AIOS_B_REPO.github}）`,
      `深度 UA：${OS_PARTNER_UA_TOKEN.deepin}　CUTOS UA：${OS_PARTNER_UA_TOKEN.cutos}`,
      `握手：${process.env.AIOS_TARGET ?? "本機 /api/os-partners"}`,
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const forwarded = process.argv.slice(2);
  const repo = await resolveAiosBRepo();
  if (!repo) {
    process.stderr.write(
      [
        "找不到 Aios_b。請擇一：",
        `  1. 把 ${AIOS_B_REPO.github} clone 到 ${path.resolve(ROOT, "..", "Aios_b")}`,
        `  2. 設 ${OS_PARTNER_ENV.sentinelRepo}=/path/to/Aios_b`,
        "",
        "結束碼 3＝沒測到，不是通過。",
        "",
      ].join("\n"),
    );
    process.exit(3);
  }

  printContract();
  const overrides = sentinelEnvOverrides(process.env);
  const extra: string[] = [];
  if (parsePartnerTargetUrl(process.env[OS_PARTNER_ENV.deepinTarget]).ok) {
    extra.push("深度目標 → AIOS_DESKTOP_TARGET");
  }
  if (parsePartnerTargetUrl(process.env[OS_PARTNER_ENV.cutosTarget]).ok) {
    extra.push("CUTOS 目標 → AIOS_WEB_TARGET");
  }
  if (extra.length) process.stdout.write(`夥伴覆寫：${extra.join("；")}\n`);

  const args = forwarded.length > 0 ? forwarded : ["all"];
  const child = spawn("npm", ["run", "sentinel", "--", ...args, "--repo", ROOT], {
    cwd: repo,
    stdio: "inherit",
    env: {
      ...process.env,
      ...overrides,
      AIOS_REPO: process.env.AIOS_REPO ?? ROOT,
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 2);
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`sentinel 橋接失敗：${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(2);
});
