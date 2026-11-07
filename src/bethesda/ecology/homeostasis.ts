/**
 * Homeostasis for disposable research bodies in the ecology (R.A.I.N.
 * Genesis Stage B): body temperature, water and energy coupled to one another
 * and to the world, with lethal limits.
 *
 * - **Body temperature** relaxes toward the air's, plus a sun term when the
 *   fly is in sunlight (a small ectotherm: no active thermoregulation but
 *   behaviour).
 * - **Metabolism** scales with body temperature (Q10): the body's power
 *   parameters are taken as their value at 25 °C, and the difference is
 *   debited from (or credited to) its reserve.
 * - **Water** is lost in proportion to the vapour-pressure deficit of the air
 *   at body temperature (saturation pressure from Murray 1967's form of the
 *   Tetens equation), more when active; it is gained by drinking from wet
 *   ground and from the juice of fruit and nectar the body feeds on.
 * - **Limits**: desiccation below `lethalWater`, heat above `lethalTempC`,
 *   starvation after `starveS` with an empty reserve. A dead research body is
 *   recorded as such and stepped no more. This is for disposable research
 *   subjects only: Eva and ECHO cannot die, and nothing here reaches them.
 *
 * It is not ECHO's maintenance physiology (`life/immortal/physiology.ts`) and
 * supplies nothing artificial. Every constant is a model choice of a plausible
 * order, named here; none is fitted to Drosophila.
 */
import type { Citation } from "../fly/params.js";

export const HOMEOSTASIS_VERSION = "research-homeostasis/1";

export const HOMEOSTASIS_CITATIONS = {
  murray1967: {
    short: "Murray 1967, J Appl Meteorol 6:203",
    doi: "10.1175/1520-0450(1967)006<0203:OTCOSV>2.0.CO;2",
  },
} as const satisfies Record<string, Citation>;

interface HParam {
  value: number;
  unit: string;
  kind: "model" | "published";
  note: string;
  source?: Citation;
}
const model = (value: number, unit: string, note: string): HParam => ({
  value,
  unit,
  kind: "model",
  note,
});

export const HOMEOSTASIS_PARAMS = {
  thermalTauS: model(
    20,
    "s",
    "time constant of body temperature toward its operative temperature",
  ),
  sunHeatingC: model(6, "°C", "how much warmer than the air a body sits in full sun"),
  referenceTempC: model(
    25,
    "°C",
    "temperature at which the body's power parameters hold",
  ),
  metabolicQ10: model(2.5, "unitless", "temperature coefficient of metabolic power"),
  waterLossPerKPaS: model(
    1.0e-5,
    "share of body water per kPa per s",
    "water lost per unit vapour-pressure deficit at rest: about 6 h from full to lethal at 25 °C and 15% humidity, chosen so that in the study's dry yard water binds before food (resting starvation takes about twice as long)",
  ),
  activityWaterGain: model(
    1,
    "unitless",
    "extra water loss at full activity (flight), as a multiple of resting loss",
  ),
  bodyWaterUl: model(0.4, "µL", "the body's drinkable water when full"),
  drinkPerS: model(
    1 / 60,
    "share of body water per s",
    "how fast a fly drinks from wet ground",
  ),
  juiceUlPerMgSugar: model(
    7,
    "µL/mg",
    "water in fruit juice per mg of its sugar (about 12% sugar)",
  ),
  lethalWater: model(
    0.35,
    "share of body water",
    "below this the body dies of desiccation",
  ),
  lethalTempC: model(39, "°C", "above this body temperature the body dies of heat"),
  starveS: model(1_800, "s", "an empty reserve for this long kills the body"),
} as const satisfies Record<string, HParam>;
const H = (k: keyof typeof HOMEOSTASIS_PARAMS) => HOMEOSTASIS_PARAMS[k].value;
export { H as homeostasisParam };

/** Saturation vapour pressure (kPa) at `tC` (Murray 1967, over water). */
export function saturationKPa(tC: number): number {
  return 0.61078 * Math.exp((17.27 * tC) / (tC + 237.3));
}

