/**
 * 深度（Deepin／UOS）、CUTOS 與 Aios_b（Sentinel）的連結契約。
 *
 * 這份檔案是三方共用的唯一真相：Aios 認哪種 UA、握手端點回什麼、
 * Sentinel 要用哪些環境變數、管理頁怎麼講「連上了沒」。
 * Aios_b 目前只掃 web／app／desktop 三端；深度與 CUTOS 在這邊先建模成
 * **夥伴作業系統**，各自對應一條可覆寫的目標網址與 UA 人格。
 * 沒設目標＝未連結，不是故障——跟沒填 FAL_KEY 一樣，必須講清楚，不能裝綠燈。
 */

export const OS_PARTNER_CONTRACT_VERSION = 1 as const;

/** 姊妹倉：Aios Sentinel（https://github.com/aa0968111723-prog/Aios_b） */
export const AIOS_B_REPO = {
  id: "aios_b",
  name: "Aios Sentinel",
  github: "https://github.com/aa0968111723-prog/Aios_b",
  packageName: "aios-sentinel",
  defaultTarget: "https://example.test/aios",
} as const;

/**
 * Aios 既有三端（與 Aios_b `SurfaceId` 對齊）。
 * App／桌面都是 WebView 載同一個站，分開掃是因為伺服器可能依 UA 走不同分支。
 */
export const AIOS_SENTINEL_SURFACES = ["web", "app", "desktop"] as const;
export type AiosSentinelSurface = (typeof AIOS_SENTINEL_SURFACES)[number];

/** 夥伴作業系統。深度＝Deepin／統信 UOS；CUTOS＝邊緣智能 OS 的 LWA 容器。 */
export const OS_PARTNER_IDS = ["deepin", "cutos"] as const;
export type OsPartnerId = (typeof OS_PARTNER_IDS)[number];

/** 殼層在 UA 尾巴掛的識別字——跟 Capacitor 的 `AiosApp/1.0` 同一套做法。 */
export const OS_PARTNER_UA_TOKEN = {
  app: "AiosApp/1.0",
  desktop: "Tauri/2.0",
  deepin: "AiosDeepin/1.0",
  cutos: "AiosCutos/1.0",
} as const;

export const OS_PARTNER_ENV = {
  sentinelRepo: "AIOS_B_REPO",
  sentinelReport: "AIOS_SENTINEL_REPORT",
  deepinTarget: "AIOS_DEEPIN_TARGET",
  cutosTarget: "AIOS_CUTOS_TARGET",
  webTarget: "AIOS_WEB_TARGET",
  appTarget: "AIOS_APP_TARGET",
  desktopTarget: "AIOS_DESKTOP_TARGET",
  target: "AIOS_TARGET",
  gate: "OS_PARTNER_GATE",
} as const;

export interface OsPartnerDefinition {
  id: OsPartnerId;
  /** 給人看的短名 */
  label: string;
  /** 產品全名 */
  product: string;
  /** 對應 Aios_b 的哪一端人格（深度走桌面 WebView；CUTOS 走 LWA＝網站人格＋自訂 UA） */
  mapsToSurface: AiosSentinelSurface;
  uaToken: string;
  targetEnv: string;
  /** 官方說明（對外連結，不是密鑰） */
  docsUrl: string;
  summary: string;
}

export const OS_PARTNER_DEFINITIONS: readonly OsPartnerDefinition[] = [
  {
    id: "deepin",
    label: "深度",
    product: "Deepin / 統信 UOS",
    mapsToSurface: "desktop",
    uaToken: OS_PARTNER_UA_TOKEN.deepin,
    targetEnv: OS_PARTNER_ENV.deepinTarget,
    docsUrl: "https://www.deepin.org/",
    summary: "深度桌面以 WebView 載入同一個 Aios 站；UA 須帶 AiosDeepin/1.0，Sentinel 用桌面端人格掃。",
  },
  {
    id: "cutos",
    label: "CUTOS",
    product: "CUTOS 邊緣智能 OS（LWA）",
    mapsToSurface: "web",
    uaToken: OS_PARTNER_UA_TOKEN.cutos,
    targetEnv: OS_PARTNER_ENV.cutosTarget,
    docsUrl: "https://www.cut-os.com/",
    summary: "CUTOS Node 把 Aios 當 Local Web App 部署；UA 須帶 AiosCutos/1.0，Sentinel 用網站端人格掃。",
  },
] as const;

export const OS_PARTNER_HANDSHAKE_PATH = "/api/os-partners";

export type OsPartnerLinkState = "linked" | "unconfigured" | "invalid";

export interface OsPartnerLink {
  id: OsPartnerId;
  label: string;
  product: string;
  mapsToSurface: AiosSentinelSurface;
  uaToken: string;
  state: OsPartnerLinkState;
  /** 已設目標時只回「已設定」，不回實際網址——公開握手不能洩內部部署。 */
  targetConfigured: boolean;
  note: string;
}

