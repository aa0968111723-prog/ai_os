/**
 * 載入 docs/model-audit/contracts/current.json（模型契約快照）。
 * 檔案不存在時回 null——生成／MCP 降級為無健康提示，不阻斷。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  type ModelContractSnapshot,
  type ModelContractRow,
  findContractRow,
  contractSoftWarning,
  contractHardBlock,
} from "../../shared/modelContract";

let cached: { at: number; snap: ModelContractSnapshot | null } = { at: 0, snap: null };
const TTL_MS = 30_000;

function contractsPath(): string {
  return join(process.cwd(), "docs/model-audit/contracts/current.json");
}

export function loadModelContractSnapshot(force = false): ModelContractSnapshot | null {
  const now = Date.now();
  if (!force && cached.snap && now - cached.at < TTL_MS) return cached.snap;
  const path = contractsPath();
  if (!existsSync(path)) {
    cached = { at: now, snap: null };
    return null;
  }
  try {
    const snap = JSON.parse(readFileSync(path, "utf8")) as ModelContractSnapshot;
    cached = { at: now, snap };
    return snap;
  } catch {
    cached = { at: now, snap: null };
    return null;
  }
}

export function getModelContract(modelId: string): ModelContractRow | null {
  return findContractRow(loadModelContractSnapshot(), modelId);
}

export function modelContractSoftWarning(modelId: string): string | null {
  return contractSoftWarning(getModelContract(modelId));
}

export function modelContractHardBlock(modelId: string): string | null {
  return contractHardBlock(getModelContract(modelId));
}

/** 測試用：清快取 */
export function clearModelContractCache(): void {
  cached = { at: 0, snap: null };
}
