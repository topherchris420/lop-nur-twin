/**
 * circuit-informed/v2's own parameters: the five mechanisms it adds to v1
 * (`controller.ts`), in the form of the circuit table (`../params.ts`).
 *
 * - `published`: a value a cited paper states in its text or tables.
 * - `fitted`: set by the calibration's documented fit (`calibration/fit.ts`,
 *   `fitV2`) to the development observations named in `fit`. The value is
 *   the one docs/benchmarks/fly-calibration/fit.json records, and a test
 *   holds it there. Those observations are fit targets of v2, never tests.
 * - `model`: chosen here, neither measured nor fitted; the note says why.
 *
 * v2 was built after every observation registered before the 2026-11 held-out
 * set had been seen, so for v2 those are development observations whether or
 * not a value here was fitted to them (`calibration/roles.ts`). The held-out
 * set (`calibration/holdout.ts`) set nothing here.
 */
import { CITATIONS as FLY_CITATIONS, type Citation } from "../../params.js";
import type { CircuitParam } from "../params.js";

export const V2_CITATIONS = {
  zacarias2018: {
    short: "Zacarias et al. 2018, Nat Commun 9:3697",
    doi: "10.1038/s41467-018-05875-1",
  },
  geurten2014: {
    short: "Geurten et al. 2014, Front Behav Neurosci 8:365",
    doi: "10.3389/fnbeh.2014.00365",
  },
  vanBreugel2012: FLY_CITATIONS.vanBreugel2012,
  liu2007: {
    short: "Liu, Davis & Roman 2007, Genetics 175:1197",
    doi: "10.1534/genetics.106.068411",
  },
} as const satisfies Record<string, Citation>;

const fixed = (
  value: number,
  unit: string,
  note: string,
  source: Citation,
): CircuitParam => ({
  value,
  unit,
  kind: "published",
  min: value,
  max: value,
  source,
  note,
});

const model = (
  value: number,
  unit: string,
  [min, max]: readonly [number, number],
  note: string,
  source?: Citation,
): CircuitParam =>
  source
    ? { value, unit, kind: "model", min, max, source, note }
    : { value, unit, kind: "model", min, max, note };

const fitted = (
  value: number,
  unit: string,
  [min, max]: readonly [number, number],
  fit: readonly string[],
  note: string,
): CircuitParam => ({ value, unit, kind: "fitted", min, max, fit, note });

const Z = V2_CITATIONS.zacarias2018;
const G = V2_CITATIONS.geurten2014;
const VB = V2_CITATIONS.vanBreugel2012;

/** The development observations each group of fitted values is fitted to. */
export const V2_FIT_TARGETS = {
  wall: ["walking.wall.liu"],
  explore: ["walking.moving.minute1", "walking.moving.minute2", "walking.moving.minute3"],
  speed: ["walking.speed.minute1", "walking.speed.minute2", "walking.speed.minute3"],
  freeze: ["escape.walking.freeze"],
  jump: ["escape.walking.jump"],
  flight: ["flight.saccade-rate.censi"],
} as const;

