/**
 * Commercial-use evidence + risk assessment.
 *
 * This is not a legal opinion and not a court-search system.
 * Decisions say whether Aios currently has enough evidence to use an asset
 * for a named purpose — commercial generation and training stay separate.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

export const RIGHTS_DECISION_VERSION = "commercial-rights.v1";

export const RIGHTS_SOURCE_TYPES = [
  "USER_OWNED",
  "TEAM_OWNED",
  "CLIENT_PROVIDED",
  "STOCK_MEDIA",
  "CREATIVE_COMMONS",
  "PUBLIC_DOMAIN",
  "WEB_UNKNOWN",
  "AI_GENERATED",
  "GENERATED_BY_AIOS",
  "THIRD_PARTY_AI",
  "LICENSED_BRAND_ASSET",
  "UNKNOWN",
] as const;
export type RightsSourceType = (typeof RIGHTS_SOURCE_TYPES)[number];

export const RIGHTS_STATUSES = ["CLEAR", "CONDITIONAL", "REVIEW_REQUIRED", "BLOCKED", "UNKNOWN"] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

export const RIGHTS_USAGE_CONTEXTS = [
  "internal_reference",
  "commercial_final",
  "social_advertisement",
  "youtube_monetization",
  "client_delivery",
  "ai_training",
  "team_canon_training",
] as const;
export type RightsUsageContext = (typeof RIGHTS_USAGE_CONTEXTS)[number];

export const LICENSE_TYPES = [
  "cc0",
  "cc_by",
  "cc_by_sa",
  "cc_by_nc",
  "cc_by_nd",
  "public_domain",
  "personal_use",
  "editorial",
  "stock_standard",
  "proprietary",
  "aios_generation",
  "custom",
  "unknown",
] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const RISK_LEVELS = ["none", "low", "medium", "high", "unknown"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RIGHTS_FINDING_CODES = [
  "HIGH_RISK_CHARACTER_IP",
  "TRADEMARK_REVIEW_REQUIRED",
  "LIKENESS_REVIEW_REQUIRED",
  "LOGO_REVIEW_REQUIRED",
  "MUSIC_RIGHTS_INCOMPLETE",
  "VOICE_RIGHTS_INCOMPLETE",
  "EDITORIAL_ONLY",
  "PERSONAL_USE_ONLY",
  "TRAINING_NOT_ALLOWED",
  "REFERENCE_RIGHTS_UNCLEAR",
  "PROVIDER_UNAVAILABLE",
  "LICENSE_CHANGED",
  "OWNER_UNCONFIRMED",
] as const;
export type RightsFindingCode = (typeof RIGHTS_FINDING_CODES)[number];

export const EVIDENCE_KINDS = [
  "license_text",
  "provider_terms",
  "owner_declaration",
  "purchase_receipt",
  "client_authorization",
  "generation_record",
  "human_attestation",
  "public_license",
] as const;
export type RightsEvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type TriState = boolean | null;

export interface RightsEvidence {
  id: string;
  kind: RightsEvidenceKind;
  summary: string;
  sourceUrl?: string | null;
  fingerprint: string;
  excerpt?: string | null;
  recordedAt: string;
  recordedBy?: string | null;
}

export interface RightsFinding {
  code: RightsFindingCode;
  severity: "info" | "warning" | "blocking";
  summary: string;
  evidenceIds: string[];
}

export interface ParsedLicense {
  licenseType: LicenseType;
  licenseUrl?: string | null;
  licenseTextSnapshot?: string | null;
  licenseFingerprint?: string | null;
  commercialUse: TriState;
  derivatives: TriState;
  modification: TriState;
  redistribution: TriState;
  attributionRequired: TriState;
  attributionText?: string | null;
  editorialOnly: boolean;
  personalUseOnly: boolean;
  training: TriState;
  aiGeneration: TriState;
  sublicensing: TriState;
  evidence: RightsEvidence[];
}

export interface OwnerClaim {
  ownsOrLicensed: boolean;
  note?: string | null;
  attestedBy?: string | null;
  attestedAt?: string | null;
}

export interface RightsRisks {
  copyrightRisk: RiskLevel;
  trademarkRisk: RiskLevel;
  logoRisk: RiskLevel;
  characterIpRisk: RiskLevel;
  likenessRisk: RiskLevel;
  musicRightsRisk: RiskLevel;
  voiceRightsRisk: RiskLevel;
  privacyRisk: RiskLevel;
  licenseRisk: RiskLevel;
}

export interface RightsGrants {
  commercialUseAllowed: TriState;
  derivativesAllowed: TriState;
  modificationAllowed: TriState;
  redistributionAllowed: TriState;
  attributionRequired: TriState;
  attributionText: string | null;
  editorialOnly: boolean;
  personalUseOnly: boolean;
  trainingAllowed: TriState;
  aiGenerationAllowed: TriState;
  sublicensingAllowed: TriState;
}

export interface RightsProfile {
  assetId: string;
  sourceType: RightsSourceType;
  sourceUrl: string | null;
  sourceProvider: string | null;
  creator: string | null;
  uploader: string | null;
  ownerClaim: OwnerClaim | null;
  licenseType: LicenseType;
  licenseUrl: string | null;
  licenseTextSnapshot: string | null;
  licenseCheckedAt: string | null;
  licenseFingerprint: string | null;
  grants: RightsGrants;
  risks: RightsRisks;
  evidence: RightsEvidence[];
  findings: RightsFinding[];
  rightsStatus: RightsStatus;
  confidence: number;
  usageContext: RightsUsageContext;
  checkedAt: string;
  decisionVersion: string;
}

export interface EvaluateRightsInput {
  assetId: string;
  sourceType: RightsSourceType;
  sourceUrl?: string | null;
  sourceProvider?: string | null;
  creator?: string | null;
  uploader?: string | null;
  ownerClaim?: OwnerClaim | null;
  license?: ParsedLicense | null;
  extraEvidence?: RightsEvidence[];
  extraFindings?: RightsFinding[];
  usageContext?: RightsUsageContext;
  kind?: string;
  title?: string;
  tags?: string[];
  isAiGenerated?: boolean;
  parentAssetFindings?: RightsFinding[];
  providerFailed?: boolean;
  now?: string;
}

export const evaluateRightsInputSchema = z.object({
  assetId: z.string().uuid(),
  sourceType: z.enum(RIGHTS_SOURCE_TYPES),
  sourceUrl: z.string().url().nullable().optional(),
  sourceProvider: z.string().max(80).nullable().optional(),
  creator: z.string().max(120).nullable().optional(),
  uploader: z.string().uuid().nullable().optional(),
  ownerClaim: z.object({
    ownsOrLicensed: z.boolean(),
    note: z.string().trim().max(400).nullable().optional(),
    attestedBy: z.string().uuid().nullable().optional(),
    attestedAt: z.string().nullable().optional(),
  }).nullable().optional(),
  usageContext: z.enum(RIGHTS_USAGE_CONTEXTS).optional(),
  kind: z.string().max(40).optional(),
  title: z.string().max(200).optional(),
  tags: z.array(z.string().max(40)).max(24).optional(),
  isAiGenerated: z.boolean().optional(),
});

export const submitRightsAttestationSchema = z.object({
  assetId: z.string().uuid(),
  kind: z.enum(EVIDENCE_KINDS),
  reason: z.string().trim().min(8).max(400),
  excerpt: z.string().trim().max(500).optional(),
  sourceUrl: z.string().url().optional(),
  sourceType: z.enum(RIGHTS_SOURCE_TYPES).optional(),
  ownsOrLicensed: z.boolean().optional(),
  licenseText: z.string().trim().max(8_000).optional(),
});

export function fingerprintText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function emptyRisks(): RightsRisks {
  return {
    copyrightRisk: "unknown",
    trademarkRisk: "unknown",
    logoRisk: "unknown",
    characterIpRisk: "unknown",
    likenessRisk: "unknown",
    musicRightsRisk: "unknown",
    voiceRightsRisk: "unknown",
    privacyRisk: "unknown",
    licenseRisk: "unknown",
  };
}

export function makeEvidence(input: {
  kind: RightsEvidenceKind;
  summary: string;
  sourceUrl?: string | null;
  excerpt?: string | null;
  recordedBy?: string | null;
  recordedAt?: string;
}): RightsEvidence {
  const recordedAt = input.recordedAt ?? new Date(0).toISOString();
  const excerpt = sanitizeEvidenceExcerpt(input.excerpt ?? null);
  return {
    id: fingerprintText(`${input.kind}:${input.summary}:${input.sourceUrl ?? ""}:${excerpt ?? ""}`).slice(0, 32),
    kind: input.kind,
    summary: input.summary,
    sourceUrl: input.sourceUrl ?? null,
    fingerprint: fingerprintText(`${input.kind}|${input.summary}|${excerpt ?? ""}|${input.sourceUrl ?? ""}`),
    excerpt,
    recordedAt,
    recordedBy: input.recordedBy ?? null,
  };
}

/** Keep only a short excerpt; drop credentials / long private mail. */
export function sanitizeEvidenceExcerpt(text: string | null | undefined): string | null {
  if (!text) return null;
  const stripped = text
    .replace(/password\s*[:=]\s*\S+/gi, "password:[redacted]")
    .replace(/cookie\s*[:=]\s*\S+/gi, "cookie:[redacted]")
    .replace(/authorization:\s*\S+/gi, "authorization:[redacted]");
  const cps = Array.from(stripped.trim());
  if (!cps.length) return null;
  return cps.length > 400 ? `${cps.slice(0, 400).join("")}…` : cps.join("");
}