export interface AiosBLink {
  id: typeof AIOS_B_REPO.id;
  name: typeof AIOS_B_REPO.name;
  github: typeof AIOS_B_REPO.github;
  state: OsPartnerLinkState;
  repoConfigured: boolean;
  reportConfigured: boolean;
  note: string;
}

export type SentinelSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface SentinelReportSummary {
  target: string;
  surfaces: string[];
  findings: Partial<Record<SentinelSeverity, number>>;
  worst: SentinelSeverity | null;
  completed: number;
  skipped: number;
  errored: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface OsPartnerSnapshot {
  contractVersion: typeof OS_PARTNER_CONTRACT_VERSION;
  aiosB: AiosBLink;
  partners: OsPartnerLink[];
  /** 任一端已設目標或已指到 Sentinel 倉＝有在用這條連結 */
  anyLinked: boolean;
  /** 設了 OS_PARTNER_GATE=1 且必要端未連結時為 true；預設不擋就緒 */
  gateFails: boolean;
  report: SentinelReportSummary | null;
}

const EMPTY_FINDINGS: Record<SentinelSeverity, number> = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
};

export function isOsPartnerId(value: string): value is OsPartnerId {
  return (OS_PARTNER_IDS as readonly string[]).includes(value);
}

export function isAiosSentinelSurface(value: string): value is AiosSentinelSurface {
  return (AIOS_SENTINEL_SURFACES as readonly string[]).includes(value);
}

/** 去掉尾斜線；空字串／空白＝沒設。 */
export function normalizePartnerTarget(raw: string | undefined | null): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  return value.replace(/\/+$/, "");
}

/**
 * 只接受 http(s) 絕對網址。握手與腳本都走這條，避免把 `javascript:` 或相對路徑當目標。
 */
export function parsePartnerTargetUrl(raw: string | undefined | null):
  | { ok: true; url: string }
  | { ok: false; reason: string } {
  const normalized = normalizePartnerTarget(raw);
  if (!normalized) return { ok: false, reason: "未設定" };
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, reason: "只接受 http 或 https" };
    }
    if (!url.hostname) return { ok: false, reason: "網址沒有主機名" };
    return { ok: true, url: url.toString().replace(/\/+$/, "") };
  } catch {
    return { ok: false, reason: "不是合法網址" };
  }
}

export function partnerDefinition(id: OsPartnerId): OsPartnerDefinition {
  const found = OS_PARTNER_DEFINITIONS.find((item) => item.id === id);
  if (!found) throw new Error(`未知作業系統夥伴：${id}`);
  return found;
}

export function linkStateForTarget(raw: string | undefined | null): {
  state: OsPartnerLinkState;
  targetConfigured: boolean;
  note: string;
} {
  if (!normalizePartnerTarget(raw)) {
    return { state: "unconfigured", targetConfigured: false, note: "未設定目標網址（選用，不擋就緒）" };
  }
  const parsed = parsePartnerTargetUrl(raw);
  if (!parsed.ok) {
    return { state: "invalid", targetConfigured: true, note: `目標網址無效：${parsed.reason}` };
  }
  return { state: "linked", targetConfigured: true, note: "已設定目標網址" };
}

export function linkAiosB(env: NodeJS.Dict<string>): AiosBLink {
  const repo = env[OS_PARTNER_ENV.sentinelRepo]?.trim();
  const report = env[OS_PARTNER_ENV.sentinelReport]?.trim();
  const repoConfigured = Boolean(repo);
  const reportConfigured = Boolean(report);
  let state: OsPartnerLinkState = "unconfigured";
  let note = "未指向 Aios_b 倉（設 AIOS_B_REPO 或把 Aios_b 放在隔壁目錄）";
  if (repoConfigured || reportConfigured) {
    state = "linked";
    const bits = [
      repoConfigured ? "已指向 Sentinel 倉" : null,
      reportConfigured ? "已指定最近一份報告" : null,
    ].filter(Boolean);
    note = bits.join("；");
  }
  return {
    id: AIOS_B_REPO.id,
    name: AIOS_B_REPO.name,
    github: AIOS_B_REPO.github,
    state,
    repoConfigured,
    reportConfigured,
    note,
  };
}

export function linkPartners(env: NodeJS.Dict<string>): OsPartnerLink[] {
  return OS_PARTNER_DEFINITIONS.map((def) => {
    const target = linkStateForTarget(env[def.targetEnv]);
    return {
      id: def.id,
      label: def.label,
      product: def.product,
      mapsToSurface: def.mapsToSurface,
      uaToken: def.uaToken,
      state: target.state,
      targetConfigured: target.targetConfigured,
      note: target.note,
    };
  });
}

/**
 * 從 Aios_b 的 report.json 抽出摘要。形狀不對就回 null——壞掉的報告不能被講成「沒問題」。
 */
