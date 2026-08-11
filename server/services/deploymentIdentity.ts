import { agentToolRegistry } from "./agentToolRegistry";

export const AGENT_SCHEMA_VERSION = "0070_agent_live_certification";

export interface DeploymentIdentity {
  sha: string | null;
  builtAt: string | null;
  appVersion: string;
  schemaVersion: string;
  capabilityRegistryHash: string;
}

export function currentDeploymentIdentity(env: NodeJS.ProcessEnv = process.env): DeploymentIdentity {
  return {
    sha: env.BUILD_SHA || env.ZEABUR_GIT_COMMIT || env.COMMIT_SHA || null,
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
