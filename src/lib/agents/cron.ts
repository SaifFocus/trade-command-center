// Cron schedules for the Agents page: parse a 5-field expression (optionally prefixed "CRON_TZ=<zone> "), find the
// next and previous run times, and describe the schedule in words. Pure, no I/O.

export type Cron = {
  tz: string;
  minutes: number[];
  hours: number[];
  dom: Set<number> | null;
  months: Set<number> | null;
  dow: Set<number> | null;
  fields: [string, string, string, string, string];
};

function parseField(src: string, min: number, max: number): number[] | null {
  if (src === "*") return null;
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${src}"`);
    let lo: number, hi: number;
    if (range === "*") [lo, hi] = [min, max];
    else if (range.includes("-")) [lo, hi] = range.split("-").map(Number) as [number, number];
    else [lo, hi] = [Number(range), stepText === undefined ? Number(range) : max];
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi)
      throw new Error(`bad field "${src}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return Array.from(out).sort((a, b) => a - b);
}

const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

export function parseCron(expr: string): Cron {
  let rest = expr.trim();
  let tz = "UTC";
  const m = /^CRON_TZ=(\S+)\s+/.exec(rest);
  if (m) {
    tz = m[1];
    rest = rest.slice(m[0].length);
  }
  const f = rest.split(/\s+/);
  if (f.length !== 5) throw new Error(`expected 5 fields in "${expr}"`);
  const dowList = parseField(f[4], 0, 7);
  return {
    tz,
    minutes: parseField(f[0], 0, 59) ?? range(0, 59),
    hours: parseField(f[1], 0, 23) ?? range(0, 23),
    dom: toSet(parseField(f[2], 1, 31)),
    months: toSet(parseField(f[3], 1, 12)),
    dow: dowList ? new Set(dowList.map((d) => d % 7)) : null,
    fields: f as Cron["fields"],
  };
}
const toSet = (v: number[] | null) => (v ? new Set(v) : null);

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of an instant in a time zone. */
export function wallClock(tz: string, ms: number) {
  if (tz === "UTC") {
    const d = new Date(ms);
    return {
      y: d.getUTCFullYear(),
      mo: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
      h: d.getUTCHours(),
      mi: d.getUTCMinutes(),
      s: d.getUTCSeconds(),
    };
  }
  const p = Object.fromEntries(
    fmt(tz)
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMin(tz: string, ms: number) {
  if (tz === "UTC") return 0;
  const w = wallClock(tz, ms);
  return Math.round(
    (Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000) / 60_000,
  );
}

/** The instant a wall-clock time happens in a zone (the later reading of a repeated hour). */
function wallToUtc(tz: string, y: number, mo: number, d: number, h: number, mi: number) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const t = guess - offsetMin(tz, guess) * 60_000;
  const off2 = offsetMin(tz, t);
  return guess - off2 * 60_000;
}

function dayMatches(c: Cron, mo: number, d: number, dow: number) {
  if (c.months && !c.months.has(mo)) return false;
  if (c.dom && c.dow) return c.dom.has(d) || c.dow.has(dow); // classic cron: either day field may match
  if (c.dom) return c.dom.has(d);
  if (c.dow) return c.dow.has(dow);
  return true;
}

/** First run strictly after `fromMs`, or null if none within about a year. */
export function nextRun(c: Cron, fromMs: number): number | null {
  const w = wallClock(c.tz, fromMs);
  for (let i = 0; i < 370; i++) {
    const day = new Date(Date.UTC(w.y, w.mo - 1, w.d + i));
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    if (!dayMatches(c, mo, d, day.getUTCDay())) continue;
    for (const h of c.hours) {
      if (i === 0 && h < w.h - 2) continue; // earlier hours of today are past (2 h slack for DST)
      for (const mi of c.minutes) {
        const t = wallToUtc(c.tz, y, mo, d, h, mi);
        if (t > fromMs) return t;
      }
    }
  }
  return null;
}

/** Latest run at or before `fromMs`, or null if none within about a year. */
export function prevRun(c: Cron, fromMs: number): number | null {
  const w = wallClock(c.tz, fromMs);
  const hours = [...c.hours].reverse(),
    minutes = [...c.minutes].reverse();
  for (let i = 0; i < 370; i++) {
    const day = new Date(Date.UTC(w.y, w.mo - 1, w.d - i));
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    if (!dayMatches(c, mo, d, day.getUTCDay())) continue;
    for (const h of hours) {
      if (i === 0 && h > w.h + 2) continue;
      for (const mi of minutes) {
        const t = wallToUtc(c.tz, y, mo, d, h, mi);
        if (t <= fromMs) return t;
      }
    }
  }
  return null;
}

const WEEKDAYS = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];
const pad = (n: number) => String(n).padStart(2, "0");

/** Step of a minute or hour field that runs at a fixed interval over the whole range ("*\/5", "2-59/5"), else null. */
function evenStep(values: number[], size: number): number | null {
  if (values.length < 2) return null;
  const step = values[1] - values[0];
  if (size % step !== 0 || values.length !== size / step) return null;
  return values.every((v, i) => i === 0 || v - values[i - 1] === step) ? step : null;
}

/** The schedule in words, with clock times in `displayTz`: "Every 5 min", "Hourly at :50", "Daily at 05:41". */
export function describeSchedule(
  expr: string,
  now: number,
  displayTz = "Europe/Stockholm",
): string {
  let c: Cron;
  try {
    c = parseCron(expr);
  } catch {
    return expr;
  }
  const anyDay = !c.dom && !c.months;
  const everyHour = c.hours.length === 24;
  if (anyDay && !c.dow && everyHour) {
    const step = evenStep(c.minutes, 60);
    if (step) return `Every ${step} min`;
    if (c.minutes.length === 1) return `Hourly at :${pad(c.minutes[0])}`;
  }
  if (anyDay && !c.dow && c.minutes.length === 1) {
    const step = evenStep(c.hours, 24);
    if (step) return `Every ${step} h at :${pad(c.minutes[0])}`;
  }
  if (anyDay && c.minutes.length === 1 && c.hours.length === 1) {
    const next = nextRun(c, now);
    if (next == null) return expr;
    const w = wallClock(displayTz, next);
    const at = `${pad(w.h)}:${pad(w.mi)}`;
    if (!c.dow) return `Daily at ${at}`;
    const days = Array.from(c.dow).sort((a, b) => a - b);
    if (days.length === 1) {
      const local = new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
      return `${WEEKDAYS[local]} at ${at}`;
    }
    return `${days.map((d) => WEEKDAYS[d].slice(0, 3)).join(", ")} at ${at}`;
  }
  return expr;
}