const CC_BY_NC = /cc[\s-]?by[\s-]?nc|non[\s-]?commercial/i;
const CC_BY_ND = /cc[\s-]?by[\s-]?nd|no[\s-]?deriv/i;
const CC_BY_SA = /cc[\s-]?by[\s-]?sa|share[\s-]?alike/i;
const CC_BY = /cc[\s-]?by(?![\s-]?nc|[\s-]?nd|[\s-]?sa)|attribution\s+4\.0/i;
const CC0 = /\bcc0\b|public\s+domain|no\s+rights\s+reserved/i;
const PERSONAL = /personal\s+use\s+only|for\s+personal\s+use|非商用|僅供個人/i;
const EDITORIAL = /editorial\s+(use|only)|編輯用途|新聞用途/i;
const NO_TRAINING = /no\s+ai\s+training|not\s+for\s+training|不得.*訓練|禁止.*訓練|machine\s+learning\s+prohibited/i;
const YES_TRAINING = /training\s+allowed|may\s+be\s+used\s+to\s+train|允許.*訓練/i;
const NO_COMMERCIAL = /not\s+for\s+commercial|no\s+commercial\s+use|禁止商用|不得商用/i;
const YES_COMMERCIAL = /commercial\s+use\s+allowed|may\s+be\s+used\s+commercially|允許商用|可商用/i;

