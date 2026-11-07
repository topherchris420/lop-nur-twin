/**
 * Homeostatic feedback for research bodies: what a thirsty or overheated fly
 * does about it, layered over the deployed configuration's controller.
 *
 * The policies read only what a fly could sense: its own water and body
 * temperature (interoception), the humidity at its antennae (hygrosensation,
 * carried in flies by antennal sacculus neurons; Enjin et al. 2016, Knecht et
 * al. 2016) and the direction of the light it sees. They change behaviour only
 * by the commands they return, which pass the body's gate like any other.
 *
 * - **Heat** (body above `HOT_C`, perched): in the light, walk away from it
 *   for up to a minute, then rest as long; in shade, stay still while the body
 *   is hot (flies avoid warmth quickly; Ni et al. 2013).
 * - **Thirst** (water below `THIRSTY`): with water underfoot (a contact sense),
 *   stay still (the life lets a still body drink); elsewhere, walk and turn more while the humidity
 *   falls and less while it rises (klinotaxis, the form the fly's own controller
 *   uses for odour); after `GIVE_UP_S` without a clear step up in humidity,
 *   turn about and search elsewhere. On foot only: a flight is the
 *   controller's, whose phototaxis would carry the fly to the sunward wall.
 *   Thirst yields to hunger (above `HUNGRY`) unless water is below
 *   `CRITICAL_WATER`: a hungry fly forages, and fruit brings water too.
 * - Otherwise, and always for an escape, the controller's own command stands.
 *
 * Each policy can be switched off for an ablation, and the hygrosensory input
 * can be taken from a displaced point (`hygroAt`) for a control that keeps the
 * policy's activity but breaks its link to the fly's surroundings. Thresholds
 * and gains are model choices, fixed before any trial of the study ran.
 */
import { mulberry32 } from "../../lib/noise.js";
import type {
  AdapterDescriptor,
  BodySnapshot,
  DecisionInput,
  FlyNeuralAdapter,
  MotorCommand,
} from "../fly/neural.js";
import { PERCHED } from "../fly/neural.js";
import { wrapAngle, type V3 } from "../fly/units.js";
import { outsideExtent } from "../fly/world.js";
import type { Homeostasis } from "./homeostasis.js";
import { HOMEOSTASIS_VERSION } from "./homeostasis.js";

export const HOT_C = 31;
export const THIRSTY = 0.7;
export const SATED = 0.95;
/** Hunger (1 − reserve) above which a merely thirsty fly lets the controller forage. */
export const HUNGRY = 0.2;
/** Below this water, thirst overrides hunger. */
export const CRITICAL_WATER = 0.5;
export const GIVE_UP_S = 30;
/** A rise in humidity this large counts as finding wetter air. */
export const HUMIDITY_STEP = 0.05;
/** A hot fly in the light walks away from it this long, then rests as long (s). */
export const HEAT_WALK_S = 60;
const SEARCH_WALK_CMS = 3;
const TURN_FALLING = 2.5;
const TURN_RISING = 0.4;

export interface PolicyOptions {
  thirst: boolean;
  thermal: boolean;
  /** Where the hygroreceptors sample: the body's position, or a displaced one for the control. */
  hygroAt: (p: V3) => number;
  /**
   * Whether the feet touch water: a contact sense (water-taste neurons in the
   * legs and proboscis; Cameron et al. 2010), always at the body's own place.
   */
  wetUnderfoot: (p: V3) => boolean;
  /** Seeds the policies' own random stream (turn directions). */
  seed: number;
}

export interface PolicyState {
  lastHumidity: number;
  searchS: number;
  bestHumidity: number;
  turnSign: number;
  overrides: {
    thirstRest: number;
    thirstWalk: number;
    thirstFlight: number;
    heat: number;
    shadeRest: number;
    yieldToHunger: number;
  };
  lastT: number;
  /** When the current heat walk began; null before the first (a finite state, so a fly hashes). */
  heatWalkFrom: number | null;
}

