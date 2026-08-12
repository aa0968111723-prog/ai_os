/**
 * Live capability maturity inventory for the shared ASSISTANT_CAPABILITIES registry.
 *
 * Declared-in-catalog is never enough. Each entry records the strongest proven
 * verification layer. Planner and UI must treat anything below STAGING_VERIFIED
 * as unavailable for autonomous write paths.
 */
import { ASSISTANT_CAPABILITIES, type AssistantCapability } from "./assistantExecution";

export const CAPABILITY_MATURITY_LEVELS = [
  "DECLARED_ONLY",
  "MOCK_VERIFIED",
  "STAGING_VERIFIED",
  "EXTERNAL_LIVE_VERIFIED",
  "PRODUCTION_SMOKE_VERIFIED",
  "CERTIFIED",
  "DEGRADED",
  "BROKEN",
  "BLOCKED_BY_EXTERNAL_DEPENDENCY",
] as const;
export type CapabilityMaturityLevel = (typeof CAPABILITY_MATURITY_LEVELS)[number];

export interface CapabilityMaturityRecord {
  capabilityId: string;
  label: string;
  level: CapabilityMaturityLevel;
  /** Six-layer usability: declared → resolvable → reachable → executable → verifiable → useful */
  layers: {
    declared: boolean;
    resolvable: boolean;
    reachable: boolean;
    executable: boolean;
    verifiable: boolean;
    useful: boolean;
  };
  notes: string;
}

const LAYER_OK = {
  declared: true,
  resolvable: true,
  reachable: true,
  executable: true,
  verifiable: true,
  useful: true,
} as const;

/** Hand-audited maturity. Keep honest: mocks never become CERTIFIED. */
const OVERRIDES: Record<string, Partial<CapabilityMaturityRecord>> = {
  attach_asset_to_shot: {
    level: "STAGING_VERIFIED",
    layers: LAYER_OK,
    notes: "Server ACL + upsertContextBinding + DB read-back; ExecutionReceipt on global path.",
  },
  import_google_drive: {
    level: "PRODUCTION_SMOKE_VERIFIED",
    layers: { ...LAYER_OK, useful: true },
    notes: "Universal Intake Drive picker handoff; persistence verified via asset rows.",
  },
  import_local_file: {
    level: "PRODUCTION_SMOKE_VERIFIED",
    layers: LAYER_OK,
    notes: "File picker → secure store → asset row.",
  },
  import_folder: {
    level: "STAGING_VERIFIED",
    layers: LAYER_OK,
    notes: "Folder Import 2.0 session; resumable.",
  },
  import_url: {
    level: "PRODUCTION_SMOKE_VERIFIED",
    layers: LAYER_OK,
    notes: "SSRF-guarded fetch; job_registered verification.",
  },
  open_browser_runtime: {
    level: "MOCK_VERIFIED",
    layers: {
      declared: true,
      resolvable: true,
      reachable: true,
      executable: true,
      verifiable: true,
      useful: false,
    },
    notes: "mockBrowserProvider only. Never report as live browsing.",
  },
  inspect_computer_runtime: {
    level: "STAGING_VERIFIED",
    layers: LAYER_OK,
    notes: "Honest capability answer from runtime flags/provider.",
  },
  generate_media: {
    level: "PRODUCTION_SMOKE_VERIFIED",
    layers: LAYER_OK,
    notes: "generationCore + cost ledger; provider-dependent.",
  },
  create_task: {
    level: "PRODUCTION_SMOKE_VERIFIED",
    layers: LAYER_OK,
    notes: "taskCommand + project ACL.",
  },
  create_project: {
    level: "PRODUCTION_SMOKE_VERIFIED",
    layers: LAYER_OK,
    notes: "projectCore + group ACL.",
  },
  classify_asset: {
    level: "STAGING_VERIFIED",
    layers: LAYER_OK,
    notes: "intelligence.reprocess job registration.",
  },
  prepare_external_generation: {
    level: "BLOCKED_BY_EXTERNAL_DEPENDENCY",
    layers: {
      declared: true,
      resolvable: true,
      reachable: true,
      executable: false,
      verifiable: false,
      useful: false,
    },
    notes: "Depends on external tool + user return path.",
  },
};

function defaultFor(capability: AssistantCapability): CapabilityMaturityRecord {
  const override = OVERRIDES[capability.id];
  const write = capability.access === "WRITE";
  return {
    capabilityId: capability.id,
    label: capability.label,
    level: override?.level ?? (write ? "DECLARED_ONLY" : "STAGING_VERIFIED"),
    layers: override?.layers ?? {
      declared: true,
      resolvable: true,
      reachable: capability.direct,
      executable: capability.direct,
      verifiable: capability.verificationStrategy !== "none" || !write,
      useful: !write,
    },
    notes: override?.notes ?? (write
      ? "Catalog entry present; confirm live write+read-back before CERTIFIED."
      : "Read path available through assistant tools."),
  };
}

export function listCapabilityMaturity(): CapabilityMaturityRecord[] {
  return ASSISTANT_CAPABILITIES.map(defaultFor);
}

export function capabilityUsableForAutonomousWrite(capabilityId: string): boolean {
  const record = listCapabilityMaturity().find((item) => item.capabilityId === capabilityId);
  if (!record) return false;
  if (record.level === "BROKEN" || record.level === "BLOCKED_BY_EXTERNAL_DEPENDENCY" || record.level === "DECLARED_ONLY") {
    return false;
  }
  if (record.level === "MOCK_VERIFIED") return false;
  return record.layers.executable && record.layers.verifiable;
}

export function formatCapabilityMaturityReport(records = listCapabilityMaturity()): string {
  const lines = ["Capability maturity inventory", `total=${records.length}`];
  for (const record of records) {
    const layers = Object.entries(record.layers)
      .filter(([, ok]) => ok)
      .map(([name]) => name)
      .join(",");
    lines.push(`[${record.level}] ${record.capabilityId} layers=${layers || "none"} — ${record.notes}`);
  }
  return lines.join("\n");
}
