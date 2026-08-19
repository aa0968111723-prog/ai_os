import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XIAOHUA_LOCKED_APPEARANCE } from "@shared/characterIdentityLock";

const source = readFileSync(new URL("./CharacterCards.tsx", import.meta.url), "utf8");

describe("角色卡 UI sample writes 小華, not 安倢", () => {
  it("empty-state 帶入這張範例卡 mints 小華 + locked look", () => {
    expect(source).toContain('name: "小華"');
    expect(source).toContain("XIAOHUA_LOCKED_APPEARANCE");
    expect(source).toContain("與禪定龜龜同行");
    expect(source).not.toContain('name: "安倢"');
    expect(source).not.toContain("慕恩");
    expect(XIAOHUA_LOCKED_APPEARANCE).toContain("粉橘短髮女孩");
    expect(XIAOHUA_LOCKED_APPEARANCE).toContain("白帽T");
  });
});
