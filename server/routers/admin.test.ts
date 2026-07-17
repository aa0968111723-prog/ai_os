/**
 * buildInviteEmail 單元測試（邀請成員可寄信送出邀請連結）：
 * 主旨帶團隊名、純文字與 HTML 都含邀請連結與 72 小時效期提示；
 * 團隊名／邀請人名來自 DB，放進 HTML 前需逸脫標籤以防注入。
 */
import { describe, expect, it } from "vitest";
import { buildInviteEmail } from "./admin";

describe("buildInviteEmail", () => {
  const url = "https://app.example.com/invite/abc123";

  it("主旨帶團隊名；純文字含連結、邀請人與 72 小時效期", () => {
    const mail = buildInviteEmail("弘法組", url, "Bruce");
    expect(mail.subject).toContain("弘法組");
    expect(mail.text).toContain(url);
    expect(mail.text).toContain("Bruce");
    expect(mail.text).toContain("72 小時");
  });

  it("HTML 版把連結放進可點的 a href，並含團隊名", () => {
    const mail = buildInviteEmail("弘法組", url, "Bruce");
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.html).toContain("弘法組");
  });

  it("團隊名／邀請人名含 HTML 標記時逸脫，避免注入", () => {
    const mail = buildInviteEmail("<b>Team</b>", url, "<script>x</script>");
    expect(mail.html).not.toContain("<b>Team</b>");
    expect(mail.html).not.toContain("<script>x</script>");
    expect(mail.html).toContain("&lt;b&gt;Team&lt;/b&gt;");
    // 純文字版不經逸脫（收件端不會當 HTML 解析），維持原字樣
    expect(mail.text).toContain("<b>Team</b>");
  });
});
