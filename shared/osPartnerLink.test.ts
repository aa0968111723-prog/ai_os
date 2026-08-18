import { describe, expect, it } from "vitest";
import {
  AIOS_B_REPO,
  AIOS_SENTINEL_SURFACES,
  OS_PARTNER_CONTRACT_VERSION,
  OS_PARTNER_ENV,
  OS_PARTNER_HANDSHAKE_PATH,
  OS_PARTNER_UA_TOKEN,
  buildOsPartnerSnapshot,
  isAiosSentinelSurface,
  isOsPartnerId,
  linkAiosB,
  linkPartners,
  parsePartnerTargetUrl,
  publicOsPartnerHandshake,
  readyPartnersNote,
  sentinelEnvOverrides,
  summarizeSentinelReport,
} from "./osPartnerLink";

describe("契約常數", () => {
  it("版本、握手路徑與姊妹倉穩定，Aios_b 才能對得上", () => {
    expect(OS_PARTNER_CONTRACT_VERSION).toBe(1);
    expect(OS_PARTNER_HANDSHAKE_PATH).toBe("/api/os-partners");
    expect(AIOS_B_REPO.github).toBe("https://github.com/aa0968111723-prog/Aios_b");
    expect(AIOS_SENTINEL_SURFACES).toEqual(["web", "app", "desktop"]);
    expect(OS_PARTNER_UA_TOKEN.deepin).toBe("AiosDeepin/1.0");
    expect(OS_PARTNER_UA_TOKEN.cutos).toBe("AiosCutos/1.0");
  });

  it("id 守衛只放行已知夥伴與三端", () => {
    expect(isOsPartnerId("deepin")).toBe(true);
    expect(isOsPartnerId("cutos")).toBe(true);
    expect(isOsPartnerId("windows")).toBe(false);
    expect(isAiosSentinelSurface("desktop")).toBe(true);
    expect(isAiosSentinelSurface("deepin")).toBe(false);
  });
});

describe("parsePartnerTargetUrl", () => {
  it("空值是未設定，不是錯誤網址", () => {
    expect(parsePartnerTargetUrl(undefined)).toEqual({ ok: false, reason: "未設定" });
    expect(parsePartnerTargetUrl("   ")).toEqual({ ok: false, reason: "未設定" });
  });

  it("只接受 http(s)，擋掉 javascript 與相對路徑", () => {
    expect(parsePartnerTargetUrl("javascript:alert(1)").ok).toBe(false);
    expect(parsePartnerTargetUrl("/internal").ok).toBe(false);
    expect(parsePartnerTargetUrl("https://edge.example/lwa/").ok).toBe(true);
    expect(parsePartnerTargetUrl("https://edge.example/lwa/")).toMatchObject({
      url: "https://edge.example/lwa",
    });
  });
});