export const V2_PARAMS = {
  // --- 1. Wall following ----------------------------------------------------
  wallTurnRadS: model(
    4,
    "rad/s",
    [1, 12],
    "how fast a walking fly that meets a wall or an edge it cannot pass turns along it, the shorter way, until it can walk on. Not measured; a little above the body's fastest spontaneous walking turns",
  ),
  wallHoldS: model(
    1,
    "s",
    [0, 10],
    "for this long after its last contact the fly counts as at the wall, and its turns toward the open side are thinned by `centrophobia`. Not measured",
  ),
  centrophobia: fitted(
    0.968,
    "probability",
    [0, 1],
    V2_FIT_TARGETS.wall,
    "share of a fly's spontaneous turns toward the open side that it does not make while at the wall: the fly's reluctance to leave a wall (centrophobism). Fitted to the share of time Canton-S males spend in the outer third of an open field, which is therefore a fit target",
  ),

  // --- 2. Exploration that decays -------------------------------------------
  exploreGain: fitted(
    3.81,
    "×",
    [0, 20],
    V2_FIT_TARGETS.explore,
    "A in g(t) = 1 + A·exp(−t/τ): a fly placed somewhere new starts walking g(t) times as often and stops 1/g(t) times as often as it later settles to. Fitted with τ to the share of each of the first three minutes spent moving",
  ),
  exploreTauS: fitted(
    90,
    "s",
    [10, 1800],
    V2_FIT_TARGETS.explore,
    "τ in g(t), with t the time since the fly was placed: how fast exploration settles. Fitted with A",
  ),
  walkSpeedMeanCmS: fitted(
    0.726,
    "cm/s",
    [0.72, 4],
    V2_FIT_TARGETS.speed,
    "mean of the gamma distribution each walking bout's speed is drawn from, truncated to the body's walking range (7.2–40 mm/s). Fitted to the open-field walking speed of the first three minutes",
  ),
  walkSpeedShape: model(
    4,
    "gamma shape",
    [1, 50],
    "shape of that distribution: speeds spread about ±50% of the mean. Not measured",
  ),

  // --- 3. Saccadic walking ---------------------------------------------------
  walkSaccadeMeanDeg: fixed(
    15,
    "deg",
    "mean heading change of a walking body saccade: 'During a saccadic turn, the flies changed their heading on average by about 15°' (saccades detected above 200°/s)",
    G,
  ),
  walkSaccadeShape: model(
    2,
    "gamma shape",
    [1, 20],
    "shape of the gamma distribution saccade amplitudes are drawn from, about that mean. The paper gives the mean only",
  ),
  walkSaccadeMs: fixed(
    90,
    "ms",
    "duration of a walking saccade: 'within 40 to 120 ms (median 90 ms'. The fly decides every 50 ms, so a saccade runs the whole number of decisions nearest 90 ms (two: 100 ms), turning its amplitude over them",
    G,
  ),
  walkSaccadeHz: model(
    1.5,
    "1/s",
    [0, 10],
    "rate of walking body saccades, between which the fly walks nearly straight. The paper states none. It is not fitted: a development probe found that with the paper's amplitudes no rate up to 10/s brings the share of open-field turn angles under 30° below 96% (Soibam et al. 2012 report 60%), so a fit would only run to its bound. Those large turns need something this mechanism does not model",
    G,
  ),
  walkDriftRadS: model(
    0.4,
    "rad/s",
    [0, 3],
    "SD of the slow yaw drift between saccades, redrawn every decision: walking flies 'showed some residual rotations during translatory phases' (Geurten et al. 2014), at a size the paper gives no number for",
    G,
  ),

  // --- 4. Freeze or flee when enclosed (Zacarias et al. 2018) --------------
  loomDetectDeg: model(
    20,
    "deg",
    [5, 60],
    "angular size at which a perched fly's defensive choice is made for a loom: before the giant fiber's and the wing raise's criteria, so the choice can pre-empt them. The paper finds the deceleration that marks detection at the same time in freezing and fleeing trials but gives no angle in its text",
    Z,
  ),
  speedLookbackS: fixed(
    0.5,
    "s",
    "the speed that sets the choice is the fly's 0.5 s before the loom: the paper 'sorted looming trials by the speed of flies 500 ms before looming onset'",
    Z,
  ),
  freezeMax: fitted(
    0.231,
    "probability",
    [0, 1],
    V2_FIT_TARGETS.freeze,
    "pFreeze in p(v) = pFreeze·exp(−v/vScale): the chance an enclosed, still fly freezes at a loom. Fitted to the share of flies freezing at the end of 20 looms, which is therefore a fit target",
  ),
  freezeSpeedScaleCmS: model(
    1.2,
    "cm/s",
    [0.1, 10],
    "vScale: the chance of freezing falls e-fold for each 12 mm/s of speed before the loom. The paper's flies froze at 76.7% when looms came at low speed and 26.8% at high speed (a factor of 2.9) around a baseline of about 11 mm/s; the speeds of its two groups are in a supplementary figure, not its text, so the scale is set to give a factor of about 3 between a still fly and one walking at 12–13 mm/s, and is not fitted",
    Z,
  ),
  freezeMeanS: model(
    100,
    "s",
    [1, 1000],
    "mean of the exponential freeze duration. The paper: after five looms in one minute 'Half (50/100) of the flies froze for longer than one minute', and most flies 'either froze for long periods of time (>3 min) or did not freeze at all'. If nearly every fly froze, a constant hazard with a mean of 100 s leaves e^(−60/100) ≈ 55% frozen past a minute. Derived from those words, not fitted",
    Z,
  ),
  jumpShare: fitted(
    0.165,
    "probability",
    [0, 1],
    V2_FIT_TARGETS.jump,
    "qJump: the chance an enclosed fly that does not freeze answers the loom with a takeoff (through v1's escape circuit) rather than by running. Fitted to the share of looms followed by a jump, which is therefore a fit target",
  ),
  runSpeedCmS: model(
    2.5,
    "cm/s",
    [0.72, 4],
    "speed of a fly running from a loom. The paper reports a median increase of 1.47 mm/s over a stimulation period and of 3.77 mm/s after looms that included a pause; a run is a short burst well above the open-field speed, and this value is not fitted",
    Z,
  ),
  runS: model(
    1,
    "s",
    [0.1, 10],
    "how long a run lasts before the fly's own walking takes over again. Not measured",
  ),

  // --- 5. Flight saccades ------------------------------------------------------
  flightSaccadeMeanDeg: fixed(
    40,
    "deg",
    "mean of the log-normal saccade amplitudes: '20 to 270 deg ... well described by a log-normal distribution with a mean of 40 deg and scaling factor of 2.3 deg'. Read as the distribution's median (e^μ = 40°) and multiplicative spread (e^σ = 2.3)",
    VB,
  ),
  flightSaccadeScale: fixed(
    2.3,
    "×",
    "multiplicative spread of those amplitudes (e^σ), as above. Amplitudes are kept within 20–170°: the paper's smallest, and the body's largest turn short of half a circle",
    VB,
  ),
  flightSaccadeHz: fitted(
    6.031,
    "1/s",
    [0, 10],
    V2_FIT_TARGETS.flight,
    "rate of spontaneous saccades in open space. Fitted to the saccade rate of flies tracked in a 1 m-radius arena, which is therefore a fit target",
  ),
} as const satisfies Record<string, CircuitParam>;