export function parseLicenseText(input: {
  text?: string | null;
  url?: string | null;
  recordedAt?: string;
}): ParsedLicense | null {
  const blob = `${input.url ?? ""}\n${input.text ?? ""}`.trim();
  if (!blob) return null;

  const evidence = [
    makeEvidence({
      kind: input.url && /creativecommons\.org/i.test(input.url) ? "public_license" : "license_text",
      summary: input.url ? `授權來源：${input.url}` : "已保存授權文字摘錄",
      sourceUrl: input.url ?? null,
      excerpt: input.text ?? null,
      recordedAt: input.recordedAt,
    }),
  ];

  const personalUseOnly = PERSONAL.test(blob);
  const editorialOnly = EDITORIAL.test(blob);
  let licenseType: LicenseType = "unknown";
  let commercialUse: TriState = null;
  let attributionRequired: TriState = null;
  let derivatives: TriState = null;
  let training: TriState = null;

  if (CC0.test(blob) && !CC_BY_NC.test(blob) && !PERSONAL.test(blob) && !EDITORIAL.test(blob)) {
    licenseType = /public\s+domain/i.test(blob) && !/\bcc0\b/i.test(blob) ? "public_domain" : "cc0";
    commercialUse = true;
    attributionRequired = false;
    derivatives = true;
    training = licenseType === "cc0" ? true : null;
  } else if (CC_BY_NC.test(blob)) {
    licenseType = "cc_by_nc";
    commercialUse = false;
    attributionRequired = true;
    derivatives = true;
    training = false;
  } else if (CC_BY_ND.test(blob)) {
    licenseType = "cc_by_nd";
    commercialUse = true;
    attributionRequired = true;
    derivatives = false;
    training = null;
  } else if (CC_BY_SA.test(blob)) {
    licenseType = "cc_by_sa";
    commercialUse = true;
    attributionRequired = true;
    derivatives = true;
    training = null;
  } else if (CC_BY.test(blob)) {
    licenseType = "cc_by";
    commercialUse = true;
    attributionRequired = true;
    derivatives = true;
    training = null;
  }

  if (personalUseOnly) {
    licenseType = "personal_use";
    commercialUse = false;
  }
  if (editorialOnly) {
    licenseType = "editorial";
    commercialUse = false;
  }
  if (NO_COMMERCIAL.test(blob)) commercialUse = false;
  else if (YES_COMMERCIAL.test(blob) && commercialUse == null) {
    commercialUse = true;
    if (licenseType === "unknown") licenseType = "custom";
  }
  if (NO_TRAINING.test(blob)) training = false;
  if (YES_TRAINING.test(blob) && commercialUse !== false) training = true;

  return {
    licenseType,
    licenseUrl: input.url ?? null,
    licenseTextSnapshot: sanitizeEvidenceExcerpt(input.text ?? null),
    licenseFingerprint: fingerprintText(blob.toLowerCase()),
    commercialUse,
    derivatives,
    modification: derivatives,
    redistribution: commercialUse === false ? false : derivatives,
    attributionRequired,
    attributionText: attributionRequired ? "需保留作者／授權標示" : null,
    editorialOnly,
    personalUseOnly,
    training,
    aiGeneration: training,
    sublicensing: licenseType === "cc0" ? true : false,
    evidence,
  };
}