describe("連結狀態", () => {
  it("沒設任何變數＝三端都未設定，不裝綠燈", () => {
    const snap = buildOsPartnerSnapshot({});
    expect(snap.anyLinked).toBe(false);
    expect(snap.gateFails).toBe(false);
    expect(snap.aiosB.state).toBe("unconfigured");
    expect(snap.partners.map((p) => p.state)).toEqual(["unconfigured", "unconfigured"]);
    expect(readyPartnersNote(snap).ok).toBe(true);
    expect(readyPartnersNote(snap).note).toContain("未設定");
  });

  it("深度與 CUTOS 各認自己的目標；壞網址標 invalid", () => {
    const partners = linkPartners({
      [OS_PARTNER_ENV.deepinTarget]: "https://deepin.local/aios",
      [OS_PARTNER_ENV.cutosTarget]: "not-a-url",
    });
    expect(partners[0]).toMatchObject({ id: "deepin", state: "linked", targetConfigured: true });
    expect(partners[1]).toMatchObject({ id: "cutos", state: "invalid", targetConfigured: true });
    expect(partners[1].note).toContain("無效");
  });

  it("Aios_b 指向倉或報告其中一個就算已連結", () => {
    expect(linkAiosB({ [OS_PARTNER_ENV.sentinelRepo]: "../Aios_b" }).state).toBe("linked");
    expect(linkAiosB({ [OS_PARTNER_ENV.sentinelReport]: "./reports/report.json" }).state).toBe("linked");
    expect(linkAiosB({}).state).toBe("unconfigured");
  });

  it("OS_PARTNER_GATE=1 且缺連結才擋就緒", () => {
    const open = buildOsPartnerSnapshot({ [OS_PARTNER_ENV.gate]: "1" });
    expect(open.gateFails).toBe(true);
    expect(readyPartnersNote(open).ok).toBe(false);

    const closed = buildOsPartnerSnapshot({
      [OS_PARTNER_ENV.gate]: "1",
      [OS_PARTNER_ENV.sentinelRepo]: "../Aios_b",
      [OS_PARTNER_ENV.deepinTarget]: "https://deepin.local",
      [OS_PARTNER_ENV.cutosTarget]: "https://cutos.local",
    });
    expect(closed.gateFails).toBe(false);
    expect(readyPartnersNote(closed).note).toContain("深度");
    expect(readyPartnersNote(closed).note).toContain("CUTOS");
    expect(readyPartnersNote(closed).note).toContain("Aios_b");
  });
});

describe("公開握手", () => {
  it("不回目標網址與本機路徑", () => {
    const snap = buildOsPartnerSnapshot({
      [OS_PARTNER_ENV.sentinelRepo]: "/secret/Aios_b",
      [OS_PARTNER_ENV.deepinTarget]: "https://internal.deepin.local",
    });
    const pub = publicOsPartnerHandshake(snap);
    const blob = JSON.stringify(pub);
    expect(blob).not.toContain("/secret");
    expect(blob).not.toContain("internal.deepin.local");
    expect(pub.sister.linked).toBe(true);
    expect(pub.partners.find((p) => p.id === "deepin")?.linked).toBe(true);
    expect(pub.partners.find((p) => p.id === "cutos")?.linked).toBe(false);
    expect(pub.handshake).toBe("/api/os-partners");
  });
});

describe("summarizeSentinelReport", () => {
  it("形狀不對回 null，不把壞報告講成沒問題", () => {
    expect(summarizeSentinelReport(null)).toBeNull();
    expect(summarizeSentinelReport({ target: "https://x" })).toBeNull();
  });

  it("抽出發現數與最嚴重等級", () => {
    const summary = summarizeSentinelReport({
      target: "https://example.test/aios",
      surfaces: ["web", "app"],
      startedAt: "2026-08-18T00:00:00.000Z",
      summary: {
        completed: 8,
        skipped: 1,
        errored: 0,
        worst: "high",
        findings: { critical: 0, high: 2, medium: 1, low: 0, info: 3 },
      },
    });
    expect(summary).toMatchObject({
      target: "https://example.test/aios",
      surfaces: ["web", "app"],
      worst: "high",
      completed: 8,
      skipped: 1,
      findings: { high: 2, medium: 1, info: 3 },
    });
  });
});

describe("sentinelEnvOverrides", () => {
  it("深度覆寫桌面端、CUTOS 覆寫網站端", () => {
    expect(
      sentinelEnvOverrides({
        [OS_PARTNER_ENV.deepinTarget]: "https://deepin.example/",
        [OS_PARTNER_ENV.cutosTarget]: "https://cutos.example/lwa",
      }),
    ).toEqual({
      AIOS_DESKTOP_TARGET: "https://deepin.example",
      AIOS_WEB_TARGET: "https://cutos.example/lwa",
    });
  });

  it("無效目標不寫進覆寫，避免 Sentinel 去打垃圾網址", () => {
    expect(sentinelEnvOverrides({ [OS_PARTNER_ENV.deepinTarget]: "ftp://x" })).toEqual({});
  });
});
