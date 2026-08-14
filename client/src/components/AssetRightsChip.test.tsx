import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetRightsPanel } from "./AssetRightsChip";
import type { RightsProfile } from "@shared/commercialRights";

const profile: RightsProfile = {
  assetId: "00000000-0000-4000-8000-000000000001",
  sourceType: "CREATIVE_COMMONS",
  sourceUrl: "https://creativecommons.org/licenses/by/4.0/",
  sourceProvider: null,
  creator: null,
  uploader: null,
  ownerClaim: null,
  licenseType: "cc_by",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  licenseTextSnapshot: "CC BY 4.0",
  licenseCheckedAt: "2026-08-14T00:00:00.000Z",
  licenseFingerprint: "x",
  grants: {
    commercialUseAllowed: true,
    derivativesAllowed: true,
    modificationAllowed: true,
    redistributionAllowed: true,
    attributionRequired: true,
    attributionText: "需保留作者／授權標示",
    editorialOnly: false,
    personalUseOnly: false,
    trainingAllowed: null,
    aiGenerationAllowed: null,
    sublicensingAllowed: false,
  },
  risks: {
    copyrightRisk: "low",
    trademarkRisk: "none",
    logoRisk: "none",
    characterIpRisk: "none",
    likenessRisk: "none",
    musicRightsRisk: "none",
    voiceRightsRisk: "none",
    privacyRisk: "none",
    licenseRisk: "low",
  },
  evidence: [{
    id: "e1",
    kind: "public_license",
    summary: "Adobe Stock license",
    fingerprint: "f",
    recordedAt: "2026-08-14T00:00:00.000Z",
  }],
  findings: [],
  rightsStatus: "CONDITIONAL",
  confidence: 70,
  usageContext: "commercial_final",
  checkedAt: "2026-08-14T00:00:00.000Z",
  decisionVersion: "commercial-rights.v1",
};

describe("AssetRightsPanel", () => {
  it("shows commercial / modify / credit / training in plain language", () => {
    render(
      <AssetRightsPanel
        profile={profile}
        canEdit={false}
        reason=""
        setReason={vi.fn()}
        pending={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/商用使用：可以/)).toBeInTheDocument();
    expect(screen.getByText(/修改：可以/)).toBeInTheDocument();
    expect(screen.getByText(/署名：需保留/)).toBeInTheDocument();
    expect(screen.getByText(/AI 訓練：還不知道/)).toBeInTheDocument();
    expect(screen.getByText("查看依據")).toBeInTheDocument();
    expect(screen.queryByText(/法律意見|侵權/)).not.toBeInTheDocument();
  });
});