const CHARACTER_MARKERS = [
  "mickey", "minnie", "pikachu", "pokemon", "marvel", "spiderman", "spider-man",
  "batman", "disney", "elsa", "frozen", "mario", "luigi", "hello kitty", "哈利波特",
  "皮卡丘", "米奇", "迪士尼",
];
const TRADEMARK_MARKERS = ["nike", "adidas", "coca-cola", "coca cola", "apple logo", "starbucks", "mcdonald", "耐吉", "阿迪達斯"];
const LIKENESS_MARKERS = ["celebrity", "總統", "明星", "名人肖像", "real person", "headshot of"];
const VOICE_MARKERS = ["voice clone", "cloned voice", "聲音克隆", "voice model"];

function haystackOf(title?: string, tags?: string[]): string {
  return `${title ?? ""} ${(tags ?? []).join(" ")}`.toLowerCase();
}

export function detectRightsFindings(input: {
  title?: string;
  tags?: string[];
  kind?: string;
  sourceType: RightsSourceType;
  license?: ParsedLicense | null;
  ownerClaim?: OwnerClaim | null;
  isAiGenerated?: boolean;
  parentAssetFindings?: RightsFinding[];
  providerFailed?: boolean;
}): RightsFinding[] {
  const findings: RightsFinding[] = [];
  const hay = haystackOf(input.title, input.tags);
  const push = (code: RightsFindingCode, severity: RightsFinding["severity"], summary: string) => {
    if (findings.some((f) => f.code === code)) return;
    findings.push({ code, severity, summary, evidenceIds: [] });
  };

  if (CHARACTER_MARKERS.some((m) => hay.includes(m))) {
    push("HIGH_RISK_CHARACTER_IP", "warning", "疑似包含第三方知名角色特徵，建議確認是否有商業使用授權");
  }
  if (TRADEMARK_MARKERS.some((m) => hay.includes(m))) {
    push("TRADEMARK_REVIEW_REQUIRED", "warning", "疑似包含第三方商標或品牌識別，建議確認授權");
  }
  if (/\blogo\b|商標|標誌/.test(hay)) {
    push("LOGO_REVIEW_REQUIRED", "warning", "疑似包含 Logo／標誌，建議確認是否可商用");
  }
  if (LIKENESS_MARKERS.some((m) => hay.includes(m))) {
    push("LIKENESS_REVIEW_REQUIRED", "warning", "疑似涉及真人肖像，建議確認本人或權利人同意");
  }
  if (input.kind === "audio" && (VOICE_MARKERS.some((m) => hay.includes(m)) || /voice|配音|旁白/.test(hay))) {
    push("VOICE_RIGHTS_INCOMPLETE", "warning", "聲音素材需要講者同意或聲音模型授權，不能只因為能下載就商用");
  }
  if (input.kind === "audio" && !input.license) {
    push("MUSIC_RIGHTS_INCOMPLETE", "warning", "音樂／音效應分開確認詞曲、錄音與同步授權");
  }
  if (input.license?.editorialOnly) {
    push("EDITORIAL_ONLY", "blocking", "授權標示僅供編輯／新聞用途，不建議作為商業成品");
  }
  if (input.license?.personalUseOnly) {
    push("PERSONAL_USE_ONLY", "blocking", "授權標示僅供個人使用，不建議作為商業成品");
  }
  if (input.license?.training === false) {
    push("TRAINING_NOT_ALLOWED", "info", "授權不允許加入 AI 訓練資料，即使可以放進作品");
  }
  if (input.sourceType === "USER_OWNED" && !input.ownerClaim?.ownsOrLicensed) {
    push("OWNER_UNCONFIRMED", "warning", "自有上傳仍需確認：你是否擁有這份素材或已取得使用授權？");
  }
  if (input.sourceType === "WEB_UNKNOWN" && !input.license) {
    push("REFERENCE_RIGHTS_UNCLEAR", "warning", "網路找得到並不表示可以商用，目前沒有授權依據");
  }
  if ((input.isAiGenerated || input.sourceType === "AI_GENERATED" || input.sourceType === "THIRD_PARTY_AI" || input.sourceType === "GENERATED_BY_AIOS") && (input.parentAssetFindings?.length ?? 0) > 0) {
    push("REFERENCE_RIGHTS_UNCLEAR", "warning", "AI 生成仍取決於參考圖／聲音來源的權利，生成本身不是自動安全");
  }
  if (input.providerFailed) {
    push("PROVIDER_UNAVAILABLE", "warning", "授權來源暫時無法核對，維持資訊不足，不會當成可以使用");
  }
  for (const parent of input.parentAssetFindings ?? []) {
    if (!findings.some((f) => f.code === parent.code)) findings.push({ ...parent });
  }
  return findings;
}

