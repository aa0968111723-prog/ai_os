/**
 * resolveDownload 權限閘門單元測試（受限內部文件）。
 * 安全重點：內部工程/維運/安全/部署文件（auth-design、交接報告、維運手冊、缺陷審查報告…）
 * 只有組長以上可下載；一般組員即使知道識別鍵也必須被後端硬擋（前端不列只是第一道）。
 * 非白名單鍵一律 null（無任何路徑拼接＝無 path traversal 空間）。
 */
import { describe, expect, it } from "vitest";
import { resolveDownload } from "./downloads";

describe("resolveDownload：受限文件需組長以上", () => {
  it("受限的 dev 文件：一般組員（privileged=false）拿不到", () => {
    expect(resolveDownload("docs/auth-design.md", false)).toBeNull();
    expect(resolveDownload("docs/交接報告.md", false)).toBeNull();
    expect(resolveDownload("docs/維運手冊.md", false)).toBeNull();
    expect(resolveDownload("docs/核心缺陷審查報告.md", false)).toBeNull();
    expect(resolveDownload("README.md", false)).toBeNull();
  });

  it("受限的 dev 文件：組長以上（privileged=true）拿得到", () => {
    const hit = resolveDownload("docs/auth-design.md", true);
    expect(hit).not.toBeNull();
    expect(hit?.filename).toBe("auth-design.md");
  });

  it("非受限文件（法律/模型）：一般組員也拿得到", () => {
    expect(resolveDownload("docs/使用條款.md", false)).not.toBeNull();
    expect(resolveDownload("docs/隱私權政策.md", false)).not.toBeNull();
    expect(resolveDownload("docs/模型目錄.md", false)).not.toBeNull();
  });

  it("非白名單鍵一律 null（無論權限）——杜絕 path traversal", () => {
    expect(resolveDownload("../server/index.ts", true)).toBeNull();
    expect(resolveDownload("docs/../.env", true)).toBeNull();
    expect(resolveDownload("/etc/passwd", true)).toBeNull();
    expect(resolveDownload("", true)).toBeNull();
  });
});
