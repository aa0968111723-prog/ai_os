/**
 * buildIcs 單元測試(需求 #10 排程 .ics 匯出):
 * iCalendar 跳脫(\ ; , 換行)、UTC 無毫秒時間格式、無結束時間補 1 小時、CRLF 行尾。
 * 匯入 Google 日曆/Apple 行事曆的相容性正是靠這幾條規則。
 */
import { describe, expect, it } from "vitest";
import { buildIcs, foldIcsLine } from "./schedule";

const at = (iso: string) => new Date(iso);
const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

describe("buildIcs", () => {
  it("骨架:VCALENDAR 包 VEVENT、CRLF 行尾、含日曆名稱", () => {
    const ics = buildIcs("弘法組", [
      { id: "11111111-2222-3333-4444-555555555555", title: "週會", startsAt: at("2026-07-16T03:00:00.000Z"), endsAt: null, note: null },
    ]);
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
    expect(ics).not.toMatch(/[^\r]\n/); // 不得混入裸 LF
    expect(lines).toContain("X-WR-CALNAME:弘法組・組排程");
    expect(lines).toContain("VERSION:2.0");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(1);
  });

  it("UTC 時間格式 YYYYMMDDTHHMMSSZ(去毫秒);無 endsAt 以 +1 小時計", () => {
    const ics = buildIcs("G", [
      { id: "a", title: "無結束", startsAt: at("2026-07-16T03:00:00.123Z"), endsAt: null, note: null },
    ]);
    expect(ics).toContain("DTSTART:20260716T030000Z");
    expect(ics).toContain("DTEND:20260716T040000Z");
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/); // 產生當下時間,只驗格式
  });

  it("有 endsAt 直接使用,不動", () => {
    const ics = buildIcs("G", [
      { id: "a", title: "有結束", startsAt: at("2026-07-16T03:00:00Z"), endsAt: at("2026-07-16T05:30:00Z"), note: null },
    ]);
    expect(ics).toContain("DTEND:20260716T053000Z");
  });

  it("SUMMARY/DESCRIPTION 跳脫:反斜線→\\\\、分號→\\;、逗號→\\,、換行→\\n", () => {
    const ics = buildIcs("G", [
      {
        id: "a",
        title: "分號; 逗,號\\反斜",
        startsAt: at("2026-07-16T03:00:00Z"),
        endsAt: null,
        note: "第一行\n第二行\r\n第三行",
      },
    ]);
    expect(ics).toContain("SUMMARY:分號\\; 逗\\,號\\\\反斜");
    expect(ics).toContain("DESCRIPTION:第一行\\n第二行\\n第三行");
  });

  it("UID 帶固定網域尾綴;無 note 不出 DESCRIPTION 行", () => {
    const ics = buildIcs("G", [
      { id: "11111111-2222-3333-4444-555555555555", title: "T", startsAt: at("2026-07-16T03:00:00Z"), endsAt: null, note: null },
    ]);
    expect(ics).toContain("UID:11111111-2222-3333-4444-555555555555@aidirector-os");
    expect(ics).not.toContain("DESCRIPTION:");
  });

  it("空清單:合法空日曆(無 VEVENT)", () => {
    const ics = buildIcs("G", []);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("RFC 5545 折疊：長 CJK 標題／備註每行 ≤ 75 octet，且反折疊可還原", () => {
    const longTitle = "禪".repeat(120); // 120 CJK 字 → SUMMARY 行約 8 + 360 = 368 octet
    const longNote = "安".repeat(500); // 500 CJK 字 → DESCRIPTION 行約 1500 octet
    const ics = buildIcs("弘法組・北區工作組・剪輯組（管理）超長組名測試折疊行為需要更多字", [
      { id: "11111111-2222-3333-4444-555555555555", title: longTitle, startsAt: at("2026-07-16T03:00:00Z"), endsAt: null, note: longNote },
    ]);
    // 每一「實體行」都不得超過 75 octet（含續行的前導空格）
    for (const line of ics.split("\r\n")) {
      expect(byteLen(line)).toBeLessThanOrEqual(75);
    }
    // 反折疊（移除 CRLF＋單一前導空格）後，長標題／備註完整重現，沒有被腰斬成亂碼
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`SUMMARY:${longTitle}`);
    expect(unfolded).toContain(`DESCRIPTION:${longNote}`);
    // 折疊不得切在多位元組字中間（還原後不含 UTF-8 替代字元 U+FFFD）
    expect(unfolded).not.toContain("�");
  });

  it("foldIcsLine：短行不動、長行折且不切斷多位元組字", () => {
    expect(foldIcsLine("SUMMARY:短")).toBe("SUMMARY:短"); // < 75 octet 原樣
    const folded = foldIcsLine("DESCRIPTION:" + "字".repeat(60)); // 12 + 180 = 192 octet
    for (const seg of folded.split("\r\n")) expect(byteLen(seg)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("DESCRIPTION:" + "字".repeat(60));
  });

  it("單獨 CR（\\r）也要轉義，擋 ICS 注入", () => {
    const ics = buildIcs("G", [
      {
        id: "11111111-2222-3333-4444-555555555555",
        title: "正常\rSUMMARY:偽造\rDTSTART:20200101T000000Z",
        startsAt: at("2026-07-16T03:00:00Z"),
        endsAt: null,
        note: null,
      },
    ]);
    // 偽造屬性不得成為獨立的一行（前面沒有換行邊界）——CR 已被轉成字面 \n
    expect(ics).not.toMatch(/\r\nSUMMARY:偽造/);
    expect(ics).not.toMatch(/\r\nDTSTART:20200101T000000Z/);
    expect(ics).toContain("SUMMARY:正常\\nSUMMARY:偽造\\nDTSTART:20200101T000000Z");
  });
});
