/**
 * The reduction of a grooming ethogram (one behaviour label per frame) to
 * summary statistics: one function, used by `scripts/import-fly-grooming.ts`
 * on the recorded flies and by the calibration on simulated ones, so the two
 * are summarized identically.
 *
 * Labels are the published dataset's: 1 front-leg rubbing, 2 head cleaning,
 * 3 abdominal cleaning, 4 back-leg rubbing, 5 wing cleaning, 6 walking,
 * 7 standing. Fractions are per fly, then summarized across flies (mean, SD
 * with n − 1, quartiles). Episodes are maximal runs of grooming labels (1–5),
 * motifs maximal runs of anterior (1–2) or posterior (3–5) labels, actions
 * maximal runs of one label; runs touching the start or end of a recording
 * are left out of durations, because their length is not known. Quantiles
 * interpolate linearly between order statistics. Intervals are successive
 * windows from the first frame; the last, partial one is left out. No run is
 * filtered by length.
 */
export const ETHOGRAM_LABELS = {
  1: "front leg rubbing",
  2: "head cleaning",
  3: "abdominal cleaning",
  4: "back leg rubbing",
  5: "wing cleaning",
  6: "walking",
  7: "standing",
} as const;
export type EthogramLabel = keyof typeof ETHOGRAM_LABELS;
export const GROOMING_LABELS: readonly EthogramLabel[] = [1, 2, 3, 4, 5];
export const ANTERIOR_LABELS: readonly EthogramLabel[] = [1, 2];
export const POSTERIOR_LABELS: readonly EthogramLabel[] = [3, 4, 5];

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Quantile q of sorted values, interpolating linearly between order statistics. */
export function quantile(sorted: readonly number[], q: number): number {
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  return (
    sorted[lo]! +
    (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? 0) - sorted[lo]!)
  );
}

/** Mean, SD and quartiles of per-fly values. */
export function acrossFlies(xs: readonly number[], d = 5) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const s = [...xs].sort((a, b) => a - b);
  return {
    n,
    mean: round(mean, d),
    sd: round(sd, d),
    q25: round(quantile(s, 0.25), d),
    median: round(quantile(s, 0.5), d),
    q75: round(quantile(s, 0.75), d),
  };
}

/** Duration statistics of runs (seconds), pooled over flies. */
export function durations(frames: readonly number[], frameHz: number) {
  const s = frames.map((f) => f / frameHz).sort((a, b) => a - b);
  if (!s.length) return { runs: 0 };
  return {
    runs: s.length,
    mean: round(s.reduce((a, b) => a + b, 0) / s.length, 4),
    q10: round(quantile(s, 0.1), 4),
    q25: round(quantile(s, 0.25), 4),
    median: round(quantile(s, 0.5), 4),
    q75: round(quantile(s, 0.75), 4),
    q90: round(quantile(s, 0.9), 4),
  };
}

/** Lengths of the maximal runs whose first label `keep` accepts; `same` says whether a frame continues a run. */
export function runs(
  labels: ArrayLike<number>,
  same: (a: number, b: number) => boolean,
  keep: (l: number) => boolean,
): number[] {
  const out: number[] = [];
  let start = 0;
  for (let k = 1; k <= labels.length; k++)
    if (k === labels.length || !same(labels[k]!, labels[start]!)) {
      if (start > 0 && k < labels.length && keep(labels[start]!)) out.push(k - start);
      start = k;
    }
  return out;
}

const isGroom = (l: number) => l >= 1 && l <= 5;
const isAnterior = (l: number) => l === 1 || l === 2;

/**
 * Anterior-to-anterior and posterior-to-posterior shares of the transitions
 * between successive grooming actions within an episode.
 */
export function motifTransitions(flies: readonly ArrayLike<number>[]) {
  let aa = 0,
    a = 0,
    pp = 0,
    p = 0;
  for (const f of flies) {
    let prev = 0;
    for (let k = 0; k < f.length; k++) {
      const l = f[k]!;
      if (!isGroom(l)) {
        prev = 0;
        continue;
      }
      if (prev && l !== prev) {
        if (isAnterior(prev)) {
          a++;
          if (isAnterior(l)) aa++;
        } else {
          p++;
          if (!isAnterior(l)) pp++;
        }
      }
      prev = l;
    }
  }
  return {
    anteriorToAnterior: a ? round(aa / a, 5) : null,
    posteriorToPosterior: p ? round(pp / p, 5) : null,
    transitions: a + p,
  };
}

export function summarizeEthograms(
  flies: readonly ArrayLike<number>[],
  frameHz: number,
  intervalS: number,
) {
  const frac = (
    f: ArrayLike<number>,
    set: readonly number[],
    from = 0,
    to = f.length,
  ) => {
    let n = 0;
    for (let k = from; k < to; k++) if (set.includes(f[k]!)) n++;
    return n / (to - from);
  };
  const frames = Math.min(...flies.map((f) => f.length));
  const window = Math.round(intervalS * frameHz);
  const intervals = Math.floor(frames / window);
  const series = (set: readonly number[]) =>
    Array.from({ length: intervals }, (_, i) =>
      acrossFlies(flies.map((f) => frac(f, set, i * window, (i + 1) * window))),
    );
  const episodes = flies.map((f) =>
    runs(f, (a, b) => isGroom(a) === isGroom(b), isGroom),
  );
  const motif = (keep: (l: number) => boolean) =>
    durations(
      flies.flatMap((f) =>
        runs(
          f,
          (a, b) => isGroom(a) === isGroom(b) && isAnterior(a) === isAnterior(b),
          keep,
        ),
      ),
      frameHz,
    );
  return {
    timeFraction: Object.fromEntries(
      (Object.keys(ETHOGRAM_LABELS) as unknown as EthogramLabel[]).map((l) => [
        l,
        acrossFlies(flies.map((f) => frac(f, [Number(l)]))),
      ]),
    ),
    grooming: acrossFlies(flies.map((f) => frac(f, GROOMING_LABELS))),
    anterior: acrossFlies(flies.map((f) => frac(f, ANTERIOR_LABELS))),
    posterior: acrossFlies(flies.map((f) => frac(f, POSTERIOR_LABELS))),
    episodes: {
      durationS: durations(episodes.flat(), frameHz),
      perMinute: acrossFlies(
        episodes.map((e, i) => e.length / (flies[i]!.length / frameHz / 60)),
        4,
      ),
    },
    motifs: {
      anterior: motif(isAnterior),
      posterior: motif((l) => isGroom(l) && !isAnterior(l)),
    },
    transitions: motifTransitions(flies),
    actions: Object.fromEntries(
      (Object.keys(ETHOGRAM_LABELS) as unknown as EthogramLabel[]).map((l) => [
        l,
        durations(
          flies.flatMap((f) =>
            runs(
              f,
              (a, b) => a === b,
              (x) => x === Number(l),
            ),
          ),
          frameHz,
        ),
      ]),
    ),
    intervals: {
      lengthS: intervalS,
      count: intervals,
      anterior: series(ANTERIOR_LABELS),
      posterior: series(POSTERIOR_LABELS),
      walking: series([6]),
      standing: series([7]),
    },
  };
}
