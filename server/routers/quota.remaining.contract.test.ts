import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const quota = readFileSync(join(process.cwd(), "server/routers/quota.ts"), "utf8");
const header = readFileSync(join(process.cwd(), "client/src/app/components/AppHeader.tsx"), "utf8");
const generate = readFileSync(join(process.cwd(), "client/src/features/creation-workbench/modes/DirectGenerateMode.tsx"), "utf8");
const display = readFileSync(join(process.cwd(), "shared/quotaDisplay.ts"), "utf8");

describe("quota.my remaining is ledger, not Fal USD", () => {
  it("totalRemaining is budgetRemaining only — Fal cap stays a separate gate", () => {
    const my = quota.slice(quota.indexOf("my: authedProcedure"), quota.indexOf("getSettings:"));
    expect(my).toContain("totalRemaining: budgetRemaining");
    expect(my).not.toContain("Math.min(budgetRemaining, falPointsCap)");
    expect(my).toContain("falPointsCap");
    expect(my).toContain("groupId: gid");
  });

  it("header 剩 uses member/group/Fal and never paints leftover 4708 as the wallet", () => {
    expect(header).toContain("scopedTightRemaining");
    expect(header).toContain("memberBudgetRemaining, groupBudgetRemaining, falPointsCap");
    expect(header).toContain("平台 Fal 可花上限");
    expect(header).toContain("不是組員錢包");
    expect(display).toContain("Never paint 站內總預算 leftover");
    expect(display).toContain("SITE_LEFTOVER_FAMILY_MIN");
    expect(generate).toContain("scopedWalletRemainingLabel");
    expect(generate).not.toContain("quota.data.totalRemaining");
  });
});