export class HomeostaticAdapter implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly inner: FlyNeuralAdapter;
  readonly body: Homeostasis;
  readonly options: Readonly<PolicyOptions>;
  readonly state: PolicyState = {
    lastHumidity: 0,
    searchS: 0,
    bestHumidity: 0,
    turnSign: 1,
    overrides: {
      thirstRest: 0,
      thirstWalk: 0,
      thirstFlight: 0,
      heat: 0,
      shadeRest: 0,
      yieldToHunger: 0,
    },
    lastT: 0,
    heatWalkFrom: null,
  };
  private readonly rng: () => number;
  constructor(inner: FlyNeuralAdapter, body: Homeostasis, options: PolicyOptions) {
    this.inner = inner;
    this.body = body;
    this.options = Object.freeze({ ...options });
    this.rng = mulberry32((options.seed ^ 0x4e0d5) >>> 0);
    const on = [options.thirst ? "thirst" : "", options.thermal ? "heat" : ""]
      .filter(Boolean)
      .join("+");
    this.descriptor = {
      ...inner.descriptor,
      id: `${inner.descriptor.id} + ${HOMEOSTASIS_VERSION} policies (${on || "none"})`,
      label: `${inner.descriptor.label}, with homeostatic feedback`,
    };
  }

  start(body: BodySnapshot): void {
    this.inner.start?.(body);
  }

  /** The policies' command for this input, or null to let the controller's stand. */
  private override(input: DecisionInput, own: MotorCommand | null): MotorCommand | null {
    if (own?.mode === "escape" || own?.mode === "takeoff") return null;
    const body = input.body;
    const s = this.state;
    const h = this.body.state;
    const dt = Math.max(0, body.t - s.lastT);
    s.lastT = body.t;
    if (!PERCHED.has(body.mode)) return null;
    // Outside the fly's extent its controller turns it back: never stand in the way.
    if (outsideExtent(body.home, body.p[0], body.p[2]).away > 0) return null;
    // Heat: in the light, walk away from it (up to `HEAT_WALK_S`, then rest as
    // long); in shade, stay still while the body is hot.
    if (
      this.options.thermal &&
      h.tempC > HOT_C &&
      own?.mode !== "feed" &&
      body.mode !== "feed"
    ) {
      if (input.frame.lightBearing !== null) {
        if (s.heatWalkFrom === null || body.t - s.heatWalkFrom > 2 * HEAT_WALK_S)
          s.heatWalkFrom = body.t;
        if (body.t - s.heatWalkFrom <= HEAT_WALK_S) {
          s.overrides.heat++;
          const away = wrapAngle(input.frame.lightBearing + Math.PI);
          return {
            mode: "walk",
            walkSpeed: SEARCH_WALK_CMS,
            yawRate: Math.max(-3, Math.min(3, 3 * away)),
            reason: `body at ${h.tempC.toFixed(1)} °C in the light: walking away from it`,
          };
        }
        s.overrides.shadeRest++;
        return { mode: "rest", reason: `body at ${h.tempC.toFixed(1)} °C: pausing` };
      } else if (own && own.mode !== "rest" && own.mode !== "groom") {
        s.overrides.shadeRest++;
        return {
          mode: "rest",
          reason: `body at ${h.tempC.toFixed(1)} °C: staying in the shade`,
        };
      }
    }
    if (!this.options.thirst || h.water >= (own?.mode === "rest" ? SATED : THIRSTY)) {
      s.searchS = 0;
      return null;
    }
    // Feeding on fruit or nectar gives water too: let it go on.
    if (own?.mode === "feed" || body.mode === "feed") return null;
    // Drives are arbitrated: a hungry fly forages (fruit brings water as well as
    // sugar) unless its water is critically low.
    if (1 - body.reserve > HUNGRY && h.water >= CRITICAL_WATER) {
      s.searchS = 0;
      s.overrides.yieldToHunger++;
      return null;
    }
    const hum = this.options.hygroAt(body.p);
    if (this.options.wetUnderfoot(body.p)) {
      s.overrides.thirstRest++;
      s.searchS = 0;
      return {
        mode: "rest",
        reason: `thirsty (${h.water.toFixed(2)}) on wet ground: drinking`,
      };
    }
    const rising = hum >= s.lastHumidity;
    s.lastHumidity = hum;
    // Only a clear step up counts as wetter air: the weather's own humidity drifts.
    if (hum > s.bestHumidity + HUMIDITY_STEP) {
      s.bestHumidity = hum;
      s.searchS = 0;
    } else s.searchS += dt;
    // Without a clear step up for `GIVE_UP_S`, strike out in a new direction.
    if (s.searchS > GIVE_UP_S) {
      s.overrides.thirstFlight++;
      s.searchS = 0;
      s.bestHumidity = 0;
      s.turnSign = this.rng() < 0.5 ? -1 : 1;
      return {
        mode: "walk",
        walkSpeed: SEARCH_WALK_CMS,
        yawRate: s.turnSign * Math.PI,
        reason: `thirsty (${h.water.toFixed(2)}), the air no wetter for ${GIVE_UP_S} s: turning to search elsewhere`,
      };
    }
    if (!rising && this.rng() < 0.2) s.turnSign = this.rng() < 0.5 ? -1 : 1;
    s.overrides.thirstWalk++;
    return {
      mode: "walk",
      walkSpeed: SEARCH_WALK_CMS,
      yawRate: s.turnSign * (rising ? TURN_RISING : TURN_FALLING),
      reason: `thirsty (${h.water.toFixed(2)}): walking up the humidity (${hum.toFixed(2)}, ${rising ? "rising" : "falling"})`,
    };
  }

  decide(input: DecisionInput): MotorCommand {
    const own = this.inner.decide(input);
    return this.override(input, own) ?? own;
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    // The fast pathway is the escape reflex: it always stands.
    return this.inner.interrupt ? this.inner.interrupt(input) : null;
  }
}
