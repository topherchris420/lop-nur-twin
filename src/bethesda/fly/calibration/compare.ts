/**
 * How a simulated measurement is set beside a published one.
 *
 * A published value comes with whatever spread its paper reports: a standard
 * deviation of the flies, a standard error or confidence interval of the
 * mean, a range or interquartile range, or a proportion with its count. From
 * that the comparison builds two intervals and asks where the simulator's
 * estimate falls:
 *
 * - `inside`: inside the interval the paper gives for its central value (its
 *   95% interval: the stated one, the mean ± 1.96 standard errors, the mean ±
 *   1.96 SD/√n, or Wilson's interval for a proportion);
 * - `within-spread`: outside that, but inside the spread of the flies
 *   themselves (± one SD, the interquartile range or the range), so the
 *   simulated value is one a single fly could show;
 * - `outside`: neither;
 * - `no-interval`: the paper gives no spread (or none of a known kind), so
 *   only the difference can be shown;
 * - `agrees` / `disagrees`: for a direction the paper reports without a
 *   value (a trend's sign, an order), whether the simulator's has it;
 * - `not-produced`: the simulator does not produce the quantity at all.
 *
 * The classes are coarse on purpose. The simulated estimate's own interval is
 * reported beside it, and nothing here is a statistical test of the simulator
 * against Drosophila: the paradigms are approximations of the published ones,
 * which each comparison names.
 */

/** A published value's spread, as its paper reports it. */
export type Spread =
  | { kind: "sd"; value: number }
  | { kind: "sem"; value: number }
  | { kind: "ci95"; lo: number; hi: number }
  | { kind: "range"; lo: number; hi: number }
  | { kind: "iqr"; lo: number; hi: number }
  | { kind: "proportion"; k: number; n: number };

export type Agreement =
  | "inside"
  | "within-spread"
  | "outside"
  | "no-interval"
  | "agrees"
  | "disagrees"
  | "not-produced";

export interface Interval {
  lo: number;
  hi: number;
}

/** Wilson's 95% score interval for k successes in n trials. */
export function wilson(k: number, n: number): Interval {
  if (!(n > 0)) return { lo: 0, hi: 1 };
  const z = 1.959963984540054;
  const p = k / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/**
 * The 95% interval of a published central value, or null when its spread
 * gives none (a population range, or an SD without a count).
 */
export function centralInterval(
  value: number,
  spread: Spread | null,
  n: number | null,
): Interval | null {
  if (!spread) return null;
  switch (spread.kind) {
    case "ci95":
      return { lo: spread.lo, hi: spread.hi };
    case "sem":
      return { lo: value - 1.96 * spread.value, hi: value + 1.96 * spread.value };
    case "sd":
      return n && n > 1
        ? {
            lo: value - (1.96 * spread.value) / Math.sqrt(n),
            hi: value + (1.96 * spread.value) / Math.sqrt(n),
          }
        : null;
    case "proportion":
      return wilson(spread.k, spread.n);
    case "range":
    case "iqr":
      return null;
  }
}

/** The spread of the flies themselves, or null when the paper reports only the mean's. */
export function populationInterval(
  value: number,
  spread: Spread | null,
): Interval | null {
  if (!spread) return null;
  switch (spread.kind) {
    case "sd":
      return { lo: value - spread.value, hi: value + spread.value };
    case "range":
    case "iqr":
      return { lo: spread.lo, hi: spread.hi };
    default:
      return null;
  }
}

const within = (x: number, i: Interval | null) => i !== null && x >= i.lo && x <= i.hi;

export function agreement(
  simulated: number | null,
  value: number,
  spread: Spread | null,
  n: number | null,
): Agreement {
  if (simulated === null || !Number.isFinite(simulated)) return "not-produced";
  const central = centralInterval(value, spread, n),
    population = populationInterval(value, spread);
  if (!central && !population) return "no-interval";
  if (within(simulated, central)) return "inside";
  if (within(simulated, population)) return "within-spread";
  return "outside";
}

/** For a direction only: does the simulated trend or order have the reported sign? */
export function directionAgreement(simulated: number | null, sign: 1 | -1): Agreement {
  if (simulated === null || !Number.isFinite(simulated)) return "not-produced";
  return Math.sign(simulated) === sign ? "agrees" : "disagrees";
}

/** A simulated estimate: a mean of per-trial values, or a proportion. */
export interface Estimate {
  value: number | null;
  /** Trials or flies it is over. */
  n: number;
  /** The estimate's own 95% interval (normal for a mean, Wilson for a proportion). */
  interval: Interval | null;
}

export function meanEstimate(xs: readonly number[]): Estimate {
  const n = xs.length;
  if (!n) return { value: null, n: 0, interval: null };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { value: m, n, interval: null };
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  const half = (1.96 * sd) / Math.sqrt(n);
  return { value: m, n, interval: { lo: m - half, hi: m + half } };
}

export function proportionEstimate(k: number, n: number): Estimate {
  return n > 0
    ? { value: k / n, n, interval: wilson(k, n) }
    : { value: null, n: 0, interval: null };
}

/** The median of per-trial values, for papers that report medians. */
export function medianEstimate(xs: readonly number[]): Estimate {
  const n = xs.length;
  if (!n) return { value: null, n: 0, interval: null };
  const s = [...xs].sort((a, b) => a - b);
  const m = n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
  return { value: m, n, interval: null };
}
