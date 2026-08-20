import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPANION_DEEP_LINK_TARGETS,
  companionAbsoluteUrl,
  companionDeepLink,
  companionHandoffReason,
  parseAiosUri,
} from "./companionDeepLink";

const PID = "11111111-2222-4333-8444-555555555555";

describe("companionDeepLink", () => {
  it("專案走站內既有契約 /p/:id，不是自創的 /projects/:id", () => {
    expect(companionDeepLink({ target: "project", projectId: PID }).path).toBe(`/p/${PID}`);
  });

  it("分鏡是同一頁的錨點，不是另一條路由", () => {
    const link = companionDeepLink({ target: "storyboard", projectId: PID, anchorId: "stage-board" });
    expect(link.path).toBe(`/p/${PID}#stage-board`);
  });

  it("沒拿到錨點就退回專案頁本身——不連到不存在的錨點", () => {
    expect(companionDeepLink({ target: "storyboard", projectId: PID }).path).toBe(`/p/${PID}`);
  });

  it("動畫創作室是獨立路由", () => {
    expect(companionDeepLink({ target: "studio", projectId: PID }).path).toBe(`/studio/${PID}`);
  });

  it("站級去處不需要專案", () => {
    expect(companionDeepLink({ target: "tasks" }).path).toBe("/collab");
    expect(companionDeepLink({ target: "projects" }).path).toBe("/dashboard#projects");
    expect(companionDeepLink({ target: "tasks" }).incomplete).toBe(false);
  });

  it("缺專案 id 時標記 incomplete，呼叫端不該渲染按鈕", () => {
    const link = companionDeepLink({ target: "project" });
    expect(link.incomplete).toBe(true);
    expect(link.path).toBe("/dashboard");
  });

  it("非 UUID 的 projectId 一律拒絕——那個值常常來自模型輸出", () => {
    expect(companionDeepLink({ target: "project", projectId: "../../admin" }).incomplete).toBe(true);
    expect(companionDeepLink({ target: "project", projectId: "1" }).incomplete).toBe(true);
    expect(companionDeepLink({ target: "studio", projectId: "https://evil.example" }).incomplete).toBe(true);
  });

  it("每個目標都組得出以 / 開頭的站內路徑", () => {
    for (const target of COMPANION_DEEP_LINK_TARGETS) {
      const link = companionDeepLink({ target, projectId: PID, anchorId: "stage-board" });
      expect(link.path.startsWith("/")).toBe(true);
      expect(link.path.startsWith("//")).toBe(false);
      expect(link.label.length).toBeGreaterThan(0);
    }
  });
});

describe("companionAbsoluteUrl", () => {
  it("接上呼叫端提供的 origin", () => {
    expect(companionAbsoluteUrl("https://aios.example", `/p/${PID}`))
      .toBe(`https://aios.example/p/${PID}`);
  });

  it("擋掉 protocol-relative：//evil.example 是外站不是站內路徑", () => {
    expect(companionAbsoluteUrl("https://aios.example", "//evil.example/steal")).toBeNull();
  });

  it("不接受相對路徑與 javascript:", () => {
    expect(companionAbsoluteUrl("https://aios.example", "p/1")).toBeNull();
    expect(companionAbsoluteUrl("https://aios.example", "javascript:alert(1)")).toBeNull();
  });

  it("origin 不是 http(s) 一律拒絕", () => {
    expect(companionAbsoluteUrl("javascript:void", "/dashboard")).toBeNull();
    expect(companionAbsoluteUrl("not a url", "/dashboard")).toBeNull();
  });

  it("origin 帶路徑時只取 origin，不會把路徑串進去", () => {
    expect(companionAbsoluteUrl("https://aios.example/some/where", "/dashboard"))
      .toBe("https://aios.example/dashboard");
  });
});

describe("parseAiosUri", () => {
  it("aios://project/:uuid → /p/:uuid", () => {
    expect(parseAiosUri(`aios://project/${PID}`)).toBe(`/p/${PID}`);
  });

  it("aios://storyboard/:uuid → 專案頁錨點", () => {
    expect(parseAiosUri(`aios://storyboard/${PID}`)).toBe(`/p/${PID}#stage-board`);
  });

  it("aios://voice 與 aios://tasks 對應 Widget 捷徑", () => {
    expect(parseAiosUri("aios://voice")).toBe("/?voice=1");
    expect(parseAiosUri("aios://tasks")).toBe("/?tab=tasks");
    expect(parseAiosUri("aios://home")).toBe("/");
  });

  it("白名單解析：未知 host、壞 UUID、別的 scheme 一律 null", () => {
    expect(parseAiosUri("aios://admin/../../x")).toBeNull();
    expect(parseAiosUri("aios://project/not-a-uuid")).toBeNull();
    expect(parseAiosUri("aios://project")).toBeNull();
    expect(parseAiosUri("https://evil.example/p/x")).toBeNull();
    expect(parseAiosUri("javascript:alert(1)")).toBeNull();
  });

  it("與 Java 端 AiosSchemeRouter 同一份對照表（兩邊要一起改）", () => {
    // Java 檔在 App 冷啟動、WebView 還沒起來時做同一份轉譯。這條斷言保住
    // 「有人只改一邊」時至少測試紅一次，逼人打開對面那份。
    const java = readFileSync(
      path.join(__dirname, "..", "android", "app", "src", "main", "java", "app", "aios", "mobile", "AiosSchemeRouter.java"),
      "utf8",
    );
    for (const host of ["project", "storyboard", "studio", "generation", "voice", "tasks", "home"]) {
      expect(java, `AiosSchemeRouter.java 缺 case "${host}"`).toContain(`case "${host}"`);
    }
  });
});

describe("companionHandoffReason", () => {
  it("講理由而不是「App 不支援」", () => {
    for (const target of COMPANION_DEEP_LINK_TARGETS) {
      expect(companionHandoffReason(target)).not.toContain("不支援");
    }
    expect(companionHandoffReason("storyboard")).toContain("大螢幕");
  });
});
