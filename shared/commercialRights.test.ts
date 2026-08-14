import { describe, expect, it } from "vitest";
import {
  deliveryRightsVerdict,
  detectRightsFindings,
  evaluateRights,
  inferSourceType,
  parseLicenseText,
  profileFingerprint,
  rightsChip,
  rightsDetailRows,
  sanitizeEvidenceExcerpt,
  summarizeProjectRights,
  trainingInclusion,
} from "./commercialRights";

const ASSET = "00000000-0000-4000-8000-000000000001";

describe("commercial rights evidence model", () => {
  it("1. user-owned asset stays unknown until owner confirmation", () => {
    const before = evaluateRights({ assetId: ASSET, sourceType: "USER_OWNED", title: "我拍的風景" });
    expect(before.rightsStatus).toBe("UNKNOWN");
    expect(before.findings.some((f) => f.code === "OWNER_UNCONFIRMED")).toBe(true);
    const after = evaluateRights({
      assetId: ASSET,
      sourceType: "USER_OWNED",
      title: "我拍的風景",
      ownerClaim: { ownsOrLicensed: true, attestedBy: "00000000-0000-4000-8000-000000000099" },
    });
    expect(after.rightsStatus).toBe("CLEAR");
    expect(after.grants.commercialUseAllowed).toBe(true);
    expect(after.grants.trainingAllowed).toBeNull();
    expect(trainingInclusion(after).included).toBe(false);
  });

  it("2. CC0 / public domain is commercially usable; only CC0 is training-clear", () => {
    const cc0 = parseLicenseText({ text: "CC0 1.0 Universal — No Rights Reserved", url: "https://creativecommons.org/publicdomain/zero/1.0/" });
    const pd = parseLicenseText({ text: "This work is in the public domain" });
    const cc0Profile = evaluateRights({ assetId: ASSET, sourceType: "CREATIVE_COMMONS", license: cc0 });
    const pdProfile = evaluateRights({ assetId: ASSET, sourceType: "PUBLIC_DOMAIN", license: pd });
    expect(cc0Profile.rightsStatus).toBe("CLEAR");
    expect(cc0Profile.grants.trainingAllowed).toBe(true);
    expect(pdProfile.rightsStatus).toBe("CLEAR");
    expect(pdProfile.grants.trainingAllowed).toBeNull();
    expect(cc0Profile.evidence.length).toBeGreaterThan(0);
  });

  it("3. attribution-required stays CONDITIONAL, not CLEAR", () => {
    const license = parseLicenseText({ text: "CC BY 4.0 Attribution International", url: "https://creativecommons.org/licenses/by/4.0/" });
    const profile = evaluateRights({ assetId: ASSET, sourceType: "CREATIVE_COMMONS", license });
    expect(profile.rightsStatus).toBe("CONDITIONAL");
    expect(profile.grants.attributionRequired).toBe(true);
    expect(rightsChip(profile.rightsStatus).label).toContain("有條件");
    expect(rightsDetailRows(profile).find((r) => r.label === "署名")?.value).not.toBe("不需要");
  });

  it("4. personal-use-only is BLOCKED for commercial work", () => {
    const license = parseLicenseText({ text: "For personal use only. Not for commercial use." });
    const profile = evaluateRights({ assetId: ASSET, sourceType: "STOCK_MEDIA", license });
    expect(profile.rightsStatus).toBe("BLOCKED");
    expect(profile.grants.personalUseOnly).toBe(true);
    expect(profile.grants.commercialUseAllowed).toBe(false);
  });

  it("5. editorial-only is BLOCKED and never treated as commercial", () => {
    const license = parseLicenseText({ text: "Editorial use only. Not for advertising." });
    const profile = evaluateRights({ assetId: ASSET, sourceType: "STOCK_MEDIA", license });
    expect(profile.rightsStatus).toBe("BLOCKED");
    expect(profile.findings.some((f) => f.code === "EDITORIAL_ONLY")).toBe(true);
  });

  it("6. commercial allowed / training forbidden stay split", () => {
    const license = parseLicenseText({
      text: "CC BY 4.0. You may use commercially. No AI training. Machine learning prohibited.",
    });
    const profile = evaluateRights({ assetId: ASSET, sourceType: "CREATIVE_COMMONS", license });
    expect(profile.grants.commercialUseAllowed).toBe(true);
    expect(profile.grants.trainingAllowed).toBe(false);
    expect(profile.rightsStatus).toBe("CONDITIONAL");
    expect(trainingInclusion(profile)).toEqual({ included: false, excludeReason: "rights_training_forbidden" });
    const train = evaluateRights({
      assetId: ASSET,
      sourceType: "CREATIVE_COMMONS",
      license,
      usageContext: "team_canon_training",
    });
    expect(train.rightsStatus).toBe("BLOCKED");
  });

  it("7. unknown web image is UNKNOWN — found on the internet is not a license", () => {
    const profile = evaluateRights({
      assetId: ASSET,
      sourceType: "WEB_UNKNOWN",
      sourceUrl: "https://example.com/random.jpg",
      title: "搜到的圖",
    });
    expect(profile.rightsStatus).toBe("UNKNOWN");
    expect(profile.findings.some((f) => f.code === "REFERENCE_RIGHTS_UNCLEAR")).toBe(true);
    expect(rightsChip(profile.rightsStatus).symbol).toBe("unknown");
  });

  it("8. AI-generated asset is not automatically safe", () => {
    const profile = evaluateRights({
      assetId: ASSET,
      sourceType: "GENERATED_BY_AIOS",
      isAiGenerated: true,
      sourceProvider: "fal",
      title: "生成的角色立繪",
    });
    expect(profile.rightsStatus).toBe("UNKNOWN");
    expect(profile.grants.commercialUseAllowed).toBeNull();
  });

  it("9. AI-generated asset with unauthorized reference stays in review", () => {
    const profile = evaluateRights({
      assetId: ASSET,
      sourceType: "THIRD_PARTY_AI",
      isAiGenerated: true,
      title: "參考皮卡丘的新角色",
      parentAssetFindings: [{
        code: "HIGH_RISK_CHARACTER_IP",
        severity: "warning",
        summary: "參考圖疑似第三方角色",
        evidenceIds: [],
      }],
    });
    expect(profile.rightsStatus).toBe("REVIEW_REQUIRED");
    expect(profile.findings.some((f) => f.code === "HIGH_RISK_CHARACTER_IP")).toBe(true);
  });

  it("10. trademark / logo finding is review, not a verdict of infringement", () => {
    const findings = detectRightsFindings({
      sourceType: "WEB_UNKNOWN",
      title: "Nike logo moodboard",
      tags: ["logo"],
    });
    expect(findings.map((f) => f.code)).toEqual(expect.arrayContaining([
      "TRADEMARK_REVIEW_REQUIRED",
      "LOGO_REVIEW_REQUIRED",
    ]));
    expect(findings.every((f) => !/侵權/.test(f.summary))).toBe(true);
  });

  it("11. real-person likeness is review required", () => {
    const profile = evaluateRights({
      assetId: ASSET,
      sourceType: "USER_OWNED",
      title: "celebrity headshot of a 明星",
      ownerClaim: { ownsOrLicensed: true },
    });
    expect(profile.rightsStatus).toBe("REVIEW_REQUIRED");
    expect(profile.findings.some((f) => f.code === "LIKENESS_REVIEW_REQUIRED")).toBe(true);
  });

  it("12. music without license is incomplete, downloadability is irrelevant", () => {
    const profile = evaluateRights({
      assetId: ASSET,
      sourceType: "WEB_UNKNOWN",
      kind: "audio",
      title: "free_bgm.mp3",
    });
    expect(profile.findings.some((f) => f.code === "MUSIC_RIGHTS_INCOMPLETE")).toBe(true);
    expect(profile.rightsStatus).not.toBe("CLEAR");
  });

  it("13. voice cloning needs consent / model license", () => {
    const profile = evaluateRights({
      assetId: ASSET,
      sourceType: "THIRD_PARTY_AI",
      kind: "audio",
      title: "voice clone of narrator",
      isAiGenerated: true,
    });
    expect(profile.findings.some((f) => f.code === "VOICE_RIGHTS_INCOMPLETE")).toBe(true);
  });

  it("14. license provider timeout stays UNKNOWN and never falls back to safe", () => {
    const profile = evaluateRights({
      assetId: ASSET,
      sourceType: "STOCK_MEDIA",
      providerFailed: true,
    });
    expect(profile.rightsStatus).toBe("UNKNOWN");
    expect(profile.findings.some((f) => f.code === "PROVIDER_UNAVAILABLE")).toBe(true);
  });

  it("15. license terms change produces a new fingerprint / snapshot identity", () => {
    const oldLicense = parseLicenseText({ text: "CC BY 4.0" });
    const newLicense = parseLicenseText({ text: "CC BY-NC 4.0. Not for commercial use." });
    const prev = evaluateRights({ assetId: ASSET, sourceType: "CREATIVE_COMMONS", license: oldLicense });
    const next = evaluateRights({ assetId: ASSET, sourceType: "CREATIVE_COMMONS", license: newLicense });
    expect(prev.licenseFingerprint).not.toBe(next.licenseFingerprint);
    expect(profileFingerprint(prev)).not.toBe(profileFingerprint(next));
    expect(prev.rightsStatus).toBe("CONDITIONAL");
    expect(next.rightsStatus).toBe("BLOCKED");
  });

  it("16. human evidence override must carry operator, reason and excerpt — not an ignore button", () => {
    const profile = evaluateRights({
      assetId: ASSET,
      sourceType: "CLIENT_PROVIDED",
      extraEvidence: [{
        id: "att-1",
        kind: "client_authorization",
        summary: "客戶授權本專案商用",
        fingerprint: "abc",
        excerpt: "客戶來信同意用於本支廣告（已去識別）",
        recordedAt: "2026-08-14T00:00:00.000Z",
        recordedBy: "00000000-0000-4000-8000-000000000099",
      }],
      extraFindings: [],
      ownerClaim: { ownsOrLicensed: true, note: "客戶授權", attestedBy: "00000000-0000-4000-8000-000000000099" },
    });
    expect(profile.evidence.some((e) => e.kind === "client_authorization" && e.recordedBy)).toBe(true);
    expect(profile.evidence.some((e) => /忽略/.test(e.summary))).toBe(false);
  });

  it("17. project delivery is blocked by BLOCKED or incomplete rights; UNKNOWN is never CLEAR", () => {
    const blocked = deliveryRightsVerdict({
      usageContext: "client_delivery",
      counts: { CLEAR: 36, CONDITIONAL: 2, REVIEW_REQUIRED: 3, BLOCKED: 1, UNKNOWN: 0 },
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.blockers.join("")).toMatch(/不建議商用|需要確認|資訊不足/);
    const unknown = deliveryRightsVerdict({
      usageContext: "commercial_final",
      counts: { CLEAR: 10, CONDITIONAL: 0, REVIEW_REQUIRED: 0, BLOCKED: 0, UNKNOWN: 2 },
    });
    expect(unknown.blocked).toBe(true);
    const internal = deliveryRightsVerdict({
      usageContext: "internal_reference",
      counts: { CLEAR: 0, CONDITIONAL: 0, REVIEW_REQUIRED: 2, BLOCKED: 0, UNKNOWN: 1 },
    });
    expect(internal.blocked).toBe(false);
    expect(internal.warnings.length).toBeGreaterThan(0);
  });

  it("18. Team Canon training excludes commercial-only assets", () => {
    const license = parseLicenseText({ text: "Commercial use allowed. No AI training." });
    const profile = evaluateRights({ assetId: ASSET, sourceType: "STOCK_MEDIA", license });
    expect(profile.grants.commercialUseAllowed).toBe(true);
    expect(trainingInclusion(profile).excludeReason).toBe("rights_training_forbidden");
  });

  it("19. inferred source types stay project-local and do not promote web/AI to team-owned", () => {
    expect(inferSourceType({ isAiGenerated: true, sourceProvider: "aios" })).toBe("GENERATED_BY_AIOS");
    expect(inferSourceType({ originUrl: "https://cdn.example/x.jpg" })).toBe("WEB_UNKNOWN");
    expect(inferSourceType({ originUrl: "https://creativecommons.org/licenses/by/4.0/" })).toBe("CREATIVE_COMMONS");
    expect(inferSourceType({})).toBe("USER_OWNED");
  });

  it("20. recheck with the same evidence is idempotent", () => {
    const license = parseLicenseText({ text: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/" });
    const a = evaluateRights({ assetId: ASSET, sourceType: "CREATIVE_COMMONS", license, now: "2026-08-14T00:00:00.000Z" });
    const b = evaluateRights({ assetId: ASSET, sourceType: "CREATIVE_COMMONS", license, now: "2026-08-14T00:00:00.000Z" });
    expect(profileFingerprint(a)).toBe(profileFingerprint(b));
    expect(a.evidence.map((e) => e.fingerprint)).toEqual(b.evidence.map((e) => e.fingerprint));
  });

  it("never claims a legal verdict and never stores secrets in excerpts", () => {
    expect(sanitizeEvidenceExcerpt("please use this. password: hunter2 cookie: abc")).toMatch(/\[redacted\]/);
    const summary = summarizeProjectRights([
      { rightsStatus: "CLEAR" },
      { rightsStatus: "CONDITIONAL" },
      { rightsStatus: "UNKNOWN" },
    ]);
    expect(summary.usable).toBe(2);
    expect(summary.needsAttention).toBe(1);
  });
});