export type V2ParamName = keyof typeof V2_PARAMS;
export type V2Config = Partial<Record<V2ParamName, number>>;
export type ResolvedV2Params = Readonly<Record<V2ParamName, number>>;

/** The table's values with overrides of model and fitted values applied, each within its range; frozen. */
export function resolveV2Params(config: V2Config = {}): ResolvedV2Params {
  for (const name of Object.keys(config))
    if (!Object.hasOwn(V2_PARAMS, name)) throw new Error(`unknown v2 parameter ${name}`);
  const out = {} as Record<V2ParamName, number>;
  for (const name of Object.keys(V2_PARAMS) as V2ParamName[]) {
    const p: CircuitParam = V2_PARAMS[name];
    const v = config[name];
    if (v === undefined) out[name] = p.value;
    else {
      if (p.kind !== "model" && p.kind !== "fitted")
        throw new Error(`${name} is a ${p.kind} value and cannot be overridden`);
      if (typeof v !== "number" || !Number.isFinite(v))
        throw new Error(`${name} must be a finite number`);
      if (v < p.min || v > p.max)
        throw new Error(
          `${name} must be within [${p.min}, ${p.max}] ${p.unit}; got ${v}`,
        );
      out[name] = v;
    }
  }
  return Object.freeze(out);
}