export function summarizeSentinelReport(raw: unknown): SentinelReportSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const report = raw as Record<string, unknown>;
  const summary = report.summary;
  if (!summary || typeof summary !== "object") return null;
  const bag = summary as Record<string, unknown>;
  const findingsRaw = bag.findings;
  const findings: Partial<Record<SentinelSeverity, number>> = {};
  if (findingsRaw && typeof findingsRaw === "object") {
    for (const key of Object.keys(EMPTY_FINDINGS) as SentinelSeverity[]) {
      const n = (findingsRaw as Record<string, unknown>)[key];
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) findings[key] = n;
    }
  }
  const surfaces = Array.isArray(report.surfaces)
    ? report.surfaces.filter((item): item is string => typeof item === "string")
    : [];
  const worst = typeof bag.worst === "string" && bag.worst in EMPTY_FINDINGS
    ? (bag.worst as SentinelSeverity)
    : null;
  return {
    target: typeof report.target === "string" ? report.target : "",
    surfaces,
    findings,
    worst,
    completed: typeof bag.completed === "number" ? bag.completed : 0,
    skipped: typeof bag.skipped === "number" ? bag.skipped : 0,
    errored: typeof bag.errored === "number" ? bag.errored : 0,
    startedAt: typeof report.startedAt === "string" ? report.startedAt : undefined,
    finishedAt: typeof report.finishedAt === "string" ? report.finishedAt : undefined,
  };
}

export function buildOsPartnerSnapshot(
  env: NodeJS.Dict<string>,
  report: SentinelReportSummary | null = null,
): OsPartnerSnapshot {
  const aiosB = linkAiosB(env);
  const partners = linkPartners(env);
  const anyLinked =
    aiosB.state === "linked" || partners.some((item) => item.state === "linked");
  const gateOn = env[OS_PARTNER_ENV.gate] === "1";
  const gateFails = gateOn && (
    aiosB.state !== "linked" ||
    partners.some((item) => item.state !== "linked")
  );
  return {
    contractVersion: OS_PARTNER_CONTRACT_VERSION,
    aiosB,
    partners,
    anyLinked,
    gateFails,
    report,
  };
}

/** 公開握手：只回契約與「有沒有設」，不回網址、路徑、報告內容。 */
export function publicOsPartnerHandshake(snapshot: OsPartnerSnapshot): {
  contractVersion: typeof OS_PARTNER_CONTRACT_VERSION;
  product: "Aios";
  handshake: typeof OS_PARTNER_HANDSHAKE_PATH;
  sister: { id: string; name: string; github: string; linked: boolean };
  partners: Array<{
    id: OsPartnerId;
    label: string;
    product: string;
    mapsToSurface: AiosSentinelSurface;
    uaToken: string;
    linked: boolean;
    docsUrl: string;
  }>;
  surfaces: readonly AiosSentinelSurface[];
  uaTokens: typeof OS_PARTNER_UA_TOKEN;
} {
  return {
    contractVersion: snapshot.contractVersion,
    product: "Aios",
    handshake: OS_PARTNER_HANDSHAKE_PATH,
    sister: {
      id: snapshot.aiosB.id,
      name: snapshot.aiosB.name,
      github: snapshot.aiosB.github,
      linked: snapshot.aiosB.state === "linked",
    },
    partners: snapshot.partners.map((item) => {
      const def = partnerDefinition(item.id);
      return {
        id: item.id,
        label: item.label,
        product: item.product,
        mapsToSurface: item.mapsToSurface,
        uaToken: item.uaToken,
        linked: item.state === "linked",
        docsUrl: def.docsUrl,
      };
    }),
    surfaces: AIOS_SENTINEL_SURFACES,
    uaTokens: OS_PARTNER_UA_TOKEN,
  };
}

/** /api/ready 的觀察欄：不參與 503，只讓管理員一眼看到連結狀態。 */
export function readyPartnersNote(snapshot: OsPartnerSnapshot): { ok: boolean; note: string } {
  if (snapshot.gateFails) {
    const missing = [
      snapshot.aiosB.state !== "linked" ? "Aios_b" : null,
      ...snapshot.partners.filter((item) => item.state !== "linked").map((item) => item.label),
    ].filter(Boolean);
    return { ok: false, note: `gate：尚未連結 ${missing.join("、")}` };
  }
  const linked = [
    snapshot.aiosB.state === "linked" ? "Aios_b" : null,
    ...snapshot.partners.filter((item) => item.state === "linked").map((item) => item.label),
  ].filter(Boolean);
  if (linked.length === 0) {
    return { ok: true, note: "observe（深度／CUTOS／Aios_b 皆未設定，選用）" };
  }
  return { ok: true, note: `observe（已連結 ${linked.join("、")}）` };
}

/** Sentinel CLI 參數：把夥伴目標譯成 Aios_b 已經認得的環境變數。 */
export function sentinelEnvOverrides(env: NodeJS.Dict<string>): Record<string, string> {
  const out: Record<string, string> = {};
  const deepin = parsePartnerTargetUrl(env[OS_PARTNER_ENV.deepinTarget]);
  const cutos = parsePartnerTargetUrl(env[OS_PARTNER_ENV.cutosTarget]);
  if (deepin.ok) out[OS_PARTNER_ENV.desktopTarget] = deepin.url;
  if (cutos.ok) out[OS_PARTNER_ENV.webTarget] = cutos.url;
  return out;
}