function riskFromFindings(findings: RightsFinding[], code: RightsFindingCode): RiskLevel {
  const hit = findings.find((f) => f.code === code);
  if (!hit) return "none";
  if (hit.severity === "blocking") return "high";
  if (hit.severity === "warning") return "medium";
  return "low";
}

export function evaluateRights(input: EvaluateRightsInput): RightsProfile {
  const now = input.now ?? new Date().toISOString();
  const usageContext = input.usageContext ?? "commercial_final";
  const license = input.license ?? null;
  const findings = [
    ...detectRightsFindings({
      title: input.title,
      tags: input.tags,
      kind: input.kind,
      sourceType: input.sourceType,
      license,
      ownerClaim: input.ownerClaim,
      isAiGenerated: input.isAiGenerated,
      parentAssetFindings: input.parentAssetFindings,
      providerFailed: input.providerFailed,
    }),
    ...(input.extraFindings ?? []),
  ];
  const evidence = [
    ...(license?.evidence ?? []),
    ...(input.extraEvidence ?? []),
  ];
  if (input.ownerClaim?.ownsOrLicensed) {
    evidence.push(makeEvidence({
      kind: "owner_declaration",
      summary: "上傳者聲明擁有或已取得使用授權",
      excerpt: input.ownerClaim.note ?? null,
      recordedBy: input.ownerClaim.attestedBy ?? null,
      recordedAt: input.ownerClaim.attestedAt ?? now,
    }));
  }

  const grants: RightsGrants = {
    commercialUseAllowed: license?.commercialUse ?? null,
    derivativesAllowed: license?.derivatives ?? null,
    modificationAllowed: license?.modification ?? null,
    redistributionAllowed: license?.redistribution ?? null,
    attributionRequired: license?.attributionRequired ?? null,
    attributionText: license?.attributionText ?? null,
    editorialOnly: Boolean(license?.editorialOnly),
    personalUseOnly: Boolean(license?.personalUseOnly),
    trainingAllowed: license?.training ?? null,
    aiGenerationAllowed: license?.aiGeneration ?? null,
    sublicensingAllowed: license?.sublicensing ?? null,
  };

  if (input.ownerClaim?.ownsOrLicensed && grants.commercialUseAllowed == null && !findings.some((f) => f.severity === "blocking")) {
    // Owner confirmation can support commercial use, never training, and never clears IP findings.
    if (!findings.some((f) => f.code === "HIGH_RISK_CHARACTER_IP" || f.code === "TRADEMARK_REVIEW_REQUIRED" || f.code === "LIKENESS_REVIEW_REQUIRED")) {
      grants.commercialUseAllowed = true;
      grants.derivativesAllowed = grants.derivativesAllowed ?? true;
      grants.modificationAllowed = grants.modificationAllowed ?? true;
    }
  }

  const blocking = findings.filter((f) => f.severity === "blocking");
  const review = findings.filter((f) => f.severity === "warning" && !["OWNER_UNCONFIRMED", "REFERENCE_RIGHTS_UNCLEAR", "PROVIDER_UNAVAILABLE"].includes(f.code));
  const insufficient = findings.filter((f) => f.code === "OWNER_UNCONFIRMED" || f.code === "REFERENCE_RIGHTS_UNCLEAR" || f.code === "PROVIDER_UNAVAILABLE");
  const trainingContext = usageContext === "ai_training" || usageContext === "team_canon_training";

  let rightsStatus: RightsStatus = "UNKNOWN";
  if (input.providerFailed && !license && !input.ownerClaim?.ownsOrLicensed) {
    rightsStatus = "UNKNOWN";
  } else if (blocking.length > 0 || grants.editorialOnly || grants.personalUseOnly || grants.commercialUseAllowed === false) {
    rightsStatus = "BLOCKED";
  } else if (trainingContext && grants.trainingAllowed !== true) {
    rightsStatus = grants.trainingAllowed === false ? "BLOCKED" : "UNKNOWN";
  } else if (review.length > 0) {
    rightsStatus = "REVIEW_REQUIRED";
  } else if (grants.commercialUseAllowed === true && grants.attributionRequired === true) {
    rightsStatus = "CONDITIONAL";
  } else if (grants.commercialUseAllowed === true && evidence.length > 0) {
    rightsStatus = "CLEAR";
  } else if (insufficient.length > 0 || grants.commercialUseAllowed == null) {
    rightsStatus = "UNKNOWN";
  } else {
    rightsStatus = "UNKNOWN";
  }

  const risks = emptyRisks();
  risks.characterIpRisk = riskFromFindings(findings, "HIGH_RISK_CHARACTER_IP");
  risks.trademarkRisk = riskFromFindings(findings, "TRADEMARK_REVIEW_REQUIRED");
  risks.logoRisk = riskFromFindings(findings, "LOGO_REVIEW_REQUIRED");
  risks.likenessRisk = riskFromFindings(findings, "LIKENESS_REVIEW_REQUIRED");
  risks.musicRightsRisk = riskFromFindings(findings, "MUSIC_RIGHTS_INCOMPLETE");
  risks.voiceRightsRisk = riskFromFindings(findings, "VOICE_RIGHTS_INCOMPLETE");
  risks.privacyRisk = risks.likenessRisk;
  risks.licenseRisk = rightsStatus === "UNKNOWN" || rightsStatus === "REVIEW_REQUIRED" ? "medium" : rightsStatus === "BLOCKED" ? "high" : "low";
  risks.copyrightRisk = rightsStatus === "CLEAR" || rightsStatus === "CONDITIONAL" ? "low" : rightsStatus === "BLOCKED" ? "high" : "medium";

  const confidence = Math.min(100, evidence.length * 28 + (license ? 20 : 0) + (input.ownerClaim?.ownsOrLicensed ? 15 : 0) - review.length * 10 - blocking.length * 25);

  return {
    assetId: input.assetId,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl ?? null,
    sourceProvider: input.sourceProvider ?? null,
    creator: input.creator ?? null,
    uploader: input.uploader ?? null,
    ownerClaim: input.ownerClaim ?? null,
    licenseType: license?.licenseType ?? "unknown",
    licenseUrl: license?.licenseUrl ?? null,
    licenseTextSnapshot: license?.licenseTextSnapshot ?? null,
    licenseCheckedAt: license ? now : null,
    licenseFingerprint: license?.licenseFingerprint ?? null,
    grants,
    risks,
    evidence,
    findings,
    rightsStatus,
    confidence: Math.max(0, confidence),
    usageContext,
    checkedAt: now,
    decisionVersion: RIGHTS_DECISION_VERSION,
  };
}

