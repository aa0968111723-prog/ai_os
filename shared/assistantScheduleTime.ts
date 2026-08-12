/**
 * Deterministic Taipei-wall-clock parse for Agent schedule writes.
 * GoalFrame matching is not enough: add_schedule_item is dropped unless
 * startsAt is a real timestamp. Natural language must become ISO +08:00
 * before a confirmation card can write PostgreSQL.
 */

const ZH_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

function zhNumber(raw: string): number | undefined {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === "十") return 10;
  if (raw.startsWith("十")) {
    const ones = ZH_DIGIT[raw.slice(1)];
    return ones === undefined ? undefined : 10 + ones;
  }
  if (raw.endsWith("十") && raw.length === 2) {
    const tens = ZH_DIGIT[raw[0]!];
    return tens === undefined ? undefined : tens * 10;
  }
  return ZH_DIGIT[raw];
}

function taipeiYmd(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const num = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: num("year"), month: num("month"), day: num("day") };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO-8601 instant in Asia/Taipei, or undefined when the clock is not explicit. */
export function parseTaipeiScheduleTime(message: string, now = new Date()): string | undefined {
  const clock = message.match(
    /(?:(早上|上午|中午|下午|傍晚|晚上)\s*)?(?:(\d{1,2})|([一二兩三四五六七八九十]+))\s*點(?:\s*(?:(\d{1,2})|半))?/u,
  );
  if (!clock) return undefined;
  const period = clock[1];
  const hourRaw = clock[2] ?? clock[3];
  if (!hourRaw) return undefined;
  let hour = zhNumber(hourRaw);
  if (hour === undefined || hour > 24) return undefined;
  if (hour === 24) hour = 0;
  if (period === "下午" || period === "傍晚" || period === "晚上") {
    if (hour > 0 && hour < 12) hour += 12;
  } else if (period === "中午") {
    if (hour === 0) hour = 12;
  }
  if (hour > 23) return undefined;
  let minute = 0;
  if (clock[0].includes("半")) minute = 30;
  else if (clock[4]) {
    const parsed = zhNumber(clock[4]);
    if (parsed === undefined || parsed > 59) return undefined;
    minute = parsed;
  }

  let dayOffset = 0;
  if (/後天/u.test(message)) dayOffset = 2;
  else if (/明天|明日/u.test(message)) dayOffset = 1;

  const base = taipeiYmd(now);
  const shifted = new Date(Date.UTC(base.year, base.month - 1, base.day + dayOffset));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(hour)}:${pad(minute)}:00+08:00`;
}

export function scheduleTitleFromMessage(message: string): string {
  if (/會議|開會|meeting/iu.test(message)) return "會議";
  if (/約會/u.test(message)) return "約會";
  return "行程";
}
