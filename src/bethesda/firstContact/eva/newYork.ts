/**
 * `datetime.fromtimestamp(now, ZoneInfo("America/New_York"))`, as far as
 * Eva's service reads it: the local date, month, hour, minute, day of the
 * year (`timetuple().tm_yday`), `strftime("%Y-%m-%d")` and `dst()`.
 *
 * The UTC offset comes from `Intl.DateTimeFormat` (Node ships full ICU and
 * its tz database). `dst()` is the offset minus New York's standard offset
 * (UTC-5), which is what zoneinfo reports for every rule in force since 1967.
 * Fractions of a second are rounded to microseconds, ties to even, as
 * CPython's `fromtimestamp` does, before the local time is taken.
 */

const ZONE = "America/New_York";
const STANDARD_OFFSET_S = -5 * 3600;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** The zone's UTC offset in seconds at whole second `t`. */
function offsetAt(t: number): number {
  const parts = new Map<string, number>();
  for (const p of formatter.formatToParts(new Date(t * 1000)))
    if (p.type !== "literal") parts.set(p.type, Number(p.value));
  const get = (name: string): number => {
    const v = parts.get(name);
    if (v === undefined || !Number.isInteger(v)) throw new Error(`Intl gave no ${name}`);
    return v;
  };
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall / 1000 - t;
}

// Offsets by UTC hour, kept only when the offset is the same at both ends
// of that hour (New York's transitions fall on whole UTC hours).
const byHour = new Map<number, number>();

function offset(t: number): number {
  const hour = Math.floor(t / 3600);
  const known = byHour.get(hour);
  if (known !== undefined) return known;
  const a = offsetAt(hour * 3600);
  if (a === offsetAt(hour * 3600 + 3599)) {
    if (byHour.size > 100_000) byHour.clear();
    byHour.set(hour, a);
    return a;
  }
  return offsetAt(t);
}

export interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Day of the year, 1 for 1 January. */
  yday: number;
  /** `strftime("%Y-%m-%d")`. */
  date: string;
  /** UTC offset in seconds. */
  offset: number;
  /** `dst().total_seconds()`. */
  dst: number;
}

function halfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
}

let last: { now: number; local: LocalTime } | null = null;

/** Local time in Bethesda at unix time `now`. */
export function newYork(now: number): LocalTime {
  if (last && last.now === now) return last.local;
  let t = Math.floor(now);
  if (halfEven((now - t) * 1e6) >= 1e6) t += 1;
  const off = offset(t);
  const wall = new Date((t + off) * 1000);
  const year = wall.getUTCFullYear();
  const month = wall.getUTCMonth() + 1;
  const day = wall.getUTCDate();
  const yday =
    Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000) + 1;
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  const local: LocalTime = {
    year,
    month,
    day,
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
    yday,
    date: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
    offset: off,
    dst: off - STANDARD_OFFSET_S,
  };
  last = { now, local };
  return local;
}
