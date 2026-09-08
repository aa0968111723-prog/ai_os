import { readFileSync } from "node:fs";
import { agentToolRegistry } from "./agentToolRegistry";

export const AGENT_SCHEMA_VERSION = "0070_agent_live_certification";

export interface DeploymentIdentity {
  sha: string | null;
  builtAt: string | null;
  appVersion: string;
  schemaVersion: string;
  capabilityRegistryHash: string;
}

/**
 * P2 SHA 缺口硬化（缺陷 53e839195f439836b92298e8 的追溯側）。
 * Dockerfile 已在建置時把解析到的 SHA 寫進 /app/BUILD_SHA，但舊映像
 * 是在那行加上去之前建的——env 全空時 health 就回 sha=null，前端
 * 拿不到版本、QA 對不上線上是哪個 commit。
 * 讀檔是唯讀 fallback：值仍以 env 為準，檔不存在／不可讀就回 null。
 */
let cachedFileSha: string | null | undefined;
function deploymentShaFromFile(): string | null {
  if (cachedFileSha !== undefined) return cachedFileSha;
  try {
    const sha = readFileSync("/app/BUILD_SHA", "utf8").trim();
    cachedFileSha = sha || null;
  } catch {
    cachedFileSha = null;
  }
  return cachedFileSha;
}

/** 測試用：清掉 /app/BUILD_SHA 快取 */
export function resetDeploymentShaFileCacheForTest(): void {
  cachedFileSha = undefined;
}

export function deploymentShaFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.BUILD_SHA,
    env.ZEABUR_GIT_COMMIT,
    env.ZEABUR_COMMIT_SHA,
    env.ZB_GIT_COMMIT,
    env.GITHUB_SHA,
    env.GIT_SHA,
    env.VERCEL_GIT_COMMIT_SHA,
    env.RAILWAY_GIT_COMMIT_SHA,
    env.COMMIT_SHA,
    env.SOURCE_VERSION,
  ];
  for (const value of candidates) {
    const sha = value?.trim();
    if (sha) return sha;
  }
  return deploymentShaFromFile();
}

export function currentDeploymentIdentity(env: NodeJS.ProcessEnv = process.env): DeploymentIdentity {
  return {
    sha: deploymentShaFromEnv(env),
    builtAt: env.BUILD_TIME || env.ZEABUR_BUILD_TIME || null,
    appVersion: env.APP_VERSION || env.npm_package_version || "0.1.0",
    schemaVersion: AGENT_SCHEMA_VERSION,
    capabilityRegistryHash: agentToolRegistry.registryHash(),
  };
}

export function deploymentDrift(expected: Partial<DeploymentIdentity>, actual: DeploymentIdentity) {
  const mismatches = (Object.keys(expected) as Array<keyof DeploymentIdentity>).flatMap((key) => {
    const wanted = expected[key];
    return wanted != null && wanted !== actual[key] ? [{ key, expected: wanted, actual: actual[key] }] : [];
  });
  return { ok: mismatches.length === 0, state: mismatches.length ? "DEPLOYMENT_DRIFT" as const : "MATCH" as const, mismatches };
}