export function profileFingerprint(profile: Pick<RightsProfile, "assetId" | "licenseFingerprint" | "rightsStatus" | "grants" | "findings" | "evidence" | "decisionVersion">): string {
  return fingerprintText(JSON.stringify({
    assetId: profile.assetId,
    license: profile.licenseFingerprint,
    status: profile.rightsStatus,
    grants: profile.grants,
    findings: profile.findings.map((f) => f.code),
    evidence: profile.evidence.map((e) => e.fingerprint).sort(),
    version: profile.decisionVersion,
  }));
}

export function isTrainingContext(ctx: RightsUsageContext): boolean {
  return ctx === "ai_training" || ctx === "team_canon_training";
}

export function deliveryRightsVerdict(input: {
  usageContext: RightsUsageContext;
  counts: Record<RightsStatus, number>;
}): { blocked: boolean; warnings: string[]; blockers: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (input.counts.BLOCKED > 0) blockers.push(`${input.counts.BLOCKED} 份素材目前不建議商用`);
  const review = input.counts.REVIEW_REQUIRED + input.counts.UNKNOWN;
  if (input.usageContext === "internal_reference") {
    if (review > 0) warnings.push(`${review} 份素材權利資訊不足或需要確認`);
    return { blocked: blockers.length > 0, warnings, blockers };
  }
  if (review > 0) blockers.push(`${review} 份素材權利資訊不足或需要確認`);
  if (input.counts.CONDITIONAL > 0) warnings.push(`${input.counts.CONDITIONAL} 份素材可使用但有署名或其他條件`);
  return { blocked: blockers.length > 0, warnings, blockers };
}