export type Cause = "desiccation" | "heat" | "starvation";

export interface HomeostasisState {
  version: typeof HOMEOSTASIS_VERSION;
  tempC: number;
  /** Share of full body water, 0–1. */
  water: number;
  alive: boolean;
  cause: Cause | null;
  diedAtS: number | null;
  starvedS: number;
  /** Totals: water drunk and from juice (µL), extra metabolic energy (J, + spent). */
  drankUl: number;
  juiceUl: number;
  extraJ: number;
  /** Seconds spent dehydrated (water < 0.7) and hot (body above 32 °C). */
  dryS: number;
  hotS: number;
  maxTempC: number;
  minWater: number;
}

export interface BodyContext {
  t: number;
  /** 0 at rest or feeding, 0.4 walking, 1 flying. */
  activity: number;
  /** The body's base metabolic power for its mode (W), at the reference temperature. */
  basePowerW: number;
  sunlit: boolean;
  light: number;
  airTempC: number;
  /** Relative humidity of the air at the body, 0–1. */
  humidity: number;
  /** Whether the feet are on wet ground and the body is still. */
  onWetGround: boolean;
  /** The body's reserve (J), after this tick's spending. */
  reserveJ: number;
}

export class Homeostasis {
  readonly state: HomeostasisState;
  constructor(airTempC: number) {
    this.state = {
      version: HOMEOSTASIS_VERSION,
      tempC: airTempC,
      water: 1,
      alive: true,
      cause: null,
      diedAtS: null,
      starvedS: 0,
      drankUl: 0,
      juiceUl: 0,
      extraJ: 0,
      dryS: 0,
      hotS: 0,
      maxTempC: airTempC,
      minWater: 1,
    };
  }

  /** Water from juice the body took (µL). */
  juice(ul: number): void {
    if (!this.state.alive || !(ul > 0)) return;
    const s = this.state;
    const gain = Math.min(1 - s.water, ul / H("bodyWaterUl"));
    s.water += gain;
    s.juiceUl += gain * H("bodyWaterUl");
  }

  /**
   * One tick. Returns the energy to take from the reserve (J; negative gives
   * some back) and the water drunk from the ground (µL).
   */
  step(dt: number, c: BodyContext): { energyJ: number; drankUl: number } {
    const s = this.state;
    if (!s.alive) return { energyJ: 0, drankUl: 0 };
    const operative =
      c.airTempC + (c.sunlit ? H("sunHeatingC") * Math.min(1, c.light) : 0);
    s.tempC = operative + (s.tempC - operative) * Math.exp(-dt / H("thermalTauS"));
    const factor = Math.pow(H("metabolicQ10"), (s.tempC - H("referenceTempC")) / 10);
    const energyJ = c.basePowerW * (factor - 1) * dt;
    s.extraJ += energyJ;
    const vpd = saturationKPa(s.tempC) * (1 - Math.min(1, Math.max(0, c.humidity)));
    const loss =
      H("waterLossPerKPaS") * vpd * (1 + H("activityWaterGain") * c.activity) * dt;
    s.water = Math.max(0, s.water - loss);
    let drankUl = 0;
    if (c.onWetGround && s.water < 1) {
      const gain = Math.min(1 - s.water, H("drinkPerS") * dt);
      s.water += gain;
      drankUl = gain * H("bodyWaterUl");
      s.drankUl += drankUl;
    }
    if (s.water < 0.7) s.dryS += dt;
    if (s.tempC > 32) s.hotS += dt;
    s.maxTempC = Math.max(s.maxTempC, s.tempC);
    s.minWater = Math.min(s.minWater, s.water);
    s.starvedS = c.reserveJ - energyJ <= 0 ? s.starvedS + dt : 0;
    const cause: Cause | null =
      s.water < H("lethalWater")
        ? "desiccation"
        : s.tempC > H("lethalTempC")
          ? "heat"
          : s.starvedS >= H("starveS")
            ? "starvation"
            : null;
    if (cause) {
      s.alive = false;
      s.cause = cause;
      s.diedAtS = c.t;
    }
    return { energyJ, drankUl };
  }
}
