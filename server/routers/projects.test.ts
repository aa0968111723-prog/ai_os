/**
 * canOwnProject 單元測試（轉移專案負責人的資格純規則）：
 * 新負責人必須是「該組成員」或「該團隊管理員」——負責人有封存/還原等裁決權，
 * 不能移交給組外看不到專案的人。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XIAOHUA_LOCKED_APPEARANCE } from "../../shared/characterIdentityLock";
import { TKU_ZEN_SHOTS, tkuZenHasForbidden, tkuZenSpokenDialogue } from "../../shared/fixtures/tkuZenPromo";
import { canOwnProject } from "./projects";

const members = ["u-leader", "u-member-1", "u-member-2"];
const admins = ["u-team-admin"];

describe("canOwnProject（專案負責人資格）", () => {
  it("該組成員（組長或組員）可接任負責人", () => {
    expect(canOwnProject(members, admins, "u-leader")).toBe(true);
    expect(canOwnProject(members, admins, "u-member-2")).toBe(true);
  });

  it("團隊管理員即使不在組員列，也可接任（有效成員規則與 listMemberRoles 一致）", () => {
    expect(canOwnProject(members, admins, "u-team-admin")).toBe(true);
  });

  it("組外的人一律擋下——不能把專案交給看不到它的人", () => {
    expect(canOwnProject(members, admins, "u-outsider")).toBe(false);
    expect(canOwnProject([], [], "u-anyone")).toBe(false);
  });
});

describe("continuity reference deletion guard", () => {
  it("protects locked references from both soft delete and permanent purge", () => {
    const source = readFileSync(new URL("./projects.ts", import.meta.url), "utf8");
    expect(source.match(/findRunningWorkflowUsingReferenceAsset\(asset\.projectId, asset\.id\)/g)).toHaveLength(2);
    expect(source).toContain("正被執行中的一致性工作流鎖定");
  });
});

describe("updateWorldview OCC", () => {
  it("writes through applyWithRevision and accepts expectedRev", () => {
    const source = readFileSync(new URL("./projects.ts", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("updateWorldview:"));
    expect(body).toContain("applyWithRevision");
    expect(body).toContain('entity: "project"');
    expect(body).toContain("expectedRev: input.expectedRev");
    expect(body).toContain("revColumn: schema.projects.rev");
    expect(body).toContain("patch: { worldview: merged }");
  });
});

describe("createSample seeds 小華 A–F, not 七幕", () => {
  const source = readFileSync(new URL("./projects.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("createSample:"), source.indexOf("seriesOverview:"));

  it("範例專案 worldview + shots mint 小華／禪定龜龜, never 安倢／慕恩", () => {
    expect(body).toContain("小華");
    expect(body).toContain("禪定龜龜");
    expect(body).toContain("XIAOHUA_LOCKED_APPEARANCE");
    expect(body).toContain("TKU_ZEN_SHOTS");
    expect(body).not.toContain("安倢");
    expect(body).not.toContain("慕恩");
    expect(body).not.toContain("哲維");
    expect(body).not.toContain("瑀晴");
    expect(body).not.toContain("紅傘");
  });

  it("runtime seed is 6 A–F, locked 小華 look, no forbidden tokens", () => {
    expect(TKU_ZEN_SHOTS).toHaveLength(6);
    expect(TKU_ZEN_SHOTS.map((shot) => shot.title).join("\n")).toMatch(/A 校門口[\s\S]*F 真的真的/);
    const people = [`小華：${XIAOHUA_LOCKED_APPEARANCE}`, "禪定龜龜：吉祥物龜龜，第三句才登場"];
    const blob = JSON.stringify({
      people,
      shots: TKU_ZEN_SHOTS.map((shot) => ({
        title: shot.title,
        prompt: shot.prompt,
        dialogue: shot.dialogue,
        voiceover: tkuZenSpokenDialogue(shot.dialogue),
      })),
    });
    expect(people[0]).toContain("粉橘短髮女孩");
    expect(people[0]).toContain("白帽T");
    expect(tkuZenHasForbidden(blob)).toEqual([]);
  });
});

describe("setCover（專案封面圖）契約", () => {
  const source = readFileSync(new URL("./projects.ts", import.meta.url), "utf8");
  /** 只取 setCover 這一條 procedure 的本文（下一條是 assets），避免比對到隔壁 procedure */
  const body = source.slice(source.indexOf("setCover: authedProcedure"), source.indexOf("assets: authedProcedure"));

  it("寫入前過組隔離＋可編輯守衛（檢視者不能換封面）", () => {
    expect(body).toContain("requireGroup(ctx.auth, project.groupId)");
    expect(body).toContain("assertProjectEditable(ctx.auth, project)");
  });

  it("綁圖時沿用 assertReferenceImage（同組＋同專案＋是圖片＋不在回收桶）", () => {
    expect(body).toContain("assertReferenceImage(input.assetId, project.groupId, project.id)");
  });

  it("assetId 可為 null（清除封面，退回色塊）", () => {
    expect(source).toMatch(/setCover:[\s\S]*?assetId:\s*z\.string\(\)\.uuid\(\)\.nullable\(\)/);
  });

  it("換封面不動 updatedAt——外觀調整不該把專案頂到「最近更新」最前面", () => {
    expect(body).toContain(".set({ coverAssetId: input.assetId })");
    expect(body).not.toContain("updatedAt: new Date()");
  });

  it("list／get 都以 isNull(assets.deletedAt) 左接封面——素材進回收桶時縮圖自動退回色塊", () => {
    expect(source).toContain("coverUrl: schema.assets.url");
    expect(source).toMatch(/eq\(schema\.assets\.id,\s*schema\.projects\.coverAssetId\),\s*isNull\(schema\.assets\.deletedAt\)/);
  });
});