export function trainingInclusion(profile: Pick<RightsProfile, "grants" | "rightsStatus">): {
  included: boolean;
  excludeReason: "rights_training_forbidden" | "rights_unknown" | null;
} {
  if (profile.grants.trainingAllowed === true) return { included: true, excludeReason: null };
  if (profile.grants.trainingAllowed === false) return { included: false, excludeReason: "rights_training_forbidden" };
  return { included: false, excludeReason: "rights_unknown" };
}

/**
 * Presentation helpers live in ./commercialRightsView — they are the only part of
 * this module the browser needs, and this file's `node:crypto` import made the
 * client bundle unbuildable. Re-exported here so server callers keep one import.
 */
export { rightsChip, rightsDetailRows, sourceTypeLabel } from "./commercialRightsView";

export function inferSourceType(input: {
  isAiGenerated?: boolean;
  originUrl?: string | null;
  sourceProvider?: string | null;
  declared?: RightsSourceType | null;
}): RightsSourceType {
  if (input.declared) return input.declared;
  if (input.isAiGenerated && input.sourceProvider === "aios") return "GENERATED_BY_AIOS";
  if (input.isAiGenerated && input.sourceProvider) return "THIRD_PARTY_AI";
  if (input.isAiGenerated) return "AI_GENERATED";
  if (input.originUrl && /creativecommons\.org/i.test(input.originUrl)) return "CREATIVE_COMMONS";
  if (input.originUrl) return "WEB_UNKNOWN";
  return "USER_OWNED";
}

export { emptyStatusCounts, summarizeProjectRights } from "./commercialRightsView";
